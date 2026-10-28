import { NextResponse } from "next/server";
import { COOKIE, acessoSeguro, configuracaoOk, novoToken, opcoesCookie, senhaConfere } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Freio simples contra tentativa de senha em massa
const g = globalThis as unknown as { __painelFalhas?: { n: number; ate: number } };
const falhas = (g.__painelFalhas ??= { n: 0, ate: 0 });

export async function POST(req: Request) {
  if (!configuracaoOk()) {
    return NextResponse.json(
      { erro: "O painel não está configurado: defina PAINEL_SENHA (8+ caracteres) e PAINEL_SEGREDO no .env.local." },
      { status: 500 },
    );
  }
  if (Date.now() < falhas.ate) {
    return NextResponse.json({ erro: "Muitas tentativas erradas. Espere um minuto e tente de novo." }, { status: 429 });
  }

  const corpo = (await req.json().catch(() => ({}))) as { senha?: unknown };
  const senha = typeof corpo.senha === "string" ? corpo.senha : "";

  if (!senhaConfere(senha)) {
    falhas.n += 1;
    if (falhas.n >= 5) {
      falhas.n = 0;
      falhas.ate = Date.now() + 60_000;
    }
    await new Promise((r) => setTimeout(r, 800));
    return NextResponse.json({ erro: "Senha incorreta." }, { status: 401 });
  }

  falhas.n = 0;
  const { valor, expira } = novoToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, valor, opcoesCookie(expira, acessoSeguro(req)));
  return res;
}
