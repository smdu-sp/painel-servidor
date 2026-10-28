import { execFile } from "node:child_process";
import { comando } from "./config";

export type AppPm2 = {
  nome: string;
  id: number;
  status: string;
  restarts: number;
  memoria: number;
  cpu: number;
  desde: number | null;
  modo: string;
  pasta: string;
};

export type Disco = { montagem: string; tamanho: number; usado: number; livre: number; uso: number };
export type ArquivoBackup = { arquivo: string; tamanho: number; modificado: number };
export type PacoteVulneravel = { nome: string; gravidade: string; direta: boolean; correcao: string | null };
export type ProjetoAudit = {
  projeto: string;
  erro: boolean;
  contagem?: Record<"info" | "low" | "moderate" | "high" | "critical" | "total", number>;
  pacotes?: PacoteVulneravel[];
};
export type Execucao = { quando: string; resumo: string } | null;

export type DiscoAnalise = {
  gerado_em: number;
  duracao: number;
  particoes: { montagem: string; tamanho: number; usado: number; livre: number }[];
  pastas: { montagem: string; bytes: number; caminho: string }[];
  arquivos: { bytes: number; modificado: number; caminho: string }[];
  suspeitos: { id: string; titulo: string; bytes: number; explicacao: string; comando: string }[];
  bancos: { banco: string; bytes: number }[];
  apagados: { bytes: number; pid: string; processo: string; arquivo: string }[];
};

export type Estado = {
  host: string;
  agora: number;
  pm2: AppPm2[] | null;
  discos: Disco[];
  disco_limite: number;
  backups: { dir: string; arquivos: ArquivoBackup[] };
  monitor: { quando: number; itens: { chave: string; valor: string }[] } | null;
  audit: { gerado_em: string; nivel_minimo: string; projetos: ProjetoAudit[] } | null;
  execucoes: { backup: Execucao; limpeza: Execucao };
  disco_analise: DiscoAnalise | null;
};

export type Resultado = { ok: true; estado: Estado } | { ok: false; erro: string };

/** Roda o coletor (painel-dados.sh) e devolve o estado do servidor. */
export function lerEstado(): Promise<Resultado> {
  const [cmd, args] = comando("painel-dados.sh", []);
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 20_000, maxBuffer: 10 * 1024 * 1024 }, (erro, saida, stderr) => {
      if (erro) {
        const motivo = /password is required|a terminal is required|interactive authentication/.test(stderr)
          ? "O sudo pediu senha: confira a regra do painel em /etc/sudoers.d/painel."
          : `O coletor de dados falhou: ${(stderr || erro.message).trim().slice(0, 300)}`;
        return resolve({ ok: false, erro: motivo });
      }
      try {
        resolve({ ok: true, estado: JSON.parse(saida) as Estado });
      } catch {
        resolve({ ok: false, erro: "O coletor de dados respondeu algo que não é JSON." });
      }
    });
  });
}
