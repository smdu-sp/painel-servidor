# Painel do servidor

Painel web, monitoramento, backup, limpeza e análise de disco do servidor `api.smul.pmsp`.

| Onde | O que é | Roda em |
| --- | --- | --- |
| raiz (`app/`, `components/`, `lib/`) | Painel em Next, publicado em `http://api.smul.pmsp/painel` | `/var/www/painel`, PM2 `painel`, porta 3005 |
| `scripts/` | Backup dos bancos, limpeza do www, monitor (alertas no Telegram), auditoria, análise de disco | copiados para `/opt/server-scripts` (root, 700) |

## Atualizar o servidor

```bash
cd /var/www/painel
./atualizar.sh
```

O script faz `git pull`, instala os scripts em `/opt/server-scripts` com dono root, ajusta a regra do sudo se ela mudou, e faz o build e o restart do painel. Ele **não** mexe em `/opt/server-scripts/servidor.conf` nem no `.env.local`; se aparecer uma opção nova no modelo, ele avisa.

## Fazer uma mudança

1. Edite no seu computador, faça commit e push.
2. No servidor: `cd /var/www/painel && ./atualizar.sh`.

Os scripts rodam a partir de `/opt/server-scripts`, não desta pasta. Edite sempre aqui no repositório: o que for editado direto em `/opt/server-scripts` é sobrescrito na próxima atualização (menos o `servidor.conf`).

## O que nunca vai para o Git

`scripts/servidor.conf` (senha do MySQL, token do Telegram) e `.env.local` (senha do painel). Os modelos sem senha são `scripts/servidor.conf.example` e `.env.example`.

## Configuração do painel (`.env.local`)

| Variável | Para quê |
| --- | --- |
| `PAINEL_BASE_PATH` | Caminho no domínio. Padrão `/painel`. Mudou? Rode o build de novo |
| `PAINEL_SENHA` | Senha de acesso (mínimo 8 caracteres) |
| `PAINEL_SEGREDO` | Assina o cookie de login. Gere com `openssl rand -hex 32` |
| `PAINEL_SCRIPTS_DIR` | Pasta dos scripts. Padrão `/opt/server-scripts` |
| `PAINEL_SUDO` | `1` chama os scripts com `sudo -n` (produção) |
| `PAINEL_DADOS_DIR` | Histórico e logs das tarefas disparadas pelo painel. Padrão `./dados` |
| `PAINEL_SESSAO_HORAS` | Duração do login. Padrão 12 |
| `PAINEL_COOKIE_SEGURO` | Vazio detecta HTTPS sozinho; `1` ou `0` força |

## Segurança

O painel escuta só em `127.0.0.1:3005` e chama os scripts por `sudo`, numa regra (`sudoers-painel.txt`) que libera só os comandos exatos, sem argumentos extras. Mantenha este repositório **privado** e com poucas pessoas com permissão de push: quem faz push aqui consegue rodar código como root no servidor.
