"use client";

import { useMemo, useState } from "react";
import type { DiscoAnalise } from "@/lib/dados";
import type { Registro } from "@/lib/tarefas";
import { bytes, ha } from "./formato";

const MIN_SUSPEITO = 10 * 1024 * 1024;

function pai(caminho: string) {
  const i = caminho.lastIndexOf("/");
  return i <= 0 ? "/" : caminho.slice(0, i);
}

function nome(caminho: string, base: string) {
  const rel = caminho.slice(base === "/" ? 1 : base.length + 1);
  return rel || caminho;
}

/** Copia texto mesmo em http:// (onde navigator.clipboard não existe) */
function copiar(texto: string) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(texto);
  const t = document.createElement("textarea");
  t.value = texto;
  t.style.position = "fixed";
  t.style.opacity = "0";
  document.body.appendChild(t);
  t.select();
  document.execCommand("copy");
  t.remove();
  return Promise.resolve();
}

function Comando({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="comando">
      <code>{texto}</code>
      <button
        className="botao-leve botao-mini"
        onClick={() => copiar(texto).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 1500); })}
      >
        {copiado ? "Copiado" : "Copiar"}
      </button>
    </div>
  );
}

export default function AnaliseDisco({
  analise, agora, rodando, onRodar, onAbrir,
}: {
  analise: DiscoAnalise | null;
  agora: number;
  rodando: Registro | null;
  onRodar: () => void;
  onAbrir: (id: string) => void;
}) {
  const montagens = useMemo(
    () => (analise ? [...new Set(analise.pastas.map((p) => p.montagem))] : []),
    [analise],
  );
  const [montagem, setMontagem] = useState<string | null>(null);
  const [atual, setAtual] = useState<string | null>(null);
  const m = montagem && montagens.includes(montagem) ? montagem : (montagens.includes("/") ? "/" : montagens[0]);
  const base = atual && atual.startsWith(m ?? "") ? atual : m;

  const acao = rodando ? (
    <button className="botao botao-rodando" onClick={() => onAbrir(rodando.id)}>
      Analisando…
    </button>
  ) : (
    <button className="botao" onClick={onRodar}>
      {analise ? "Analisar de novo" : "Analisar agora"}
    </button>
  );

  if (!analise || !m || !base) {
    return (
      <section className="secao" aria-labelledby="t-analise">
        <div className="secao-cab">
          <h2 id="t-analise">Para onde vai o espaço</h2>
          {acao}
        </div>
        <p className="vazio">
          Ainda não há análise. Ela mede as pastas do disco e confere os lugares que costumam crescer sem ninguém ver.
        </p>
      </section>
    );
  }

  const pastasM = analise.pastas.filter((p) => p.montagem === m);
  const raiz = pastasM.find((p) => p.caminho === m);
  const part = analise.particoes.find((p) => p.montagem === m);
  const noAtual = pastasM.find((p) => p.caminho === base) ?? raiz;
  const filhos = pastasM
    .filter((p) => p.caminho !== base && pai(p.caminho) === base)
    .sort((a, b) => b.bytes - a.bytes);
  const temFilhos = (c: string) => pastasM.some((p) => p.caminho !== c && pai(p.caminho) === c);
  const somaFilhos = filhos.reduce((s, f) => s + f.bytes, 0);
  const resto = (noAtual?.bytes ?? 0) - somaFilhos;
  const naoAchado = part && raiz ? part.usado - raiz.bytes : 0;

  const migalhas: string[] = [];
  for (let c = base; ; c = pai(c)) {
    migalhas.unshift(c);
    if (c === m || c === "/") break;
  }

  const suspeitos = analise.suspeitos.filter((s) => s.bytes >= MIN_SUSPEITO);
  const arquivos = analise.arquivos.filter((a) => m === "/" || a.caminho.startsWith(m)).slice(0, 10);

  return (
    <section className="secao" aria-labelledby="t-analise">
      <div className="secao-cab">
        <h2 id="t-analise">Para onde vai o espaço</h2>
        {acao}
      </div>
      <p className="secao-meta analise-meta">
        Análise {ha(agora - analise.gerado_em * 1000)}, levou {analise.duracao} s.
        {part && ` Em ${m}: ${bytes(part.usado)} usados de ${bytes(part.tamanho)}, ${bytes(part.livre)} livres.`}
      </p>

      {montagens.length > 1 && (
        <div className="abas" role="tablist" aria-label="Partição">
          {montagens.map((x) => (
            <button
              key={x}
              role="tab"
              aria-selected={x === m}
              className={`aba ${x === m ? "ativa" : ""}`}
              onClick={() => { setMontagem(x); setAtual(null); }}
            >
              {x}
            </button>
          ))}
        </div>
      )}

      {suspeitos.length > 0 && (
        <>
          <h3 className="sub">Suspeitos de sempre</h3>
          <ul className="suspeitos">
            {suspeitos.map((s) => (
              <li key={s.id} className="suspeito">
                <div className="suspeito-linha">
                  <span className="suspeito-nome">{s.titulo}</span>
                  <strong className="suspeito-tam">{bytes(s.bytes)}</strong>
                </div>
                <p className="suspeito-exp">{s.explicacao}</p>
                {s.id === "mysql-dados" && analise.bancos.length > 0 && (
                  <ul className="sublista">
                    {analise.bancos.slice(0, 8).map((b) => (
                      <li key={b.banco}>
                        <span>{b.banco}</span>
                        <span>{bytes(b.bytes)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {s.id === "apagados" && analise.apagados.length > 0 && (
                  <ul className="sublista">
                    {analise.apagados.map((a) => (
                      <li key={`${a.pid}${a.arquivo}`}>
                        <span>
                          <code>{a.processo}</code> (pid {a.pid}) segura <code>{a.arquivo}</code>
                        </span>
                        <span>{bytes(a.bytes)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {s.comando && <Comando texto={s.comando} />}
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="sub">Pastas</h3>
      <nav className="migalhas" aria-label="Pasta atual">
        {migalhas.map((c, i) => (
          <span key={c}>
            {i > 1 && <span aria-hidden>/</span>}
            {c === base ? (
              <strong>{i === 0 ? c : nome(c, pai(c))}</strong>
            ) : (
              <button className="link" onClick={() => setAtual(c)}>
                {i === 0 ? c : nome(c, pai(c))}
              </button>
            )}
          </span>
        ))}
        {noAtual && <span className="migalhas-tam"> · {bytes(noAtual.bytes)}</span>}
      </nav>
      {filhos.length === 0 ? (
        <p className="vazio">Nenhuma subpasta com mais de 50 MB aqui.</p>
      ) : (
        <ul className="pastas">
          {filhos.map((f) => {
            const pct = noAtual?.bytes ? (f.bytes / noAtual.bytes) * 100 : 0;
            const abre = temFilhos(f.caminho);
            const conteudo = (
              <>
                <span className="pasta-nome">{nome(f.caminho, base)}</span>
                <span className="pasta-barra" aria-hidden>
                  <span style={{ width: `${Math.max(pct, 0.5)}%` }} />
                </span>
                <span className="pasta-tam">{bytes(f.bytes)}</span>
                <span className="pasta-pct">{pct >= 1 ? `${Math.round(pct)}%` : "<1%"}</span>
              </>
            );
            return (
              <li key={f.caminho}>
                {abre ? (
                  <button className="pasta" onClick={() => setAtual(f.caminho)} aria-label={`Abrir ${f.caminho}, ${bytes(f.bytes)}`}>
                    {conteudo}
                  </button>
                ) : (
                  <div className="pasta pasta-fim">{conteudo}</div>
                )}
              </li>
            );
          })}
          {resto > 50 * 1024 * 1024 && (
            <li>
              <div className="pasta pasta-fim pasta-resto">
                <span className="pasta-nome">arquivos soltos e pastas menores</span>
                <span className="pasta-barra" aria-hidden><span style={{ width: `${(resto / (noAtual?.bytes || 1)) * 100}%` }} /></span>
                <span className="pasta-tam">{bytes(resto)}</span>
                <span className="pasta-pct" />
              </div>
            </li>
          )}
        </ul>
      )}
      {base === m && naoAchado > 1024 ** 3 && (
        <p className="nota">
          {bytes(naoAchado)} estão em uso no disco mas não aparecem em nenhuma pasta. Normalmente são arquivos apagados que
          um processo ainda mantém abertos (veja nos suspeitos) ou o espaço reservado do sistema.
        </p>
      )}

      {arquivos.length > 0 && (
        <>
          <h3 className="sub">Maiores arquivos</h3>
          <ul className="arquivos">
            {arquivos.map((a) => (
              <li key={a.caminho}>
                <code className="arquivo-caminho">{a.caminho}</code>
                <span className="arquivo-info">
                  <strong>{bytes(a.bytes)}</strong> · alterado {ha(agora - a.modificado * 1000)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
