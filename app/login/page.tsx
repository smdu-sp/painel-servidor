import { redirect } from "next/navigation";
import { logado } from "@/lib/auth";
import FormLogin from "@/components/FormLogin";

export const dynamic = "force-dynamic";

export default async function Login() {
  if (await logado()) redirect("/");
  return (
    <main className="login">
      <div className="login-caixa">
        <h1 className="login-titulo">Painel do servidor</h1>
        <p className="login-texto">Status dos apps, backups e tarefas de manutenção.</p>
        <FormLogin />
      </div>
    </main>
  );
}
