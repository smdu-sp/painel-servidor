"use client";

import { useState } from "react";
import { BASE } from "./formato";

export default function FormLogin() {
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErro("");
    try {
      const r = await fetch(`${BASE}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senha }),
      });
      if (r.ok) {
        window.location.href = `${BASE}/`;
        return;
      }
      const j = await r.json().catch(() => ({}));
      setErro(j.erro ?? "Não foi possível entrar.");
    } catch {
      setErro("Sem resposta do servidor. Confira a conexão e tente de novo.");
    }
    setEnviando(false);
  }

  return (
    <form onSubmit={entrar} className="login-form">
      <label htmlFor="senha">Senha</label>
      <input
        id="senha"
        type="password"
        autoComplete="current-password"
        autoFocus
        value={senha}
        onChange={(e) => setSenha(e.target.value)}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? "erro-login" : undefined}
      />
      {erro && (
        <p id="erro-login" className="erro" role="alert">
          {erro}
        </p>
      )}
      <button type="submit" className="botao" disabled={enviando || !senha}>
        {enviando ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
