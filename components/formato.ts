export const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function bytes(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1).replace(".", ",")} ${u[i]}`;
}

/** "há 3 min", "há 2 h", "há 4 dias" */
export function ha(msAtras: number) {
  const s = Math.max(0, Math.round(msAtras / 1000));
  if (s < 60) return "agora";
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
}

/** Duração de um app no ar: "3 d 4 h", "5 h 12 min" */
export function duracao(ms: number) {
  const min = Math.max(0, Math.floor(ms / 60000));
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

export function horario(ms: number) {
  return new Date(ms).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** "2026-10-28 17:43:24" (horário do servidor) -> ms */
export function dataLog(s: string) {
  const t = Date.parse(s.replace(" ", "T"));
  return Number.isNaN(t) ? null : t;
}

export const STATUS_PM2: Record<string, { texto: string; tom: Tom }> = {
  online: { texto: "no ar", tom: "ok" },
  stopped: { texto: "parado", tom: "falha" },
  errored: { texto: "com erro", tom: "falha" },
  launching: { texto: "iniciando", tom: "alerta" },
  stopping: { texto: "parando", tom: "alerta" },
  "waiting restart": { texto: "reiniciando", tom: "alerta" },
  "one-launch-status": { texto: "rodou uma vez", tom: "neutro" },
};

export type Tom = "ok" | "alerta" | "falha" | "neutro";

export const PESO_GRAVIDADE: Record<string, number> = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
export const NOME_GRAVIDADE: Record<string, string> = {
  critical: "crítica",
  high: "alta",
  moderate: "moderada",
  low: "baixa",
  info: "info",
};
