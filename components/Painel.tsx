"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppPm2, Estado, ProjetoAudit, Resultado } from "@/lib/dados";
import type { Registro } from "@/lib/tarefas";
import {
  BASE, NOME_GRAVIDADE, PESO_GRAVIDADE, STATUS_PM2, bytes, dataLog, duracao, ha, horario, type Tom,
} from "./formato";
import Execucao from "./Execucao";
import AnaliseDisco from "./AnaliseDisco";

type Inicial = Resultado & { execucoesPainel: Registro[] };
type TarefaInfo = { id: string; titulo: string; descricao: string };

const INTERVALO = 15_000;
const BACKUP_ATRASADO_H = 26;
const DIAS = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"];
const DIAS_NOME = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"];

type Problema = { texto: string; tom: Tom };

/* ------------------------------------------------------------------ dados derivados */

type Grupo = { nome: string; instancias: AppPm2[]; status: string; tom: Tom };

function agruparApps(pm2: AppPm2[]): Grupo[] {
  const mapa = new Map<string, AppPm2[]>();
  for (const a of pm2) mapa.set(a.nome, [...(mapa.get(a.nome) ?? []), a]);
  return [...mapa.entries()]
    .map(([nome, instancias]) => {
      const ruim = instancias.find((i) => i.status !== "online");
      const st = ruim ? ruim.status : "online";
      return { nome, instancias, status: st, tom: STATUS_PM2[st]?.tom ?? "alerta" };
    })
    .sort((a, b) => ordemTom(a.tom) - ordemTom(b.tom) || a.nome.localeCompare(b.nome));
}

const ordemTom = (t: Tom) => ({ falha: 0, alerta: 1, neutro: 2, ok: 3 })[t];

type Banco = { nome: string; tipo: string; dias: (number | null)[]; ultimo: number; tamanho: number };

function agruparBackups(arquivos: Estado["backups"]["arquivos"], agora: number): Banco[] {
  const re = /^(mysql|postgres)_(.+)_([1-7])-(seg|ter|qua|qui|sex|sab|dom)\.(sql\.gz|dump)$/;
  const mapa = new Map<string, Banco>();
  for (const f of arquivos) {
    const m = re.exec(f.arquivo);
    if (!m) continue;
    const [, tipo, nomeBruto, dia] = m;
    const nome = nomeBruto === "_globals" ? "usuários e permissões" : nomeBruto;
    const chave = `${tipo}/${nome}`;
    const b = mapa.get(chave) ?? { nome, tipo, dias: Array(7).fill(null), ultimo: 0, tamanho: 0 };
    const quando = f.modificado * 1000;
    // Só vale como "dia coberto" se for desta semana (8 dias de folga)
    if (agora - quando < 8 * 86400_000) b.dias[Number(dia) - 1] = quando;
    if (quando > b.ultimo) {
      b.ultimo = quando;
      b.tamanho = f.tamanho;
    }
    mapa.set(chave, b);
  }
  return [...mapa.values()].sort((a, b) => a.nome.localeCompare(b.nome));
}

function vulneraveis(p: ProjetoAudit, nivel: string) {
  const min = PESO_GRAVIDADE[nivel] ?? 3;
  return (p.pacotes ?? []).filter((x) => (PESO_GRAVIDADE[x.gravidade] ?? 0) >= min);
}

function servicosDoMonitor(m: Estado["monitor"]) {
  return (m?.itens ?? [])
    .filter((i) => i.chave.startsWith("url:") || i.chave.startsWith("systemd:"))
    .map((i) => {
      const [tipo, ...resto] = i.chave.split(":");
      const alvo = resto.join(":");
      const bom = ["active", "no ar", "ok"].includes(i.valor);
      return { tipo, alvo, valor: i.valor, tom: (bom ? "ok" : "falha") as Tom };
    });
}

function listarProblemas(e: Estado, grupos: Grupo[], bancos: Banco[]): Problema[] {
  const p: Problema[] = [];
  const agora = e.agora * 1000;
  if (e.pm2 === null) p.push({ texto: "O PM2 não respondeu", tom: "falha" });
  for (const g of grupos) {
    if (g.tom !== "ok") p.push({ texto: `${g.nome} está ${STATUS_PM2[g.status]?.texto ?? g.status}`, tom: g.tom });
  }
  for (const s of servicosDoMonitor(e.monitor)) {
    if (s.tom !== "ok") p.push({ texto: `${s.alvo} ${s.tipo === "url" ? "fora do ar" : `está ${s.valor}`}`, tom: "falha" });
  }
  for (const d of e.discos) {
    if (d.uso >= e.disco_limite) p.push({ texto: `Disco ${d.montagem} em ${d.uso}%`, tom: d.uso >= 95 ? "falha" : "alerta" });
  }
  const ultimo = Math.max(0, ...bancos.map((b) => b.ultimo));
  if (!ultimo) p.push({ texto: "Nenhum backup encontrado", tom: "falha" });
  else if (agora - ultimo > BACKUP_ATRASADO_H * 3600_000) p.push({ texto: `Último backup ${ha(agora - ultimo)}`, tom: "falha" });
  if (e.audit) {
    const afetados = e.audit.projetos.filter((x) => vulneraveis(x, e.audit!.nivel_minimo).length > 0);
    const total = afetados.reduce((s, x) => s + vulneraveis(x, e.audit!.nivel_minimo).length, 0);
    if (total > 0)
      p.push({
        texto: `${total} ${total === 1 ? "dependência vulnerável" : "dependências vulneráveis"} em ${afetados.length} ${afetados.length === 1 ? "projeto" : "projetos"}`,
        tom: "alerta",
      });
  }
  return p.sort((a, b) => ordemTom(a.tom) - ordemTom(b.tom));
}

/* ------------------------------------------------------------------ componente */

export default function Painel({ inicial, tarefas, carregadoEm }: { inicial: Inicial; tarefas: TarefaInfo[]; carregadoEm: number }) {
  const [dados, setDados] = useState<Inicial>(inicial);
  const [atualizadoEm, setAtualizadoEm] = useState(carregadoEm);
  const [carregando, setCarregando] = useState(false);
  const [falhaRede, setFalhaRede] = useState("");
  const [aberta, setAberta] = useState<string | null>(null);
  const [erroTarefa, setErroTarefa] = useState("");

  const atualizar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await fetch(`${BASE}/api/estado`, { cache: "no-store" });
      if (r.status === 401) {
        window.location.href = `${BASE}/login`;
        return;
      }
      setDados(await r.json());
      setAtualizadoEm(Date.now());
      setFalhaRede("");
    } catch {
      setFalhaRede("Sem resposta do painel. Tentando de novo em instantes.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") atualizar();
    }, INTERVALO);
    const aoVoltar = () => document.visibilityState === "visible" && atualizar();
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [atualizar]);

  async function rodar(tarefa: string) {
    setErroTarefa("");
    const r = await fetch(`${BASE}/api/tarefas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tarefa }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErroTarefa(j.erro ?? "Não foi possível iniciar a tarefa.");
      return;
    }
    setDados((d) => ({ ...d, execucoesPainel: [j.registro, ...d.execucoesPainel] }));
    setAberta(j.registro.id);
  }

  async function sair() {
    await fetch(`${BASE}/api/logout`, { method: "POST" });
    window.location.href = `${BASE}/login`;
  }

  const fimExecucao = useCallback(() => atualizar(), [atualizar]);

  const estado = dados.ok ? dados.estado : null;
  const grupos = useMemo(() => (estado?.pm2 ? agruparApps(estado.pm2) : []), [estado]);
  const bancos = useMemo(() => (estado ? agruparBackups(estado.backups.arquivos, estado.agora * 1000) : []), [estado]);
  const problemas = useMemo(() => (estado ? listarProblemas(estado, grupos, bancos) : []), [estado, grupos, bancos]);

  const execucaoAberta = dados.execucoesPainel.find((x) => x.id === aberta) ?? null;
  const tituloDe = (id: string) => tarefas.find((t) => t.id === id)?.titulo ?? id;

  return (
    <div className="pagina">
      <header className="topo">
        <div className="topo-host">
          <span className="topo-rotulo">Servidor</span>
          <strong>{estado?.host ?? "—"}</strong>
        </div>
        <div className="topo-acoes">
          <span className="topo-hora" aria-live="polite">
            {carregando ? "Atualizando…" : `Atualizado às ${new Date(atualizadoEm).toLocaleTimeString("pt-BR")}`}
          </span>
          <button className="botao-leve" onClick={atualizar} disabled={carregando}>
            Atualizar
          </button>
          <button className="botao-leve" onClick={sair}>
            Sair
          </button>
        </div>
      </header>

      {falhaRede && <p className="aviso-rede" role="status">{falhaRede}</p>}

      {!dados.ok ? (
        <section className="resumo">
          <h1 className="manchete tom-falha">Não consegui ler o servidor</h1>
          <p className="resumo-texto">{dados.erro}</p>
        </section>
      ) : (
        <Resumo problemas={problemas} grupos={grupos} />
      )}

      {estado && (
        <div className="grade">
          <div className="coluna-principal">
            <Aplicacoes grupos={grupos} pm2Ok={estado.pm2 !== null} agora={estado.agora * 1000} />
            <Dependencias audit={estado.audit} agora={estado.agora * 1000} onRodar={() => rodar("audit")} />
            <Backups bancos={bancos} agora={estado.agora * 1000} dir={estado.backups.dir} />
            <AnaliseDisco
              analise={estado.disco_analise ?? null}
              agora={estado.agora * 1000}
              rodando={dados.execucoesPainel.find((x) => x.tarefa === "disco" && x.status === "rodando") ?? null}
              onRodar={() => rodar("disco")}
              onAbrir={setAberta}
            />
          </div>
          <div className="coluna-lateral">
            <Tarefas
              tarefas={tarefas}
              execucoes={dados.execucoesPainel}
              cron={estado.execucoes}
              erro={erroTarefa}
              onRodar={rodar}
              onAbrir={setAberta}
              tituloDe={tituloDe}
            />
            <Discos discos={estado.discos} limite={estado.disco_limite} />
            <Servicos monitor={estado.monitor} agora={estado.agora * 1000} onRodar={() => rodar("monitor")} />
          </div>
        </div>
      )}

      {execucaoAberta && (
        <Execucao
          registro={execucaoAberta}
          titulo={tituloDe(execucaoAberta.tarefa)}
          onFechar={() => setAberta(null)}
          onFim={fimExecucao}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ seções */

function Resumo({ problemas, grupos }: { problemas: Problema[]; grupos: Grupo[] }) {
  const tudoBem = problemas.length === 0;
  const pior = problemas[0]?.tom ?? "ok";
  return (
    <section className="resumo" aria-labelledby="manchete">
      <h1 id="manchete" className={`manchete tom-${pior}`}>
        {tudoBem
          ? "Tudo funcionando"
          : `${problemas.length} ${problemas.length === 1 ? "ponto precisa" : "pontos precisam"} de atenção`}
      </h1>
      {!tudoBem && (
        <ul className="problemas">
          {problemas.map((p) => (
            <li key={p.texto} className={`problema tom-${p.tom}`}>
              {p.texto}
            </li>
          ))}
        </ul>
      )}
      {grupos.length > 0 && (
        <ol className="faixa" aria-label="Apps no PM2">
          {grupos.map((g) => (
            <li key={g.nome} className={`faixa-item tom-${g.tom}`} title={`${g.nome}: ${STATUS_PM2[g.status]?.texto ?? g.status}`}>
              <span className="faixa-barra" />
              <span className="faixa-nome">{g.nome}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Aplicacoes({ grupos, pm2Ok, agora }: { grupos: Grupo[]; pm2Ok: boolean; agora: number }) {
  return (
    <section className="secao" aria-labelledby="t-apps">
      <h2 id="t-apps">Aplicações</h2>
      {!pm2Ok ? (
        <p className="vazio">O PM2 não respondeu. Confira o PM2_USUARIO e o EXTRA_PATH no servidor.conf.</p>
      ) : grupos.length === 0 ? (
        <p className="vazio">Nenhum app no PM2.</p>
      ) : (
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead>
              <tr>
                <th scope="col">App</th>
                <th scope="col">Situação</th>
                <th scope="col" className="num">Memória</th>
                <th scope="col" className="num opc">CPU</th>
                <th scope="col" className="num">Reinícios</th>
                <th scope="col" className="num opc">No ar há</th>
              </tr>
            </thead>
            <tbody>
              {grupos.map((g) => {
                const mem = g.instancias.reduce((s, i) => s + i.memoria, 0);
                const cpu = g.instancias.reduce((s, i) => s + i.cpu, 0);
                const restarts = g.instancias.reduce((s, i) => s + i.restarts, 0);
                const desde = Math.max(...g.instancias.map((i) => i.desde ?? 0));
                const online = g.status === "online";
                return (
                  <tr key={g.nome}>
                    <th scope="row">
                      <span className="app-nome">{g.nome}</span>
                      {g.instancias.length > 1 && <span className="app-inst">{g.instancias.length} instâncias</span>}
                    </th>
                    <td>
                      <span className={`selo tom-${g.tom}`}>{STATUS_PM2[g.status]?.texto ?? g.status}</span>
                    </td>
                    <td className="num">{online ? bytes(mem) : "—"}</td>
                    <td className="num opc">{online ? `${cpu.toFixed(1).replace(".", ",")}%` : "—"}</td>
                    <td className={`num ${restarts >= 5 ? "tom-alerta" : ""}`}>{restarts}</td>
                    <td className="num opc">{online && desde ? duracao(agora - desde) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Dependencias({ audit, agora, onRodar }: { audit: Estado["audit"]; agora: number; onRodar: () => void }) {
  if (!audit)
    return (
      <section className="secao" aria-labelledby="t-dep">
        <h2 id="t-dep">Dependências</h2>
        <p className="vazio">
          A auditoria ainda não rodou.{" "}
          <button className="link" onClick={onRodar}>
            Rodar auditoria agora
          </button>
        </p>
      </section>
    );
  const gerado = Date.parse(audit.gerado_em);
  const projetos = [...audit.projetos].sort(
    (a, b) => vulneraveis(b, audit.nivel_minimo).length - vulneraveis(a, audit.nivel_minimo).length,
  );
  return (
    <section className="secao" aria-labelledby="t-dep">
      <div className="secao-cab">
        <h2 id="t-dep">Dependências</h2>
        <span className="secao-meta">npm audit, só produção, {ha(agora - gerado)}</span>
      </div>
      <ul className="projetos">
        {projetos.map((p) => {
          const vul = vulneraveis(p, audit.nivel_minimo);
          return (
            <li key={p.projeto} className="projeto">
              <div className="projeto-linha">
                <span className="projeto-nome">{p.projeto}</span>
                {p.erro ? (
                  <span className="selo tom-alerta">não auditado</span>
                ) : vul.length === 0 ? (
                  <span className="selo tom-ok">sem pendências</span>
                ) : (
                  <span className="selo tom-alerta">
                    {vul.length} {vul.length === 1 ? "vulnerável" : "vulneráveis"}
                  </span>
                )}
              </div>
              {vul.length > 0 && (
                <ul className="pacotes">
                  {vul
                    .sort((a, b) => (PESO_GRAVIDADE[b.gravidade] ?? 0) - (PESO_GRAVIDADE[a.gravidade] ?? 0))
                    .map((x) => (
                      <li key={x.nome}>
                        <code>{x.nome}</code>
                        <span className={`gravidade g-${x.gravidade}`}>{NOME_GRAVIDADE[x.gravidade] ?? x.gravidade}</span>
                        <span className="pacote-fix">
                          {x.correcao ? `corrige com ${x.correcao}` : "sem correção publicada"}
                          {!x.direta && " · via outra dependência"}
                        </span>
                      </li>
                    ))}
                </ul>
              )}
              {p.erro && <p className="pacote-fix">Sem package-lock.json ou sem acesso ao registro do npm.</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Tarefas({
  tarefas, execucoes, cron, erro, onRodar, onAbrir, tituloDe,
}: {
  tarefas: TarefaInfo[];
  execucoes: Registro[];
  cron: Estado["execucoes"];
  erro: string;
  onRodar: (id: string) => void;
  onAbrir: (id: string) => void;
  tituloDe: (id: string) => string;
}) {
  const recentes = execucoes.slice(0, 6);
  return (
    <section className="secao" aria-labelledby="t-tarefas">
      <h2 id="t-tarefas">Tarefas</h2>
      <ul className="tarefas">
        {tarefas.map((t) => {
          const viva = execucoes.find((x) => x.tarefa === t.id && x.status === "rodando");
          const doCron = t.id === "backup" ? cron.backup : t.id === "limpeza" ? cron.limpeza : null;
          return (
            <li key={t.id} className="tarefa">
              <div>
                <p className="tarefa-titulo">{t.titulo}</p>
                <p className="tarefa-desc">{t.descricao}</p>
                {doCron && (
                  <p className="tarefa-ultima">
                    Última: {(() => { const q = dataLog(doCron.quando); return q ? horario(q) : doCron.quando; })()} · {doCron.resumo.replace(/^Concluído: |^Total liberado: /, "")}
                  </p>
                )}
              </div>
              {viva ? (
                <button className="botao botao-rodando" onClick={() => onAbrir(viva.id)}>
                  Rodando…
                </button>
              ) : (
                <button className="botao" onClick={() => onRodar(t.id)}>
                  Rodar
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {erro && <p className="erro" role="alert">{erro}</p>}
      {recentes.length > 0 && (
        <>
          <h3 className="sub">Disparadas pelo painel</h3>
          <ul className="historico">
            {recentes.map((r) => (
              <li key={r.id}>
                <button className="historico-item" onClick={() => onAbrir(r.id)}>
                  <span className={`ponto tom-${tomExecucao(r.status)}`} aria-hidden />
                  <span className="historico-nome">{tituloDe(r.tarefa)}</span>
                  <span className="historico-quando">{horario(r.inicio)}</span>
                  <span className="sr-only">{textoExecucao(r.status)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export const tomExecucao = (s: Registro["status"]): Tom =>
  s === "ok" ? "ok" : s === "falha" ? "falha" : s === "rodando" ? "alerta" : "neutro";
export const textoExecucao = (s: Registro["status"]) =>
  ({ ok: "concluída", falha: "falhou", rodando: "rodando", interrompida: "interrompida" })[s];

function Backups({ bancos, agora, dir }: { bancos: Banco[]; agora: number; dir: string }) {
  const hoje = (new Date(agora).getDay() + 6) % 7; // 0 = segunda
  return (
    <section className="secao" aria-labelledby="t-backup">
      <h2 id="t-backup">Backups</h2>
      {bancos.length === 0 ? (
        <p className="vazio">Nenhum dump em {dir}. Rode o backup em Tarefas.</p>
      ) : (
        <ul className="bancos">
          {bancos.map((b) => {
            const atrasado = agora - b.ultimo > BACKUP_ATRASADO_H * 3600_000;
            return (
              <li key={`${b.tipo}/${b.nome}`} className="banco">
                <div className="banco-linha">
                  <span className="banco-nome">{b.nome}</span>
                  <span className={`banco-ultimo ${atrasado ? "tom-falha" : ""}`}>
                    {ha(agora - b.ultimo)} · {bytes(b.tamanho)}
                  </span>
                </div>
                <ol className="semana" aria-label={`Dumps de ${b.nome} na semana`}>
                  {DIAS.map((d, i) => (
                    <li
                      key={d}
                      className={`dia ${b.dias[i] ? "tem" : "falta"} ${i === hoje ? "hoje" : ""}`}
                      title={b.dias[i] ? `${DIAS_NOME[i]}: ${horario(b.dias[i]!)}` : `${DIAS_NOME[i]}: sem dump`}
                    >
                      <span className="dia-letra">{d}</span>
                      <span className="sr-only">{b.dias[i] ? "com dump" : "sem dump"}</span>
                    </li>
                  ))}
                </ol>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Discos({ discos, limite }: { discos: Estado["discos"]; limite: number }) {
  return (
    <section className="secao" aria-labelledby="t-disco">
      <h2 id="t-disco">Disco</h2>
      <ul className="discos">
        {discos.map((d) => {
          const tom: Tom = d.uso >= 95 ? "falha" : d.uso >= limite ? "alerta" : "ok";
          return (
            <li key={d.montagem} className="disco">
              <div className="disco-linha">
                <span className="disco-nome">{d.montagem}</span>
                <span className="disco-valor">
                  <strong className={`tom-${tom}`}>{d.uso}%</strong> · {bytes(d.livre)} livres
                </span>
              </div>
              <div
                className="medidor"
                role="meter"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={d.uso}
                aria-label={`Uso de ${d.montagem}`}
              >
                <span className={`medidor-uso tom-${tom}`} style={{ width: `${d.uso}%` }} />
                <span className="medidor-limite" style={{ left: `${limite}%` }} title={`Alerta a partir de ${limite}%`} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Servicos({ monitor, agora, onRodar }: { monitor: Estado["monitor"]; agora: number; onRodar: () => void }) {
  const itens = servicosDoMonitor(monitor);
  return (
    <section className="secao" aria-labelledby="t-serv">
      <div className="secao-cab">
        <h2 id="t-serv">Sites e serviços</h2>
        {monitor && <span className="secao-meta">checado {ha(agora - monitor.quando * 1000)}</span>}
      </div>
      {itens.length === 0 ? (
        <p className="vazio">
          Nenhuma checagem ainda.{" "}
          <button className="link" onClick={onRodar}>
            Checar agora
          </button>
        </p>
      ) : (
        <ul className="servicos">
          {itens.map((s) => (
            <li key={`${s.tipo}:${s.alvo}`} className="servico">
              <span className={`ponto tom-${s.tom}`} aria-hidden />
              <span className="servico-nome">{s.alvo}</span>
              <span className={`servico-valor tom-${s.tom}`}>{s.tom === "ok" ? "ok" : s.valor.toLowerCase()}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
