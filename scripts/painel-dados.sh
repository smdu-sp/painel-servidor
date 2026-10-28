#!/usr/bin/env bash
# Coletor do painel web: imprime em JSON o estado do servidor (só leitura).
# O painel chama via "sudo -n /opt/server-scripts/painel-dados.sh" (liberado no sudoers).
NOME_SCRIPT="painel-dados"
source "$(dirname "$(readlink -f "$0")")/comum.sh"
requer jq
exec 2>/dev/null   # a saída tem que ser só o JSON

json_ou_null() { jq -c . 2>/dev/null <<<"$1" || echo null; }

# ---------- PM2 ----------
if [[ -n "$PM2_USUARIO" && "$PM2_USUARIO" != "$(id -un)" ]]; then
  pm2_cmd=(sudo -u "$PM2_USUARIO" -H env "PATH=$PATH" pm2)
else
  pm2_cmd=(pm2)
fi
pm2_bruto=$("${pm2_cmd[@]}" jlist | sed -n '/^\[/,$p')
pm2=$(jq -c '[.[] | {nome:.name, id:.pm_id, status:.pm2_env.status, restarts:(.pm2_env.restart_time // 0),
  memoria:(.monit.memory // 0), cpu:(.monit.cpu // 0), desde:(.pm2_env.pm_uptime // null),
  modo:(.pm2_env.exec_mode // ""), pasta:(.pm2_env.pm_cwd // "")}]' <<<"$pm2_bruto" 2>/dev/null) || pm2=null
[[ -n "$pm2" ]] || pm2=null

# ---------- Discos ----------
discos=$(df -B1 --output=target,size,used,avail,pcent -x tmpfs -x devtmpfs -x overlay -x squashfs -x efivarfs | tail -n +2 \
  | jq -R -s -c '[split("\n")[] | select(length>0) | split(" ") | map(select(length>0))
      | {montagem:.[0], tamanho:(.[1]|tonumber), usado:(.[2]|tonumber), livre:(.[3]|tonumber), uso:(.[4]|rtrimstr("%")|tonumber)}]')
[[ -n "$discos" ]] || discos='[]'

# ---------- Backups ----------
backups=$(find "$DIR_BACKUP" -maxdepth 1 -type f ! -name '*.tmp' -printf '%f\t%s\t%T@\n' \
  | jq -R -s -c '[split("\n")[] | select(length>0) | split("\t") | {arquivo:.[0], tamanho:(.[1]|tonumber), modificado:(.[2]|tonumber|floor)}] | sort_by(-.modificado)')
[[ -n "$backups" ]] || backups='[]'

# ---------- Última checagem do monitor (sites, serviços, disco) ----------
monitor=null
if [[ -s "$DIR_ESTADO/status.estado" ]]; then
  monitor=$(jq -R -s -c --argjson quando "$(stat -c %Y "$DIR_ESTADO/status.estado")" \
    '{quando:$quando, itens:[split("\n")[] | select(length>0) | split("\t") | {chave:.[0], valor:.[1]}]}' "$DIR_ESTADO/status.estado")
fi

# ---------- Auditoria de dependências ----------
audit=null
[[ -s "$DIR_ESTADO/audit.json" ]] && audit=$(json_ou_null "$(cat "$DIR_ESTADO/audit.json")")

# ---------- Última análise de disco ----------
disco_analise=null
[[ -s "$DIR_ESTADO/disco.json" ]] && disco_analise=$(json_ou_null "$(cat "$DIR_ESTADO/disco.json")")

# ---------- Últimas execuções (vale também para as do cron) ----------
ultima() { # arquivo_log padrão
  local l; l=$(grep -a "$2" "$DIR_LOGS/$1" 2>/dev/null | tail -n 1)
  [[ -n "$l" ]] && jq -nc --arg q "${l:1:19}" --arg m "${l:22}" '{quando:$q, resumo:$m}' || echo null
}
execucoes=$(jq -nc --argjson b "$(ultima backup.log 'Concluído:')" --argjson l "$(ultima limpeza.log 'Total liberado:')" \
  '{backup:$b, limpeza:$l}')

jq -n --arg host "$(hostname -f 2>/dev/null || hostname)" --argjson agora "$(date +%s)" \
  --argjson pm2 "$pm2" --argjson discos "$discos" --argjson backups "$backups" \
  --argjson monitor "$monitor" --argjson audit "$audit" --argjson execucoes "$execucoes" \
  --argjson disco_analise "$disco_analise" \
  --argjson disco_limite "${DISCO_LIMITE:-85}" --arg dir_backup "$DIR_BACKUP" \
  '{host:$host, agora:$agora, pm2:$pm2, discos:$discos, disco_limite:$disco_limite,
    backups:{dir:$dir_backup, arquivos:$backups}, monitor:$monitor, audit:$audit, execucoes:$execucoes, disco_analise:$disco_analise}'
