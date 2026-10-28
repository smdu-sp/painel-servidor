#!/usr/bin/env bash
# 3) Monitoramento com alerta só quando algo MUDA (caiu, voltou, nova vulnerabilidade...).
#
#   monitorar.sh          -> status: apps do PM2 (+ reinícios), systemd, URLs, disco, idade do backup
#   monitorar.sh --audit  -> npm audit (dependências de produção) de cada projeto do www
#
# Cada modo guarda o último estado em $DIR_ESTADO e compara com o atual.
MODO="status"; [[ "${1:-}" == "--audit" ]] && MODO="audit"
NOME_SCRIPT="monitor-$MODO"
source "$(dirname "$(readlink -f "$0")")/comum.sh"
requer curl jq awk
travar

ESTADO="$DIR_ESTADO/$MODO.estado"
NOVO="$(mktemp)"; trap 'rm -f "$NOVO"' EXIT
declare -A DET=()
REINICIOS=()

reg() { printf '%s\t%s\n' "$1" "$2" >> "$NOVO"; }   # chave, valor
eh_bom() { [[ "$1" =~ ^(active|online|running|no\ ar|ok)$ ]]; }

checar_status() {
  # --- systemd ---
  local s
  for s in "${SERVICOS_SYSTEMD[@]}"; do
    reg "systemd:$s" "$(systemctl is-active "$s" 2>/dev/null || true)"
  done

  # --- PM2 (agrupa instâncias de cluster pelo nome) ---
  if (( PM2_ATIVO )); then
    local pm2_cmd json
    if [[ -n "$PM2_USUARIO" && "$PM2_USUARIO" != "$(id -un)" ]]; then
      pm2_cmd=(sudo -u "$PM2_USUARIO" -H env "PATH=$PATH" pm2)
    else
      pm2_cmd=(pm2)
    fi
    json=$("${pm2_cmd[@]}" jlist 2>/dev/null | sed -n '/^\[/,$p')
    if jq -e 'type=="array"' >/dev/null 2>&1 <<<"$json"; then
      local arq_rest="$DIR_ESTADO/pm2-restarts" nome st rest antes
      declare -A rest_antes=()
      [[ -f "$arq_rest" ]] && while IFS=$'\t' read -r nome rest; do rest_antes[$nome]=$rest; done < "$arq_rest"
      : > "$arq_rest.novo"
      while IFS=$'\t' read -r nome st rest; do
        reg "pm2:$nome" "$st"
        echo -e "$nome\t$rest" >> "$arq_rest.novo"
        # contador de restarts subiu desde a última checagem = o app caiu e o PM2 levantou de novo
        antes=${rest_antes[$nome]:-$rest}
        (( rest > antes )) && REINICIOS+=("🔁 pm2:$nome reiniciou $(( rest - antes ))x desde a última checagem (total: $rest)")
      done < <(jq -r 'group_by(.name)[] | [.[0].name, (map(.pm2_env.status) | unique | join(",")), (map(.pm2_env.restart_time // 0) | add)] | @tsv' <<<"$json")
      mv -f "$arq_rest.novo" "$arq_rest"
    else
      reg "pm2:(daemon)" "inacessível"
    fi
  fi

  # --- URLs (com uma segunda tentativa para evitar falso alarme) ---
  # No ar = respondeu qualquer coisa de 1xx a 4xx (uma API sem rota na raiz dá 404 e está no ar).
  # Fora  = não respondeu (000) ou respondeu 5xx (ex.: 502/503 do Apache quando o app caiu).
  local u c
  no_ar() { [[ "$1" =~ ^[1-4][0-9][0-9]$ ]]; }
  for u in "${URLS[@]}"; do
    c=$(curl -s -o /dev/null -L -m 15 -w '%{http_code}' "$u" || true)
    if ! no_ar "$c"; then
      sleep 5; c=$(curl -s -o /dev/null -L -m 15 -w '%{http_code}' "$u" || true)
    fi
    if no_ar "$c"; then reg "url:$u" "no ar"
    else reg "url:$u" "FORA DO AR"; DET["url:$u"]="HTTP ${c:-000}"; fi
  done

  # --- Disco ---
  local uso mnt
  while read -r uso mnt; do
    uso=${uso%\%}
    if (( uso >= DISCO_LIMITE )); then reg "disco:$mnt" "CHEIO"; else reg "disco:$mnt" "ok"; fi
    DET["disco:$mnt"]="${uso}% usado"
  done < <(df --output=pcent,target -x tmpfs -x devtmpfs -x overlay -x squashfs -x efivarfs 2>/dev/null | tail -n +2)

  # --- Backup recente? (pega também o caso do cron do backup não ter rodado) ---
  if (( MYSQL_ATIVO || POSTGRES_ATIVO )); then
    if [[ -n "$(find "$DIR_BACKUP" -type f ! -name '*.tmp' -mmin -$(( BACKUP_IDADE_MAX_HORAS * 60 )) -print -quit 2>/dev/null)" ]]; then
      reg "backup:bancos" "ok"
    else
      reg "backup:bancos" "ATRASADO"; DET["backup:bancos"]="nenhum dump nas últimas ${BACKUP_IDADE_MAX_HORAS}h"
    fi
  fi
}

checar_audit() {
  requer npm
  local lock proj nome saida pacotes
  local AUDIT_ITENS; AUDIT_ITENS="$(mktemp)"
  while IFS= read -r -d '' lock; do
    proj="$(dirname "$lock")"; nome="${proj#"$WWW_DIR"/}"
    # npm audit sai com código != 0 quando acha algo; o que importa é o JSON
    saida=$(cd "$proj" && npm audit --omit=dev --json 2>/dev/null) || true
    if ! jq -e '.metadata.vulnerabilities' >/dev/null 2>&1 <<<"$saida"; then
      reg "audit:$nome" "erro ao auditar"
      jq -nc --arg p "$nome" '{projeto:$p, erro:true}' >> "$AUDIT_ITENS"
      continue
    fi
    # versão detalhada para o painel web
    jq -c --arg p "$nome" '{projeto:$p, erro:false, contagem:.metadata.vulnerabilities,
      pacotes:[(.vulnerabilities // {}) | to_entries[] | {nome:.key, gravidade:.value.severity, direta:(.value.isDirect // false),
        correcao:(.value.fixAvailable | if type=="object" then "\(.name)@\(.version)" elif .==true then "npm audit fix" else null end)}]}' \
      <<<"$saida" >> "$AUDIT_ITENS"
    pacotes=$(jq -r --arg min "$AUDIT_NIVEL" '
      def peso: {"info":0,"low":1,"moderate":2,"high":3,"critical":4}[.] // 0;
      [ (.vulnerabilities // {}) | to_entries[]
        | select((.value.severity | peso) >= ($min | peso))
        | "\(.key) [\(.value.severity)]" ] | sort | join(", ")' <<<"$saida")
    if [[ -z "$pacotes" ]]; then
      reg "audit:$nome" "ok"
    else
      reg "audit:$nome" "VULNERÁVEL: $pacotes"
      DET["audit:$nome"]="$(jq -r '.metadata.vulnerabilities | "critical=\(.critical) high=\(.high) moderate=\(.moderate) — rode: npm audit --omit=dev"' <<<"$saida")"
    fi
  done < <(find "$WWW_DIR" -maxdepth "$PROFUNDIDADE_PROJETOS" -path '*/node_modules' -prune \
             -o -type f -name package-lock.json -print0)
  jq -s --arg nivel "$AUDIT_NIVEL" '{gerado_em:(now|todate), nivel_minimo:$nivel, projetos:.}' "$AUDIT_ITENS" > "$DIR_ESTADO/audit.json"
  rm -f "$AUDIT_ITENS"
}

if [[ "$MODO" == audit ]]; then checar_audit; else checar_status; fi
sort -o "$NOVO" "$NOVO"

linha_item() { # chave valor
  local ico="🔴"; eh_bom "$2" && ico="🟢"
  printf '%s %s → %s%s\n' "$ico" "$1" "$2" "${DET[$1]:+ ($(printf '%s' "${DET[$1]}"))}"
}

# ---------- Primeira execução: só registra a linha de base ----------
if [[ ! -s "$ESTADO" ]]; then
  total=$(wc -l < "$NOVO"); problemas=""
  while IFS=$'\t' read -r k v; do eh_bom "$v" || problemas+="$(linha_item "$k" "$v")"$'\n'; done < "$NOVO"
  notificar "👀 Monitor ($MODO) iniciado — $total itens" "${problemas:-Tudo ok no momento.}"
  mv -f "$NOVO" "$ESTADO"; log "Linha de base criada ($total itens)"; exit 0
fi

# ---------- Compara com o estado anterior ----------
# Separador \037 (não é espaço): campos vazios não somem na leitura
mudancas=$(awk -F'\t' '
  FILENAME == ARGV[1] { antigo[$1] = $2; next }
  { novo[$1] = $2 }
  END {
    S = "\037"
    for (k in novo)
      if (!(k in antigo)) print "novo" S k S "" S novo[k]
      else if (antigo[k] != novo[k]) print "mudou" S k S antigo[k] S novo[k]
    for (k in antigo) if (!(k in novo)) print "removido" S k S antigo[k] S ""
  }' "$ESTADO" "$NOVO")

if [[ -n "$mudancas" || ${#REINICIOS[@]} -gt 0 ]]; then
  corpo=""; ruins=0; bons=0; info=0
  while IFS=$'\037' read -r tipo k antes depois; do
    case "$tipo" in
      removido)
        corpo+="⚪ $k não é mais monitorado (antes: $antes)"$'\n'; ((info++)) ;;
      novo)
        corpo+="$(linha_item "$k" "$depois") · novo"$'\n'
        if eh_bom "$depois"; then ((info++)); else ((ruins++)); fi ;;
      mudou)
        corpo+="$(linha_item "$k" "$depois")"$'\n'"    antes: $antes"$'\n'
        if eh_bom "$depois"; then ((bons++)); else ((ruins++)); fi ;;
    esac
  done < <([[ -n "$mudancas" ]] && printf '%s\n' "$mudancas")

  if (( ${#REINICIOS[@]} )); then
    corpo+="$(printf '%s\n' "${REINICIOS[@]}")"$'\n'"    (se não foi deploy seu, veja: pm2 logs <app> --err)"$'\n'
    (( ruins += ${#REINICIOS[@]} ))
  fi

  if (( ruins )); then
    assunto="🚨 $ruins problema(s) detectado(s)"
    (( bons )) && assunto+=", $bons normalizado(s)"
  elif (( bons )); then
    assunto="✅ $bons item(ns) normalizado(s)"
  else
    assunto="ℹ️ Itens monitorados mudaram ($info)"
  fi
  notificar "$assunto" "$corpo"
  log "$assunto"$'\n'"$corpo"
fi

mv -f "$NOVO" "$ESTADO"
