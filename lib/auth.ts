import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { config } from "./config";

export const COOKIE = "painel_sessao";

function assinar(valor: string) {
  return createHmac("sha256", config.segredo).update(valor).digest("hex");
}

function iguais(a: string, b: string) {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function configuracaoOk() {
  return config.senha.length >= 8 && config.segredo.length >= 32;
}

export function senhaConfere(tentativa: string) {
  return configuracaoOk() && iguais(tentativa, config.senha);
}

export function novoToken() {
  const expira = Date.now() + config.sessaoHoras * 3600_000;
  return { valor: `${expira}.${assinar(String(expira))}`, expira };
}

export function tokenValido(token: string | undefined) {
  if (!token || !configuracaoOk()) return false;
  const [expira, assinatura] = token.split(".");
  if (!expira || !assinatura) return false;
  if (!iguais(assinatura, assinar(expira))) return false;
  return Number(expira) > Date.now();
}

/** Para páginas e rotas: true se a pessoa está logada. */
export async function logado() {
  const c = await cookies();
  return tokenValido(c.get(COOKIE)?.value);
}

/** Cookie "secure" só quando o acesso é por HTTPS (PAINEL_COOKIE_SEGURO=1/0 força). */
export function acessoSeguro(req: Request) {
  const forcar = process.env.PAINEL_COOKIE_SEGURO;
  if (forcar === "1") return true;
  if (forcar === "0") return false;
  return req.headers.get("x-forwarded-proto") === "https" || new URL(req.url).protocol === "https:";
}

export const opcoesCookie = (expira: number, seguro: boolean) => ({
  httpOnly: true,
  sameSite: "strict" as const,
  secure: seguro,
  path: config.basePath || "/",
  expires: new Date(expira),
});
