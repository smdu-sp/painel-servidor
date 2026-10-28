import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { TAREFAS, comando, config, type IdTarefa } from "./config";

export type StatusExecucao = "rodando" | "ok" | "falha" | "interrompida";

export type Registro = {
  id: string;
  tarefa: IdTarefa;
  inicio: number;
  fim: number | null;
  codigo: number | null;
  status: StatusExecucao;
};

const MAX_HISTORICO = 60;
const MAX_LOG = 256 * 1024;

const dirLogs = () => path.join(config.dadosDir, "logs");
const arqHistorico = () => path.join(config.dadosDir, "execucoes.json");

// Execuções vivas deste processo (o histórico em disco sobrevive a reinícios do painel)
const g = globalThis as unknown as { __painelVivas?: Set<string> };
const vivas = (g.__painelVivas ??= new Set<string>());

function lerHistorico(): Registro[] {
  try {
    const lista = JSON.parse(fs.readFileSync(arqHistorico(), "utf8")) as Registro[];
    // Algo marcado como "rodando" que não está vivo aqui foi cortado por um reinício do painel
    return lista.map((r) => (r.status === "rodando" && !vivas.has(r.id) ? { ...r, status: "interrompida" } : r));
  } catch {
    return [];
  }
}

function gravarHistorico(lista: Registro[]) {
  fs.mkdirSync(config.dadosDir, { recursive: true });
  const tmp = `${arqHistorico()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(lista.slice(0, MAX_HISTORICO), null, 1));
  fs.renameSync(tmp, arqHistorico());
}

function atualizar(id: string, mudanca: Partial<Registro>) {
  gravarHistorico(lerHistorico().map((r) => (r.id === id ? { ...r, ...mudanca } : r)));
}

export function historico() {
  return lerHistorico();
}

export function iniciar(tarefa: IdTarefa): { ok: true; registro: Registro } | { ok: false; erro: string } {
  const atual = lerHistorico();
  const emAndamento = atual.find((r) => r.tarefa === tarefa && r.status === "rodando");
  if (emAndamento) return { ok: false, erro: `${TAREFAS[tarefa].titulo} já está rodando.` };

  const def = TAREFAS[tarefa];
  const id = `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  const registro: Registro = { id, tarefa, inicio: Date.now(), fim: null, codigo: null, status: "rodando" };

  fs.mkdirSync(dirLogs(), { recursive: true });
  const log = fs.createWriteStream(path.join(dirLogs(), `${id}.log`));
  const [cmd, args] = comando(def.script, def.args);

  gravarHistorico([registro, ...atual]);
  vivas.add(id);

  const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
  proc.stdout.pipe(log, { end: false });
  proc.stderr.pipe(log, { end: false });

  const terminar = (codigo: number | null, erroInicio?: string) => {
    if (!vivas.has(id)) return;
    vivas.delete(id);
    if (erroInicio) log.write(`\nNão foi possível iniciar: ${erroInicio}\n`);
    log.end();
    atualizar(id, { fim: Date.now(), codigo, status: codigo === 0 ? "ok" : "falha" });
  };
  proc.on("error", (e) => terminar(null, e.message));
  proc.on("close", (codigo) => terminar(codigo));

  return { ok: true, registro };
}

export function detalhe(id: string): { registro: Registro; log: string } | null {
  if (!/^[a-z0-9-]+$/.test(id)) return null;
  const registro = lerHistorico().find((r) => r.id === id);
  if (!registro) return null;
  let log = "";
  try {
    const arq = path.join(dirLogs(), `${id}.log`);
    const { size } = fs.statSync(arq);
    const fd = fs.openSync(arq, "r");
    const inicio = Math.max(0, size - MAX_LOG);
    const buf = Buffer.alloc(size - inicio);
    fs.readSync(fd, buf, 0, buf.length, inicio);
    fs.closeSync(fd);
    log = (inicio > 0 ? "…(início do log cortado)\n" : "") + buf.toString("utf8");
  } catch {
    /* sem log ainda */
  }
  return { registro, log };
}
