"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ArquivoLog, TipoLog } from "@/lib/logs";
import { BASE, bytes, horario } from "./formato";

// Mesmas opções aceitas por /api/logs
const LINHAS = [200, 500, 1000, 2000];
const INTERVALO = 3000;
const PARECE_ERRO = /\b(error|erro|exception|fatal|unhandled|ECONNREFUSED|ETIMEDOUT)\b/i;

const ABAS: { id: TipoLog; texto: string }[] = [
  { id: "erros", texto: "Erros" },
  { id: "saida", texto: "Saída" },
];

type Linha = { texto: string; cabecalho?: boolean };

export default function LogsApp({ app, onFechar }: { app: string; onFechar: () => void }) {
  const [tipo, setTipo] = useState<TipoLog>("erros");
  const [linhas, setLinhas] = useState(LINHAS[0]);
  const [acompanhar, setAcompanhar] = useState(true);
  const [filtro, setFiltro] = useState("");
  const [arquivos, setArquivos] = useState<ArquivoLog[] | null>(null);
  const [erro, setErro] = useState("");
  const caixa = useRef<HTMLPreElement>(null);
  const fechar = useRef<HTMLButtonElement>(null);
  const colado = useRef(true);

  useEffect(() => {
    fechar.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onFechar]);

  const buscar = useCallback(async () => {
    try {
      const q = new URLSearchParams({ app, tipo, linhas: String(linhas) });
      const r = await fetch(`${BASE}/api/logs?${q}`, { cache: "no-store" });
      if (r.status === 401) {
        window.location.href = `${BASE}/login`;
        return;
      }
      const j = (await r.json().catch(() => ({}))) as { arquivos?: ArquivoLog[]; erro?: string };
      if (!r.ok || !j.arquivos) {
        setErro(j.erro ?? "Não foi possível ler o log.");
        return;
      }
      setArquivos(j.arquivos);
      setErro("");
    } catch {
      setErro("Sem resposta do painel. Tentando de novo em instantes.");
    }
  }, [app, tipo, linhas]);

  // Troca de aba ou de quantidade: limpa a tela e volta a seguir o fim
  useEffect(() => {
    setArquivos(null);
    colado.current = true;
    buscar();
  }, [buscar]);

  useEffect(() => {
    if (!acompanhar) return;
    const t = setInterval(() => document.visibilityState === "visible" && buscar(), INTERVALO);
    return () => clearInterval(t);
  }, [acompanhar, buscar]);

  const todas = useMemo<Linha[]>(() => {
    if (!arquivos) return [];
    return arquivos.flatMap((a) => [
      ...(a.instancia !== null ? [{ texto: `── instância ${a.instancia} ──`, cabecalho: true }] : []),
      ...a.linhas.map((texto) => ({ texto })),
    ]);
  }, [arquivos]);

  const termo = filtro.trim().toLowerCase();
  const visiveis = termo ? todas.filter((l) => l.cabecalho || l.texto.toLowerCase().includes(termo)) : todas;
  const contagem = todas.filter((l) => !l.cabecalho).length;
  const achadas = visiveis.filter((l) => !l.cabecalho).length;
  const avisos = (arquivos ?? []).filter((a) => a.aviso);

  useEffect(() => {
    const el = caixa.current;
    if (el && colado.current) el.scrollTop = el.scrollHeight;
  }, [visiveis.length, arquivos]);

  return (
    <div className="gaveta-fundo" onClick={onFechar}>
      <section
        className="gaveta"
        role="dialog"
        aria-modal="true"
        aria-labelledby="logs-titulo"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="gaveta-topo">
          <div>
            <h2 id="logs-titulo">Logs de {app}</h2>
            <p className="gaveta-status">
              {arquivos?.map((a) => (
                <span key={a.caminho}>
                  <code>{a.caminho}</code>
                  {a.modificado !== null && ` · ${bytes(a.tamanho)} · gravado em ${horario(a.modificado)}`}
                </span>
              ))}
            </p>
          </div>
          <button ref={fechar} className="botao-leve" onClick={onFechar}>
            Fechar
          </button>
        </header>

        <div className="logs-barra">
          <div className="abas" role="tablist" aria-label="Tipo de log">
            {ABAS.map((a) => (
              <button
                key={a.id}
                role="tab"
                aria-selected={tipo === a.id}
                className={`aba ${tipo === a.id ? "ativa" : ""}`}
                onClick={() => setTipo(a.id)}
              >
                {a.texto}
              </button>
            ))}
          </div>
          <input
            className="logs-filtro"
            type="search"
            placeholder="Filtrar linhas"
            aria-label="Filtrar linhas"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
          />
          <label className="logs-opcao">
            Últimas
            <select value={linhas} onChange={(e) => setLinhas(Number(e.target.value))}>
              {LINHAS.map((n) => (
                <option key={n} value={n}>
                  {n.toLocaleString("pt-BR")}
                </option>
              ))}
            </select>
            linhas
          </label>
          <label className="logs-opcao">
            <input type="checkbox" checked={acompanhar} onChange={(e) => setAcompanhar(e.target.checked)} />
            Acompanhar
          </label>
        </div>

        {erro && <p className="erro" role="alert">{erro}</p>}
        {avisos.map((a) => (
          <p key={a.caminho} className="gaveta-nota">
            {a.aviso}
          </p>
        ))}

        <pre
          ref={caixa}
          className="log"
          tabIndex={0}
          aria-label={`Log de ${tipo === "erros" ? "erros" : "saída"} de ${app}`}
          onScroll={(e) => {
            const el = e.currentTarget;
            colado.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
        >
          {arquivos === null
            ? "Carregando…"
            : contagem === 0
              ? "Log vazio."
              : achadas === 0
                ? `Nenhuma linha com “${filtro.trim()}”.`
                : visiveis.map((l, i) => (
                    <span
                      key={i}
                      className={l.cabecalho ? "log-cab" : PARECE_ERRO.test(l.texto) ? "log-erro" : undefined}
                    >
                      {l.texto}
                      {"\n"}
                    </span>
                  ))}
        </pre>
        {termo && contagem > 0 && (
          <p className="gaveta-nota" aria-live="polite">
            {achadas.toLocaleString("pt-BR")} de {contagem.toLocaleString("pt-BR")} linhas
          </p>
        )}
      </section>
    </div>
  );
}
