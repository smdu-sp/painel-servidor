import { NextResponse } from "next/server";
import { logado } from "@/lib/auth";
import { ehTarefa } from "@/lib/config";
import { historico, iniciar } from "@/lib/tarefas";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await logado())) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  return NextResponse.json({ execucoes: historico() });
}

export async function POST(req: Request) {
  if (!(await logado())) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  const corpo = (await req.json().catch(() => ({}))) as { tarefa?: unknown };
  const tarefa = typeof corpo.tarefa === "string" ? corpo.tarefa : "";
  if (!ehTarefa(tarefa)) return NextResponse.json({ erro: "Tarefa desconhecida." }, { status: 400 });

  const r = iniciar(tarefa);
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: 409 });
  return NextResponse.json({ registro: r.registro }, { status: 201 });
}
