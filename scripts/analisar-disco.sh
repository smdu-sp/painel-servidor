#!/usr/bin/env bash
# Análise de uso de disco: onde está o espaço e o que costuma crescer sem ninguém ver.
# Grava o resultado em $DIR_ESTADO/disco.json, que o painel mostra. Só lê; não apaga nada.
NOME_SCRIPT="disco"
source "$(dirname "$(readlink -f "$0")")/comum.sh"
requer du find jq df
travar

LIMITE_PASTA=$((50 * 1024 * 1024))      # pastas menores que 50 MB ficam de fora da árvore
LIMITE_ARQUIVO=$((100 * 1024 * 1024))   # arquivos a partir de 100 MB entram em "maiores arquivos"
PROFUNDIDADE=4
inicio=$(date +%s)
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
: > "$TMP/pastas.tsv"; : > "$TMP/arquivos.tsv"; : > "$TMP/suspeitos.jsonl"

tam() { du -sb "$@" 2>/dev/null | awk '{s+=$1} END {print s+0}'; }

# suspeito <id> <titulo> <bytes> <explicacao> <comando>
suspeito() {
  (( $3 > 0 )) || return 0
  jq -nc --arg id "$1" --arg t "$2" --argjson b "$3" --arg e "$4" --arg c "$5" \
    '{id:$id, titulo:$t, bytes:$b, explicacao:$e, comando:$c}' >> "$TMP/suspeitos.jsonl"
}

# ---------- Partições reais ----------
mapfile -t MONTAGENS < <(df -B1 --output=target,used -x tmpfs -x devtmpfs -x overlay -x squashfs -x efivarfs \
                         | tail -n +2 | awk '$2 > 1073741824 {print $1}')
log "=== Análise de disco: ${MONTAGENS[*]} ==="

# ---------- Pastas (du por partição, sem atravessar para outras) ----------
for m in "${MONTAGENS[@]}"; do
  log "Medindo pastas em $m (pode levar alguns minutos)…"
  du -x -B1 -d "$PROFUNDIDADE" "$m" 2>/dev/null \
    | awk -v lim="$LIMITE_PASTA" -v m="$m" -F'\t' '$1 >= lim || $2 == m {print m "\t" $1 "\t" $2}' >> "$TMP/pastas.tsv"
done

# ---------- Maiores arquivos ----------
for m in "${MONTAGENS[@]}"; do
  log "Procurando arquivos grandes em $m…"
  find "$m" -xdev -type f -size +"$((LIMITE_ARQUIVO / 1024 / 1024))"M -printf '%s\t%T@\t%p\n' 2>/dev/null >> "$TMP/arquivos.tsv"
done
sort -t$'\t' -k1,1nr -o "$TMP/arquivos.tsv" "$TMP/arquivos.tsv"

# ---------- Suspeitos conhecidos ----------
log "Conferindo os suspeitos de sempre…"

# Logs do PM2 (de todos os usuários)
mapfile -t PM2_LOGS < <(ls -d /root/.pm2/logs /home/*/.pm2/logs 2>/dev/null)
if (( ${#PM2_LOGS[@]} )); then
  suspeito pm2-logs "Logs do PM2" "$(tam "${PM2_LOGS[@]}")" \
    "Saída de todos os apps, guardada para sempre se ninguém rotacionar. Em ${PM2_LOGS[*]}." \
    "pm2 flush && pm2 install pm2-logrotate   # como o usuário do PM2"
fi

# Journal do systemd
if command -v journalctl >/dev/null; then
  j=$(journalctl --disk-usage 2>/dev/null | grep -oE '[0-9.]+[KMGT]' | head -1 | numfmt --from=iec 2>/dev/null || echo 0)
  suspeito journal "Logs do sistema (journal)" "${j:-0}" \
    "Histórico de logs do systemd em /var/log/journal." \
    "sudo journalctl --vacuum-size=500M"
fi

# Outros logs em /var/log (sem o journal)
suspeito var-log "Arquivos de /var/log" "$(du -sb --exclude=journal /var/log 2>/dev/null | cut -f1)" \
  "Logs do Apache, MySQL e do sistema, incluindo os rotacionados (.gz)." \
  "sudo find /var/log -name '*.gz' -mtime +30 -delete"

# MySQL: pasta de dados, binlogs e tamanho de cada banco
if [[ -d /var/lib/mysql ]]; then
  bin=$(find /var/lib/mysql -maxdepth 1 -type f -regextype posix-extended \
          -regex '.*/(binlog|mysql-bin|mariadb-bin|[^/]*-bin)\.[0-9]+' -printf '%s\n' 2>/dev/null | awk '{s+=$1} END {print s+0}')
  suspeito mysql-binlog "Binlogs do MySQL" "$bin" \
    "Registro de todas as alterações nos bancos, para replicação. Sem replicação, só precisa dos últimos dias." \
    "sudo mysql -e \"PURGE BINARY LOGS BEFORE NOW() - INTERVAL 3 DAY;\""
  suspeito mysql-dados "Pasta de dados do MySQL" "$(tam /var/lib/mysql)" \
    "Todos os bancos, índices e arquivos internos (ibdata, undo, binlogs). O tamanho por banco está abaixo." ""
fi
bancos='[]'
if (( ${MYSQL_ATIVO:-0} )) && command -v mysql >/dev/null; then
  bancos=$(MYSQL_PWD="$MYSQL_SENHA" mysql -h"$MYSQL_HOST" -P"$MYSQL_PORTA" -u"$MYSQL_USUARIO" -N -B -e \
    "SELECT table_schema, SUM(data_length + index_length + data_free) FROM information_schema.tables
     WHERE table_schema NOT IN ('information_schema','performance_schema','mysql','sys')
     GROUP BY table_schema ORDER BY 2 DESC" 2>/dev/null \
    | jq -R -s -c '[split("\n")[] | select(length>0) | split("\t") | {banco:.[0], bytes:(.[1]|tonumber? // 0)}]') || bancos='[]'
  [[ -n "$bancos" ]] || bancos='[]'
fi

# Backups
suspeito backups "Dumps dos backups" "$(tam "$DIR_BACKUP")" \
  "Os 7 dias de dump de cada banco em $DIR_BACKUP." ""

# Caches de pacotes
suspeito apt "Cache do apt" "$(tam /var/cache/apt/archives)" \
  "Pacotes .deb baixados em atualizações antigas." "sudo apt clean"
mapfile -t NPM_CACHE < <(ls -d /root/.npm /home/*/.npm 2>/dev/null)
(( ${#NPM_CACHE[@]} )) && suspeito npm-cache "Cache do npm" "$(tam "${NPM_CACHE[@]}")" \
  "Pacotes baixados por npm install, de todos os usuários." "npm cache clean --force   # como cada usuário"
[[ -d /var/lib/snapd ]] && suspeito snap "Snaps" "$(tam /var/lib/snapd)" \
  "Versões antigas de pacotes snap guardadas pelo sistema." "sudo snap set system refresh.retain=2"

# node_modules dos projetos
if [[ -d "${WWW_DIR:-/var/www}" ]]; then
  nm=$(find "${WWW_DIR:-/var/www}" -maxdepth "$PROFUNDIDADE_PROJETOS" -type d -name node_modules -prune -print0 2>/dev/null \
        | xargs -0 -r du -sb 2>/dev/null | awk '{s+=$1} END {print s+0}')
  suspeito node-modules "node_modules dos projetos" "$nm" \
    "Dependências instaladas de cada projeto. Normal ser grande; só reduz com npm prune --omit=dev em produção." ""
fi

# Temporários
suspeito tmp "Arquivos temporários (/tmp)" "$(du -sbx /tmp 2>/dev/null | cut -f1)" \
  "Sobras de instalações, builds e uploads. O sistema limpa no reboot." \
  "sudo find /tmp -type f -atime +7 -delete"

# Arquivos apagados que ainda ocupam espaço (presos a um processo aberto)
: > "$TMP/apagados.tsv"
while IFS=$'\t' read -r fd alvo; do
  s=$(stat -Lc %s "$fd" 2>/dev/null) || continue
  pid=${fd#/proc/}; pid=${pid%%/*}
  printf '%s\t%s\t%s\t%s\n' "$s" "$pid" "$(cat "/proc/$pid/comm" 2>/dev/null)" "${alvo% (deleted)}" >> "$TMP/apagados.tsv"
done < <(find /proc/[0-9]*/fd -lname '*(deleted)' -printf '%p\t%l\n' 2>/dev/null)
apagados=$(sort -t$'\t' -k1,1nr "$TMP/apagados.tsv" | awk -F'\t' '!visto[$2 FS $4]++' | head -n 30 \
  | jq -R -s -c '[split("\n")[] | select(length>0) | split("\t") | {bytes:(.[0]|tonumber), pid:.[1], processo:.[2], arquivo:.[3]}
                 | select(.bytes >= 1048576)]')
total_apagados=$(jq '[.[].bytes] | add // 0' <<<"$apagados")
suspeito apagados "Arquivos apagados ainda abertos" "$total_apagados" \
  "Arquivos que alguém apagou mas que um processo ainda mantém aberto: somem do du, mas o df continua contando. Detalhes abaixo." \
  "pm2 restart <app>  ou  sudo systemctl restart <serviço>   # o processo listado acima"

# ---------- Monta o JSON ----------
particoes=$(df -B1 --output=target,size,used,avail -x tmpfs -x devtmpfs -x overlay -x squashfs -x efivarfs | tail -n +2 \
  | jq -R -s -c '[split("\n")[] | select(length>0) | split(" ") | map(select(length>0))
      | {montagem:.[0], tamanho:(.[1]|tonumber), usado:(.[2]|tonumber), livre:(.[3]|tonumber)}]')

jq -n \
  --argjson gerado "$(date +%s)" --argjson duracao "$(( $(date +%s) - inicio ))" \
  --argjson particoes "$particoes" --argjson bancos "$bancos" --argjson apagados "$apagados" \
  --rawfile pastas "$TMP/pastas.tsv" --rawfile arquivos "$TMP/arquivos.tsv" --slurpfile suspeitos "$TMP/suspeitos.jsonl" \
  '{gerado_em:$gerado, duracao:$duracao, particoes:$particoes,
    pastas:[$pastas | split("\n")[] | select(length>0) | split("\t") | {montagem:.[0], bytes:(.[1]|tonumber), caminho:.[2]}],
    arquivos:[$arquivos | split("\n")[] | select(length>0) | split("\t") | {bytes:(.[0]|tonumber), modificado:(.[1]|tonumber|floor), caminho:.[2]}][0:20],
    suspeitos:($suspeitos | sort_by(-.bytes)), bancos:$bancos, apagados:$apagados}' > "$TMP/disco.json"

mv -f "$TMP/disco.json" "$DIR_ESTADO/disco.json"
chmod 600 "$DIR_ESTADO/disco.json"

log "Pronto em $(( $(date +%s) - inicio )) s. Maiores suspeitos:"
jq -r '.suspeitos[0:5][] | "  \(.titulo): \(.bytes)"' "$DIR_ESTADO/disco.json" \
  | while IFS= read -r l; do n=${l##*: }; log "${l%: *}: $(humano "$n")"; done
