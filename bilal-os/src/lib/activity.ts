import { q } from "./db";

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Never write secrets into logs: redact anything that looks like a key or password. */
export function redact<T>(data: T): T {
  if (data == null) return data;
  const json = JSON.stringify(data, (k, v) =>
    /pass(word)?|secret|token|api[_-]?key|authorization|cookie/i.test(k) ? "[redacted]" : v,
  );
  return JSON.parse(json.replace(/sk-ant-[A-Za-z0-9_-]+/g, "sk-ant-[redacted]").replace(/\d{8,10}:[A-Za-z0-9_-]{30,}/g, "[redacted-bot-token]"));
}

export async function logActivity(entry: {
  sectorId?: string | null; agentId?: string | null; runId?: number | null;
  level?: LogLevel; message: string; data?: unknown;
}): Promise<void> {
  const message = redact(entry.message);
  await q(
    "INSERT INTO activity_log (sector_id, agent_id, run_id, level, message, data) VALUES ($1,$2,$3,$4,$5,$6)",
    [entry.sectorId ?? null, entry.agentId ?? null, entry.runId ?? null, entry.level ?? "info", message, entry.data === undefined ? null : JSON.stringify(redact(entry.data))],
  ).catch((e) => console.error("[activity] failed to write log", e.message));
  if (entry.level === "error" || entry.level === "warn") console.warn(`[${entry.agentId ?? entry.sectorId ?? "system"}] ${message}`);
}
