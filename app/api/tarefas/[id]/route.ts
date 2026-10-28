import { NextResponse } from "next/server";
import { logado } from "@/lib/auth";
import { detalhe } from "@/lib/tarefas";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await logado())) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  const { id } = await params;
  const d = detalhe(id);
  if (!d) return NextResponse.json({ erro: "Execução não encontrada." }, { status: 404 });
  return NextResponse.json(d);
}
