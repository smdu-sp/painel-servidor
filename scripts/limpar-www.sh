#!/usr/bin/env bash
# 1) Remove caches de build e arquivos descartáveis dos projetos Node (Nest/Next) em WWW_DIR.
#    Só apaga coisas que são regeneradas sozinhas; o build em uso (.next, dist) é preservado.
NOME_SCRIPT="limpeza"
source "$(dirname "$(readlink -f "$0")")/comum.sh"
requer find du numfmt
travar

[[ -d "$WWW_DIR" ]] || { log "ERRO: WWW_DIR não existe: $WWW_DIR"; exit 1; }
(( LIMPEZA_DRY_RUN )) && log "=== Limpeza em $WWW_DIR (DRY-RUN, nada será apagado) ===" \
                      || log "=== Limpeza em $WWW_DIR ==="

total=0
declare -A por_projeto=()

remover() {
  local alvo="$1" proj="$2" tam
  tam=$(du -sb -- "$alvo" 2>/dev/null | cut -f1); tam=${tam:-0}
  if (( LIMPEZA_DRY_RUN )); then
    log "  [dry-run] $alvo ($(humano "$tam"))"
  elif rm -rf -- "$alvo"; then
    log "  removido: $alvo ($(humano "$tam"))"
  else
    log "  ERRO ao remover: $alvo"; return
  fi
  total=$(( total + tam ))
  por_projeto[$proj]=$(( ${por_projeto[$proj]:-0} + tam ))
}

# Cada pasta com package.json (fora de node_modules) é tratada como um projeto
while IFS= read -r -d '' pkg; do
  proj="$(dirname "$pkg")"

  for rel in "${ALVOS_LIMPEZA[@]}"; do
    [[ -e "$proj/$rel" ]] && remover "$proj/$rel" "$proj"
  done

  # Logs antigos (npm-debug, yarn-error, *.log, logs rotacionados)
  while IFS= read -r -d '' arq; do
    remover "$arq" "$proj"
  done < <(find "$proj" -maxdepth 3 -path '*/node_modules' -prune -o -type f \
             \( -name 'npm-debug.log*' -o -name 'yarn-error.log*' -o -name 'pnpm-debug.log*' \
                -o -name '*.log' -o -name '*.log.[0-9]*' \) \
             -mtime +"$DIAS_LOGS" -print0)
done < <(find "$WWW_DIR" -maxdepth "$PROFUNDIDADE_PROJETOS" -path '*/node_modules' -prune \
           -o -type f -name package.json -print0)

if (( LIMPAR_CACHE_NPM )) && ! (( LIMPEZA_DRY_RUN )) && command -v npm >/dev/null; then
  npm cache clean --force >/dev/null 2>&1 && log "Cache global do npm limpo"
fi

log "Total liberado: $(humano "$total")"

if (( NOTIFICAR_LIMPEZA )) && (( total > 0 )); then
  corpo="Total: $(humano "$total")"$'\n'
  for p in "${!por_projeto[@]}"; do
    corpo+="• ${p#"$WWW_DIR"/}: $(humano "${por_projeto[$p]}")"$'\n'
  done
  notificar "🧹 Limpeza do www: $(humano "$total") liberados" "$corpo"
fi
