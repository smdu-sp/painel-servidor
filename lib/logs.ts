import { open, stat } from "node:fs/promises";
import { userInfo } from "node:os";
import { estadoRecente } from "./dados";

export type TipoLog = "saida" | "erros";

export type ArquivoLog = {
  caminho: string;
  instancia: number | null; // preenchido quando cada instância do cluster tem o próprio arquivo
  tamanho: number;
  modificado: number | null;
  linhas: string[];
  aviso: string | null;
};

export type RespostaLog = { ok: true; arquivos: ArquivoLog[] } | { ok: false; erro: string; status: number };

export const LINHAS_OPCOES = [200, 500, 1000, 2000] as const;

// Lê só o fim do arquivo: os logs do PM2 podem ter centenas de MB
const MAX_BYTES = 2 * 1024 * 1024;
// Cores e movimentos de cursor que alguns apps (Nest, Next) escrevem no log
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

export function ehTipoLog(t: string): t is TipoLog {
  return t === "saida" || t === "erros";
}

/**
 * Últimas linhas do log de um app do PM2. O caminho nunca vem de quem pede:
 * sai do `pm2 jlist` (via coletor), procurando o app pelo nome.
 */
export async function lerLogApp(app: string, tipo: TipoLog, linhas: number): Promise<RespostaLog> {
  const r = await estadoRecente();
  if (!r.ok) return { ok: false, erro: r.erro, status: 502 };
  const instancias = (r.estado.pm2 ?? []).filter((a) => a.nome === app);
  if (instancias.length === 0) return { ok: false, erro: "App não encontrado no PM2.", status: 404 };

  const campo = tipo === "saida" ? "log_saida" : "log_erros";
  const caminhos = new Map<string, number>();
  for (const i of instancias) {
    const c = i[campo];
    if (c && c.startsWith("/") && !caminhos.has(c)) caminhos.set(c, i.id);
  }
  if (caminhos.size === 0)
    return { ok: false, erro: "O PM2 não informou o arquivo de log deste app (atualize o painel no servidor).", status: 404 };

  const varios = caminhos.size > 1;
  const arquivos = await Promise.all(
    [...caminhos].map(([caminho, id]) => lerFim(caminho, linhas).then((a) => ({ ...a, instancia: varios ? id : null }))),
  );
  return { ok: true, arquivos };
}

async function lerFim(caminho: string, linhas: number): Promise<Omit<ArquivoLog, "instancia">> {
  const vazio = { caminho, tamanho: 0, modificado: null, linhas: [] as string[] };
  try {
    const st = await stat(caminho);
    if (!st.isFile()) return { ...vazio, aviso: "Não é um arquivo comum (ex.: /dev/null): este app não grava log." };
    const inicio = Math.max(0, st.size - MAX_BYTES);
    const f = await open(caminho, "r");
    let texto: string;
    try {
      const buf = Buffer.alloc(st.size - inicio);
      const { bytesRead } = await f.read(buf, 0, buf.length, inicio);
      texto = buf.subarray(0, bytesRead).toString("utf8");
    } finally {
      await f.close();
    }
    let lista = texto.replace(ANSI, "").split(/\r?\n/);
    if (inicio > 0) lista.shift(); // a primeira linha veio cortada no meio
    if (lista.at(-1) === "") lista.pop();
    lista = lista.slice(-linhas);
    return { caminho, tamanho: st.size, modificado: st.mtimeMs, linhas: lista, aviso: null };
  } catch (e) {
    const cod = (e as NodeJS.ErrnoException).code;
    if (cod === "ENOENT") return { ...vazio, aviso: "O arquivo ainda não existe: o app não escreveu nada aqui desde a última limpeza." };
    if (cod === "EACCES")
      return {
        ...vazio,
        aviso: `O painel roda como ${userInfo().username} e não tem permissão para ler este arquivo. Ele precisa rodar no PM2 do mesmo usuário dos apps.`,
      };
    return { ...vazio, aviso: `Não consegui ler o arquivo (${cod ?? "erro desconhecido"}).` };
  }
}
