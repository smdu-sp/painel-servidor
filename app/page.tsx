import { redirect } from "next/navigation";
import { logado } from "@/lib/auth";
import { lerEstado } from "@/lib/dados";
import { historico } from "@/lib/tarefas";
import { TAREFAS } from "@/lib/config";
import Painel from "@/components/Painel";

export const dynamic = "force-dynamic";

export default async function Inicio() {
  if (!(await logado())) redirect("/login");
  const resultado = await lerEstado();
  const tarefas = Object.entries(TAREFAS).map(([id, t]) => ({ id, titulo: t.titulo, descricao: t.descricao }));
  return <Painel inicial={{ ...resultado, execucoesPainel: historico() }} tarefas={tarefas} carregadoEm={Date.now()} />;
}
