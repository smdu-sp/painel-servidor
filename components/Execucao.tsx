"use client";

import { useEffect, useRef, useState } from "react";
import type { Registro } from "@/lib/tarefas";
import { BASE, duracao } from "./formato";

const TEXTO: Record<Registro["status"], string> = {
  rodando: "Rodando",
  ok: "Concluída",
  falha: "Falhou",
  interrompida: "Interrompida",
};

export default function Execucao({
  registro, titulo, onFechar, onFim,
}: {
  registro: Registro;
  titulo: string;
  onFechar: () => void;
  onFim: () => void;
}) {
  const [atual, setAtual] = useState(registro);
  const [log, setLog] = useState("");
  const caixa = useRef<HTMLPreElement>(null);
  const fechar = useRef<HTMLButtonElement>(null);
  const colado = useRef(true);

  useEffect(() => {
    fechar.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onFechar]);

  useEffect(() => {
    let vivo = true;
    let timer: ReturnType<typeof setTimeout>;
    async function buscar() {
      try {
        const r = await fetch(`${BASE}/api/tarefas/${registro.id}`, { cache: "no-store" });
        if (r.ok) {
          const j = (await r.json()) as { registro: Registro; log: string };
          if (!vivo) return;
          setLog(j.log);
          setAtual(j.registro);
          if (j.registro.status !== "rodando") {
            onFim();
            return;
          }
        }
      } catch {
        /* tenta de novo */
      }
      if (vivo) timer = setTimeout(buscar, 1000);
    }
    buscar();
    return () => {
      vivo = false;
      clearTimeout(timer);
    };
  }, [registro.id, onFim]);

  useEffect(() => {
    const el = caixa.current;
    if (el && colado.current) el.scrollTop = el.scrollHeight;
  }, [log]);

  const tempo = (atual.fim ?? Date.now()) - atual.inicio;

  return (
    <div className="gaveta-fundo" onClick={onFechar}>
      <section
        className="gaveta"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gaveta-titulo"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="gaveta-topo">
          <div>
            <h2 id="gaveta-titulo">{titulo}</h2>
            <p className="gaveta-status" aria-live="polite">
              <span className={`selo tom-${atual.status === "ok" ? "ok" : atual.status === "falha" ? "falha" : atual.status === "rodando" ? "alerta" : "neutro"}`}>
                {TEXTO[atual.status]}
              </span>
              <span>
                {new Date(atual.inicio).toLocaleTimeString("pt-BR")} · {duracao(tempo) === "0 min" ? `${Math.round(tempo / 1000)} s` : duracao(tempo)}
                {atual.codigo !== null && atual.status === "falha" ? ` · código ${atual.codigo}` : ""}
              </span>
            </p>
          </div>
          <button ref={fechar} className="botao-leve" onClick={onFechar}>
            Fechar
          </button>
        </header>
        <pre
          ref={caixa}
          className="log"
          tabIndex={0}
          aria-label="Saída da tarefa"
          onScroll={(e) => {
            const el = e.currentTarget;
            colado.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
        >
          {log || (atual.status === "rodando" ? "Aguardando a saída do script…" : "Sem saída registrada.")}
        </pre>
        {atual.status === "interrompida" && (
          <p className="gaveta-nota">
            O painel reiniciou enquanto esta tarefa rodava. Confira o resultado no log em /var/log/server-scripts/.
          </p>
        )}
      </section>
    </div>
  );
}
