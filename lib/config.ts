import path from "node:path";

export const config = {
  senha: process.env.PAINEL_SENHA ?? "",
  segredo: process.env.PAINEL_SEGREDO ?? "",
  scriptsDir: process.env.PAINEL_SCRIPTS_DIR ?? "/opt/server-scripts",
  usarSudo: (process.env.PAINEL_SUDO ?? "1") === "1",
  dadosDir: path.resolve(/*turbopackIgnore: true*/ process.env.PAINEL_DADOS_DIR ?? "./dados"),
  sessaoHoras: Number(process.env.PAINEL_SESSAO_HORAS ?? 12),
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
};

/** Tarefas que o painel pode disparar. Nada fora desta lista é executado. */
export const TAREFAS = {
  backup: {
    titulo: "Backup dos bancos",
    descricao: "Gera o dump de cada banco do dia de hoje.",
    script: "backup-bancos.sh",
    args: [] as string[],
  },
  limpeza: {
    titulo: "Limpeza do www",
    descricao: "Apaga cache de build e logs antigos dos projetos.",
    script: "limpar-www.sh",
    args: [] as string[],
  },
  audit: {
    titulo: "Auditoria de dependências",
    descricao: "Roda o npm audit nas dependências de produção.",
    script: "monitorar.sh",
    args: ["--audit"],
  },
  disco: {
    titulo: "Analisar disco",
    descricao: "Mede as pastas e procura o que mais ocupa espaço. Leva alguns minutos.",
    script: "analisar-disco.sh",
    args: [] as string[],
  },
  monitor: {
    titulo: "Checar sites e serviços",
    descricao: "Testa os sites, o Apache, o banco e o disco agora.",
    script: "monitorar.sh",
    args: [] as string[],
  },
} as const;

export type IdTarefa = keyof typeof TAREFAS;

export function ehTarefa(id: string): id is IdTarefa {
  return Object.prototype.hasOwnProperty.call(TAREFAS, id);
}

export function comando(script: string, args: readonly string[]): [string, string[]] {
  const caminho = path.join(/*turbopackIgnore: true*/ config.scriptsDir, script);
  return config.usarSudo ? ["sudo", ["-n", caminho, ...args]] : [caminho, [...args]];
}
