#!/usr/bin/env bash
# Atualiza os scripts e o painel a partir deste repositório.
# Este repositório É o painel: fica clonado em /var/www/painel e o PM2 roda daqui.
#
#   cd /var/www/painel && ./atualizar.sh       # baixa (git pull) e instala tudo
#   ./atualizar.sh --sem-pull                  # instala o que já está na pasta, sem baixar
#
# Roda como o usuário dos projetos (sd0602). Pede a senha do sudo para instalar os scripts.
# Nunca toca em /opt/server-scripts/servidor.conf nem no .env.local do painel.
set -euo pipefail

REPO="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
DESTINO_SCRIPTS="/opt/server-scripts"

passo() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
aviso() { printf '\033[33m!! %s\033[0m\n' "$*"; }

cd "$REPO"

if [[ "${1:-}" != "--sem-pull" ]]; then
  passo "Baixando a versão nova"
  antes=$(git rev-parse HEAD)
  git pull --ff-only
  depois=$(git rev-parse HEAD)
  if [[ "$antes" == "$depois" ]]; then
    echo "Já estava na versão mais nova ($(git log -1 --format='%h %s'))."
  else
    git log --format='  %h %s' "$antes..$depois"
  fi
fi

# ---------- Scripts (como root, dono root, 700) ----------
passo "Instalando os scripts em $DESTINO_SCRIPTS"
sudo mkdir -p "$DESTINO_SCRIPTS"
for f in scripts/*.sh; do
  sudo install -o root -g root -m 700 "$f" "$DESTINO_SCRIPTS/$(basename "$f")"
  echo "  $(basename "$f")"
done
sudo install -o root -g root -m 644 scripts/servidor.conf.example "$DESTINO_SCRIPTS/servidor.conf.example"
sudo install -o root -g root -m 644 scripts/crontab.txt "$DESTINO_SCRIPTS/crontab.txt"

if ! sudo test -f "$DESTINO_SCRIPTS/servidor.conf"; then
  sudo install -o root -g root -m 600 scripts/servidor.conf.example "$DESTINO_SCRIPTS/servidor.conf"
  aviso "Criei $DESTINO_SCRIPTS/servidor.conf a partir do modelo. Preencha com: sudo nano $DESTINO_SCRIPTS/servidor.conf"
else
  # Avisa sobre opções novas que existem no modelo mas não no seu servidor.conf
  faltam=$(comm -23 \
    <(grep -oE '^(export )?[A-Z_]+=' scripts/servidor.conf.example | sed 's/^export //' | sort -u) \
    <(sudo grep -oE '^(export )?[A-Z_]+=' "$DESTINO_SCRIPTS/servidor.conf" | sed 's/^export //' | sort -u) || true)
  if [[ -n "$faltam" ]]; then
    aviso "O servidor.conf não tem estas opções novas (vão usar o valor padrão):"
    echo "$faltam" | sed 's/=$//; s/^/     /'
    echo "   Veja o modelo em $DESTINO_SCRIPTS/servidor.conf.example e copie as que quiser."
  fi
fi

# ---------- Regra do sudo do painel ----------
esperado=$(grep -v '^#' sudoers-painel.txt | sed "s/^sd0602 /$(id -un) /")
atual=$(sudo cat /etc/sudoers.d/painel 2>/dev/null | grep -v '^#' || true)
if [[ "$(echo "$esperado" | tr -s ' ')" != "$(echo "$atual" | tr -s ' ')" ]]; then
  passo "Atualizando a regra do sudo do painel"
  tmp=$(mktemp)
  printf '%s\n' "$esperado" > "$tmp"
  if sudo visudo -cf "$tmp" >/dev/null; then
    sudo install -o root -g root -m 440 "$tmp" /etc/sudoers.d/painel
    echo "  /etc/sudoers.d/painel atualizado"
  else
    aviso "A regra nova não passou no visudo; mantive a atual. Confira sudoers-painel.txt."
  fi
  rm -f "$tmp"
fi

# ---------- Painel (build aqui mesmo) ----------
passo "Atualizando o painel em $REPO"
[[ -f .env.local ]] || aviso "Falta o $REPO/.env.local (cp .env.example .env.local && chmod 600 .env.local, e preencha)."
npm ci --no-audit --no-fund
npm run build
if pm2 describe painel >/dev/null 2>&1; then
  pm2 restart painel --update-env
else
  pm2 start ecosystem.config.cjs && pm2 save
fi

passo "Pronto"
echo "Versão instalada: $(git log -1 --format='%h %s (%cd)' --date=format:'%d/%m %H:%M')"
