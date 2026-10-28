# CLAUDE.md — painel-servidor

Contexto para o Claude Code. Repositório `smdu-sp/painel-servidor`: painel web + scripts de manutenção do servidor de produção da SMUL/ATIC (`api.smul.pmsp`). Responda e escreva sempre em **português do Brasil** (código, comentários, mensagens de commit e textos de interface).

## O que é

| Parte | O que faz | Onde roda |
| --- | --- | --- |
| Raiz (`app/`, `components/`, `lib/`) | Painel em Next 16 (App Router, React 19, TypeScript) com login por senha | `/var/www/painel` (este clone), PM2 `painel`, `127.0.0.1:3005`, publicado em `http://api.smul.pmsp/painel` |
| `scripts/` | Bash: backup dos bancos, limpeza do www, monitor com alertas, auditoria npm, análise de disco, coletor de dados do painel | **Copiados** para `/opt/server-scripts` (root:root, 700) pelo `atualizar.sh`; é de lá que rodam |
| `atualizar.sh` | Deploy: `git pull`, instala scripts, atualiza `/etc/sudoers.d/painel`, `npm ci`, build, `pm2 restart painel` | Rodado à mão pelo `sd0602` no servidor |

## O servidor

| Item | Valor |
| --- | --- |
| Acesso | `ssh sd0602@10.20.4.6` (hostname `c4v6x20`), Ubuntu/Debian |
| Usuário dos projetos / dono do PM2 | `sd0602` (tem sudo com senha) |
| Node / PM2 | via nvm: `/home/sd0602/.nvm/versions/node/v22.23.3/bin` (vai no `EXTRA_PATH` do `servidor.conf`; muda se atualizar o Node) |
| Apps no PM2 | `antares`, `dsup`, `nova-intranet`, `oodc`, `pub-sisar`, `sisar`, `smulauth` (+ `painel`) — todos Nest/Next em `/var/www/*` |
| Apache | VirtualHosts **por subdomínio**, só **HTTP porta 80** (`dsup.smul.pmsp`, `sisar.smul.pmsp`, `api.smul.pmsp`, `antares…`, `oodc…`, `api.sisar…`), cada um com `ProxyPass / http://127.0.0.1:PORTA/` |
| Painel no Apache | No VirtualHost do `api.smul.pmsp`, **antes** do `ProxyPass /` (que vai para a API na 3100): `ProxyPass /painel http://127.0.0.1:3005/painel` + `ProxyPassReverse` igual |
| Relógio | **UTC** (3 h à frente de Brasília). Não mudamos o fuso do servidor: o `servidor.conf` tem `export TZ="America/Sao_Paulo"` na 1ª linha, e o cron está em UTC (05:10, 06:40, 10:40 = 02:10, 03:40, 07:40 em Brasília) |
| Banco | MySQL local, 10 bancos (antares, cap-atendimento, dsup, nova_intranet, outorga, outorga-2025, sisar, sisar-atual, sisar-publicacao-2025, smul_auth). Usuário `backup`@`127.0.0.1` só com SELECT, SHOW VIEW, TRIGGER, EVENT, LOCK TABLES |
| Internet | Sai **direto**, sem proxy (Telegram e npm respondem). Existe `PROXY_URL` no conf caso mude. Rede da prefeitura atrás de proxy corporativo: não dá para abrir portas novas |
| Alertas | Bot do Telegram `@aticsmul_bot` → grupo **MONITORAMENTO ATIC** (supergrupo, chat id `-1004304761874`; o id antigo `-5568713913` morreu na migração para supergrupo). O token só existe no `servidor.conf` do servidor |

## Restrições que decidiram a arquitetura (não reabrir sem motivo)

- **Sem portas novas, sem mexer em DNS/rede**: só dá para publicar como caminho dentro de um VirtualHost existente.
- **Uptime Kuma e Cronicle foram descartados**: nenhum dos dois funciona em subpasta (`/status`), e não havia como usar porta ou subdomínio próprio. Por isso o painel é próprio, em Next, com `basePath`.
- **Sem Docker** no servidor: tudo roda no PM2.
- O painel **não roda como root**. Ele chama os scripts com `sudo -n` numa regra que libera só comandos exatos (`sudoers-painel.txt`). Qualquer script novo que o painel precise disparar exige: entrada em `TAREFAS` (`lib/config.ts`) **e** linha nova no `sudoers-painel.txt` com `""` (= sem argumentos). O `atualizar.sh` aplica a regra (valida com `visudo -cf` antes).

## Segurança — regras fixas

- Nunca commitar `scripts/servidor.conf` (senha do MySQL, token do Telegram) nem `.env.local` (senha e segredo do painel). Os modelos são `scripts/servidor.conf.example` e `.env.example`; opções novas vão no modelo, e o `atualizar.sh` avisa quais faltam no conf real.
- Scripts em `/opt/server-scripts` são root:root 700. Quem faz push neste repo roda código como root no servidor: repo privado, poucos com push.
- `/var/backups/bancos` é root 700 de propósito (dumps de todos os sistemas).
- O painel só executa tarefas da lista fixa `TAREFAS`; ids de execução são validados (`/^[a-z0-9-]+$/`).
- Login: senha única (`PAINEL_SENHA`), cookie HMAC `httpOnly` `sameSite=strict`, `secure` só quando o acesso é HTTPS (hoje é HTTP, então fica `false`). Freio de 1 min após 5 erros.

## Scripts (`scripts/`)

Todos fazem `source comum.sh`, que carrega `servidor.conf` (ou `$CONF`), ajusta `PATH`/proxy e oferece `log`, `requer`, `travar` (flock por script), `humano` (bytes) e `notificar "assunto" "corpo"` (Telegram e/ou e-mail via `curl`). `log` escreve em `/var/log/server-scripts/<nome>.log` **e** em stderr (o cron descarta; o painel mostra ao vivo).

| Script | Faz | Quando |
| --- | --- | --- |
| `monitorar.sh` | Estado de PM2 (por nome, agrupando instâncias), systemd (`SERVICOS_SYSTEMD`), `URLS`, disco, idade do último backup. Compara com o estado anterior (`/var/lib/server-scripts/status.estado`) e só notifica **mudanças**; detecta reinício pelo `restart_time` do PM2 | cron `*/5` |
| `monitorar.sh --audit` | `npm audit --omit=dev --json` em cada projeto com `package-lock.json`; grava `audit.estado` e `audit.json` (detalhado, para o painel) | cron diário |
| `backup-bancos.sh` | `mysqldump` de cada banco para `mysql_<banco>_<N>-<dia>.sql.gz` (N = dia da semana, sobrescreve semanalmente ⇒ 7 dumps por banco); valida com `gzip -t`; apaga dumps com mais de 7 dias; `BACKUP_POS_COMANDO` opcional (ex.: rsync para NAS) | cron diário |
| `limpar-www.sh` | Apaga só caches (`.next/cache`, `node_modules/.cache`, `.turbo`, `coverage`…) e logs com mais de 7 dias dos projetos em `/var/www`. **Nunca** `.next` inteiro, `dist` ou `node_modules` | cron diário |
| `analisar-disco.sh` | `du` por partição (profundidade 4, ≥ 50 MB), arquivos ≥ 100 MB, "suspeitos" (logs do PM2, journal, `/var/log`, binlogs/dados do MySQL e tamanho por banco, caches apt/npm, snap, `node_modules`, `/tmp`, arquivos apagados presos a processos via `/proc/*/fd`). Grava `disco.json` | botão do painel |
| `painel-dados.sh` | Coletor só-leitura: imprime um JSON com tudo que o painel mostra (PM2, discos, backups, estado do monitor, audit, última análise de disco, últimas execuções do cron) | painel, a cada 15 s |

Convenções e armadilhas já resolvidas:

- Estado do monitor: TSV `chave<TAB>valor`. A comparação usa separador `\037` na leitura (`IFS=$'\037'`), porque `read` com IFS de tab **colapsa campos vazios** (bug real que inverteu "antes/depois" e gerou falso alarme).
- URL "no ar" = qualquer HTTP 1xx–4xx (API Nest sem rota na raiz responde 404 e está no ar); "fora" = sem resposta (000) ou 5xx. Duas tentativas com 5 s de intervalo.
- Os sites são **HTTP**, não HTTPS.
- `pm2 restart` manual (deploy) também incrementa `restart_time` e gera aviso de reinício: comportamento aceito.
- `smulauth` tinha 40 reinícios acumulados no primeiro levantamento (vale investigar `pm2 logs smulauth --err`).
- Itens novos no estado aparecem como "ℹ️ … novo" (não contam como problema); itens removidos como "⚪ não é mais monitorado".
- Estilo: bash com `set -o pipefail`, `shellcheck -x -P SCRIPTDIR -S warning` limpo, mensagens e comentários em português.

## Painel (Next)

- `next.config.mjs`: `basePath` vem de `PAINEL_BASE_PATH` (padrão `/painel`), exposto como `NEXT_PUBLIC_BASE_PATH`. Fetches no cliente usam `BASE` de `components/formato.ts` (o `basePath` **não** é aplicado sozinho em `fetch`). Mudou o caminho ⇒ novo build.
- `lib/dados.ts` roda o coletor; `lib/tarefas.ts` dispara tarefas com `spawn`, guarda histórico em `dados/execucoes.json` e logs em `dados/logs/<id>.log`; `app/api/*` são as rotas (todas exigem sessão).
- Fontes empacotadas via `@fontsource` (Archivo variável com eixo `wdth` para títulos, Atkinson Hyperlegible para texto): o build não depende de internet.
- Visual: claro/escuro por `prefers-color-scheme`, tokens em `app/globals.css` (`--fundo`, `--tinta`, `--ok`, `--alerta`, `--falha`…), classes `tom-*` só definem `--c`. Elemento de destaque: a frase de status grande no topo + faixa com um segmento por app. Responsivo até 390 px.

## Fluxo de trabalho

1. Mudanças sempre neste repo (nunca editar direto em `/opt/server-scripts`, exceto o `servidor.conf`).
2. Commit + push.
3. No servidor: `cd /var/www/painel && ./atualizar.sh` (pede a senha do sudo).

### Testar sem o servidor

Os scripts aceitam `CONF=/caminho/teste.conf` (aponte `DIR_LOGS`, `DIR_ESTADO`, `DIR_BACKUP`, `WWW_DIR` para uma pasta temporária) e um `pm2` falso no `EXTRA_PATH` que imprime um JSON (`pm2 jlist`). O painel roda local com `PAINEL_SUDO=0` e `PAINEL_SCRIPTS_DIR=./scripts` no `.env.local`, mais `CONF` no ambiente.

## Pendências conhecidas

- Cópia dos dumps para um **NAS** (SMB/CIFS montado em `/mnt/nas` via fstab + `BACKUP_POS_COMANDO='mountpoint -q /mnt/nas && rsync -rt --delete /var/backups/bancos/ /mnt/nas/c4v6x20/'`) — falta saber o endereço/tipo do NAS.
- Ativar Dependabot nos repositórios dos sistemas.
- Alguns bancos antigos podem ser removidos; antes, gerar dump final fora da rotação (`/var/backups/arquivados/`), pois a rotação apaga os dumps em 7 dias.
- Nenhum monitoramento externo: se o servidor cair inteiro, ninguém é avisado.
- Existe um guia passo a passo (doc no claude.ai, "Painel de monitoramento e tarefas do servidor") com a instalação feita até aqui.
