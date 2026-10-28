#!/usr/bin/env bash
# 2) Dump diário de todos os bancos (MySQL/MariaDB e/ou PostgreSQL).
#    Um arquivo por banco por dia da semana: o de segunda sobrescreve o da segunda anterior,
#    então sempre existem 7 dumps (um para cada dia) de cada banco.
NOME_SCRIPT="backup"
source "$(dirname "$(readlink -f "$0")")/comum.sh"
requer gzip find
travar

umask 077
mkdir -p "$DIR_BACKUP"
ERR="$(mktemp)"; trap 'rm -f "$ERR"' EXIT

DIAS=(x seg ter qua qui sex sab dom)
N=$(date +%u)                         # 1 = segunda ... 7 = domingo
SUFIXO="${N}-${DIAS[$N]}"             # ex.: 3-qua
falhas=(); feitos=()

registrar() { # status nome arquivo_tmp arquivo_final
  if [[ "$1" == ok ]]; then
    mv -f "$3" "$4"
    feitos+=("$2 ($(humano "$(stat -c %s "$4")"))")
    log "  ok: $2 -> $(basename "$4")"
  else
    rm -f "$3"
    falhas+=("$2: $(tail -n 3 "$ERR" | tr '\n' ' ')")
    log "  FALHA: $2 — $(tail -n 3 "$ERR" | tr '\n' ' ')"
  fi
  : > "$ERR"
}

log "=== Backup ($SUFIXO) ==="

# ---------------- MySQL / MariaDB ----------------
if (( MYSQL_ATIVO )); then
  mysql_exec() { MYSQL_PWD="$MYSQL_SENHA" "$@"; }
  conn=(-h"$MYSQL_HOST" -P"$MYSQL_PORTA" -u"$MYSQL_USUARIO")

  if bancos=$(mysql_exec mysql "${conn[@]}" -N -B -e 'SHOW DATABASES' 2>"$ERR"); then
    : > "$ERR"
    for db in $bancos; do
      [[ " $MYSQL_IGNORAR " == *" $db "* ]] && continue
      final="$DIR_BACKUP/mysql_${db}_${SUFIXO}.sql.gz"; tmp="$final.tmp"
      if mysql_exec mysqldump "${conn[@]}" --single-transaction --quick --routines --triggers \
           --events --hex-blob --no-tablespaces --databases "$db" 2>"$ERR" | gzip -c > "$tmp" \
         && gzip -t "$tmp" 2>>"$ERR" && [[ -s "$tmp" ]]; then
        registrar ok "mysql/$db" "$tmp" "$final"
      else
        registrar falha "mysql/$db" "$tmp" "$final"
      fi
    done
  else
    falhas+=("mysql: não consegui listar os bancos — $(tr '\n' ' ' < "$ERR")")
    log "FALHA ao listar bancos MySQL"
  fi
fi

# ---------------- PostgreSQL ----------------
if (( POSTGRES_ATIVO )); then
  pg_exec() { (cd /tmp && sudo -u "$POSTGRES_USUARIO_SO" "$@"); }

  if bancos=$(pg_exec psql -At -c "SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate" 2>"$ERR"); then
    : > "$ERR"
    # usuários, senhas e permissões (ficam fora dos dumps individuais)
    final="$DIR_BACKUP/postgres__globals_${SUFIXO}.sql.gz"; tmp="$final.tmp"
    if pg_exec pg_dumpall --globals-only 2>"$ERR" | gzip -c > "$tmp" && gzip -t "$tmp"; then
      registrar ok "postgres/globals" "$tmp" "$final"
    else
      registrar falha "postgres/globals" "$tmp" "$final"
    fi
    for db in $bancos; do
      [[ " $POSTGRES_IGNORAR " == *" $db "* ]] && continue
      final="$DIR_BACKUP/postgres_${db}_${SUFIXO}.dump"; tmp="$final.tmp"
      # formato custom (-Fc) já vem comprimido e permite restauração seletiva
      if pg_exec pg_dump -Fc "$db" > "$tmp" 2>"$ERR" && [[ -s "$tmp" ]]; then
        registrar ok "postgres/$db" "$tmp" "$final"
      else
        registrar falha "postgres/$db" "$tmp" "$final"
      fi
    done
  else
    falhas+=("postgres: não consegui listar os bancos — $(tr '\n' ' ' < "$ERR")")
    log "FALHA ao listar bancos PostgreSQL"
  fi
fi

# Remove sobras: .tmp de execuções interrompidas e dumps de bancos que não existem mais
find "$DIR_BACKUP" -type f -name '*.tmp' -delete
find "$DIR_BACKUP" -type f -mtime +7 -print -delete | while read -r f; do log "  antigo removido: $f"; done

if [[ -n "$BACKUP_POS_COMANDO" ]] && (( ${#feitos[@]} )); then
  if bash -c "$BACKUP_POS_COMANDO" >>"$ARQ_LOG" 2>&1; then
    log "Pós-comando executado"
  else
    falhas+=("pós-comando falhou: $BACKUP_POS_COMANDO")
  fi
fi

log "Concluído: ${#feitos[@]} ok, ${#falhas[@]} falha(s)"

if (( ${#falhas[@]} )); then
  corpo="Falhas:"$'\n'"$(printf '• %s\n' "${falhas[@]}")"
  (( ${#feitos[@]} )) && corpo+=$'\n\n'"OK:"$'\n'"$(printf '• %s\n' "${feitos[@]}")"
  notificar "❌ Backup com ${#falhas[@]} falha(s)" "$corpo"
  exit 1
elif (( NOTIFICAR_BACKUP_OK )); then
  notificar "💾 Backup ok (${#feitos[@]} bancos)" "$(printf '• %s\n' "${feitos[@]}")"
fi
