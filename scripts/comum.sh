#!/usr/bin/env bash
# Funções compartilhadas. É carregado pelos outros scripts — não execute direto.
set -o pipefail

DIR_SCRIPTS="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
CONF="${CONF:-$DIR_SCRIPTS/servidor.conf}"
[[ -r "$CONF" ]] || { echo "Configuração não encontrada: $CONF" >&2; exit 1; }
# shellcheck source=servidor.conf.example
source "$CONF"

export PATH="${EXTRA_PATH:+$EXTRA_PATH:}/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
HOST_CURTO="$(hostname -s)"
# Proxy corporativo para sair para a internet (Telegram, npm audit)
if [[ -n "${PROXY_URL:-}" ]]; then
  export http_proxy="$PROXY_URL" https_proxy="$PROXY_URL" HTTP_PROXY="$PROXY_URL" HTTPS_PROXY="$PROXY_URL"
  export no_proxy="${NO_PROXY_LISTA:-127.0.0.1,localhost}" NO_PROXY="${NO_PROXY_LISTA:-127.0.0.1,localhost}"
fi
mkdir -p "$DIR_LOGS" "$DIR_ESTADO"

ARQ_LOG="$DIR_LOGS/${NOME_SCRIPT:-geral}.log"
# rotação simples do próprio log (5 MB)
if [[ -f "$ARQ_LOG" ]] && (( $(stat -c %s "$ARQ_LOG") > 5242880 )); then
  mv -f "$ARQ_LOG" "$ARQ_LOG.1"
fi

log() {
  local linha
  linha="[$(date '+%F %T')] $*"
  echo "$linha" >> "$ARQ_LOG"
  echo "$linha" >&2          # aparece no terminal e no log ao vivo do painel (o cron descarta)
  return 0
}

requer() {
  local c
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 || { log "ERRO: comando ausente: $c"; exit 1; }
  done
}

# Impede duas execuções simultâneas do mesmo script
travar() {
  exec 9>"$DIR_ESTADO/${NOME_SCRIPT:-geral}.lock"
  flock -n 9 || { log "Outra execução em andamento; saindo."; exit 0; }
}

humano() { numfmt --to=iec --suffix=B "${1:-0}"; }

# notificar "assunto" "corpo"
notificar() {
  local assunto="$1" corpo="$2" enviado=0
  local texto="[$HOST_CURTO] $assunto"$'\n\n'"$corpo"

  if [[ -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${TELEGRAM_CHAT_ID:-}" ]]; then
    if curl -fsS -m 20 -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
         --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
         --data-urlencode "text=${texto:0:4000}" \
         -d "disable_web_page_preview=true" >/dev/null; then
      enviado=1
    else
      log "Falha ao enviar para o Telegram"
    fi
  fi

  if [[ -n "${SMTP_URL:-}" && -n "${EMAIL_PARA:-}" ]]; then
    local assunto_b64
    assunto_b64="$(printf '[%s] %s' "$HOST_CURTO" "$assunto" | base64 -w0)"
    if { printf 'From: %s\r\nTo: %s\r\nSubject: =?UTF-8?B?%s?=\r\nDate: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n' \
           "$EMAIL_DE" "$EMAIL_PARA" "$assunto_b64" "$(LC_ALL=C date -R)"
         printf '%s\n' "$corpo"; } \
       | curl -fsS -m 30 --ssl-reqd --url "$SMTP_URL" --user "$SMTP_USUARIO:$SMTP_SENHA" \
              --mail-from "$EMAIL_DE" --mail-rcpt "$EMAIL_PARA" --upload-file - >/dev/null; then
      enviado=1
    else
      log "Falha ao enviar e-mail"
    fi
  fi

  (( enviado )) || log "AVISO: nenhuma notificação enviada — $assunto"
}

