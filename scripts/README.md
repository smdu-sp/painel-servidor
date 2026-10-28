# Scripts do servidor

> Para a tela web (status e botões das tarefas), instale também o **painel** — passo a passo no guia *Painel de monitoramento e tarefas do servidor*.

| Script | O que faz | Quando |
|---|---|---|
| `limpar-www.sh` | Apaga cache de build e lixo dos projetos em `/var/www` (`.next/cache`, `node_modules/.cache`, `.turbo`, `coverage`, logs com mais de 7 dias…). **Nunca** toca em `.next/server`, `dist` ou `node_modules`. | 1x/dia |
| `backup-bancos.sh` | Dump de cada banco num arquivo por dia da semana (`mysql_loja_3-qua.sql.gz`). O de quarta sobrescreve o da quarta anterior → sempre 7 dumps por banco. Alerta se falhar. | 1x/dia |
| `monitorar.sh` | Apps do PM2 (online/parado/errored + **crash loop**), serviços do systemd, URLs, disco cheio e backup atrasado. **Só notifica quando algo muda.** | a cada 5 min |
| `painel-dados.sh` | Junta o estado do servidor em JSON para o painel web (só leitura). | chamado pelo painel |
| `monitorar.sh --audit` | `npm audit` das dependências de **produção** de cada projeto. Notifica quando aparece ou some uma vulnerabilidade. | 1x/dia |

Tudo é configurado em `servidor.conf`; `comum.sh` tem as funções compartilhadas (log, trava e envio Telegram/e-mail).

## Instalação

```bash
sudo apt install -y jq curl          # o resto já vem no Ubuntu/Debian
sudo mkdir -p /opt/server-scripts
sudo cp *.sh servidor.conf /opt/server-scripts/
sudo chmod 700 /opt/server-scripts/*.sh
sudo chmod 600 /opt/server-scripts/servidor.conf   # tem senhas
sudo nano /opt/server-scripts/servidor.conf
```

Itens que você **precisa** ajustar no `servidor.conf`:

- `PM2_USUARIO` — o usuário que roda o PM2 (o que aparece em `ps aux | grep PM2`). Se cada projeto roda sob um usuário diferente, me avise que adapto para uma lista.
- `EXTRA_PATH` — se o Node veio do **nvm**, o cron não acha o `pm2`/`npm`. Coloque a saída de `dirname $(which node)` (rodado como o usuário do PM2).
- `URLS` — os endereços públicos (ou rotas de health check) de cada projeto.
- `PROXY_URL` — se o servidor só sai para a internet por proxy (Telegram, npm). Ex.: `http://proxy.pmsp:8080`.
- `SERVICOS_SYSTEMD` — ex.: `(apache2 mysql)` ou `(apache2 mariadb)` (no CentOS/Rocky o Apache se chama `httpd`).
- Credenciais do banco e das notificações (abaixo).

### Usuário de backup no MySQL/MariaDB

```sql
CREATE USER 'backup'@'127.0.0.1' IDENTIFIED BY 'uma-senha-forte';
GRANT SELECT, SHOW VIEW, TRIGGER, EVENT, LOCK TABLES ON *.* TO 'backup'@'127.0.0.1';
```

Usa PostgreSQL também? Ponha `POSTGRES_ATIVO=1` (faz `pg_dump` como o usuário `postgres`).

### Telegram

1. No Telegram, fale com **@BotFather** → `/newbot` → copie o token para `TELEGRAM_BOT_TOKEN`.
2. Mande qualquer mensagem para o seu bot.
3. Abra `https://api.telegram.org/bot<TOKEN>/getUpdates` e copie o `"chat":{"id": ...}` para `TELEGRAM_CHAT_ID`.
   (Para um grupo: adicione o bot no grupo; o id começa com `-`.)

### E-mail (opcional, pode usar junto com o Telegram)

Gmail: `SMTP_URL="smtps://smtp.gmail.com:465"`, `SMTP_USUARIO` = seu Gmail, `SMTP_SENHA` = uma **senha de app** (Conta Google → Segurança → Senhas de app). `EMAIL_DE` e `EMAIL_PARA` = endereços.

## Primeiro teste (antes do cron)

```bash
cd /opt/server-scripts
sudo sed -i 's/^LIMPEZA_DRY_RUN=0/LIMPEZA_DRY_RUN=1/' servidor.conf
sudo ./limpar-www.sh        # só lista o que apagaria
sudo ./backup-bancos.sh && ls -lh /var/backups/bancos
sudo ./monitorar.sh         # deve chegar "👀 Monitor (status) iniciado"
sudo ./monitorar.sh --audit
sudo tail -n 30 /var/log/server-scripts/*.log
```

Se a lista da limpeza estiver certa, volte `LIMPEZA_DRY_RUN=0`. Depois cole o conteúdo de `crontab.txt` em `sudo crontab -e`.

Para ver um alerta de verdade: `pm2 stop <app>`, espere até 5 min, `pm2 start <app>` — chegam o 🚨 e depois o ✅.

## Restaurar um backup

```bash
# MySQL/MariaDB (o dump já recria o banco)
zcat /var/backups/bancos/mysql_loja_3-qua.sql.gz | mysql -u root -p

# PostgreSQL
sudo -u postgres pg_restore -C -d postgres /var/backups/bancos/postgres_loja_3-qua.dump
```

## Observações

- **Reinícios do PM2**: o alerta 🔁 dispara quando o contador de restarts sobe. Um `pm2 restart`/`reload` seu no deploy também conta — nesse caso é só ignorar.
- **Backup fora do servidor**: os dumps ficam no mesmo disco; se o servidor morrer, vão junto. Use `BACKUP_POS_COMANDO` com `rclone` (Google Drive, S3, Backblaze…) para mandar uma cópia para fora.
- **Logs do PM2** costumam ser o maior consumidor de disco e ficam fora do `/var/www`. Instale a rotação: `pm2 install pm2-logrotate` (como o usuário do PM2).
- O audit só olha projetos com `package-lock.json` (npm). Se algum usa pnpm/yarn, dá para adaptar.
- Logs dos próprios scripts: `/var/log/server-scripts/`.
