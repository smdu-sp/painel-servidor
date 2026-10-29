import { NextResponse } from "next/server";
import { logado } from "@/lib/auth";
import { LINHAS_OPCOES, ehTipoLog, lerLogApp } from "@/lib/logs";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await logado())) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const app = q.get("app") ?? "";
  const tipo = q.get("tipo") ?? "erros";
  const pedidas = Number(q.get("linhas"));
  const linhas = LINHAS_OPCOES.find((n) => n === pedidas) ?? LINHAS_OPCOES[0];
  if (!app || app.length > 200) return NextResponse.json({ erro: "Informe o app." }, { status: 400 });
  if (!ehTipoLog(tipo)) return NextResponse.json({ erro: "Tipo de log desconhecido." }, { status: 400 });

  const r = await lerLogApp(app, tipo, linhas);
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status });
  return NextResponse.json({ arquivos: r.arquivos });
}
