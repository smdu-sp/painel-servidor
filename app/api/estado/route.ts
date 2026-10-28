import { NextResponse } from "next/server";
import { logado } from "@/lib/auth";
import { lerEstado } from "@/lib/dados";
import { historico } from "@/lib/tarefas";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await logado())) return NextResponse.json({ erro: "Sessão expirada." }, { status: 401 });
  const resultado = await lerEstado();
  return NextResponse.json({ ...resultado, execucoesPainel: historico() });
}
