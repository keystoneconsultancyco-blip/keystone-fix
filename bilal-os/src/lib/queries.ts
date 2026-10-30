// Read-only queries used by dashboard pages.
import { q, one } from "./db";
import { londonDayBounds } from "./time";

export async function sectorsList() {
  return q<{ id: string; name: string; icon: string; description: string | null; builtin: boolean }>(
    "SELECT id, name, icon, description, builtin FROM sectors ORDER BY sort, name",
  );
}

export async function agentsFor(sectorId?: string) {
  return q<{
    id: string; sector_id: string; name: string; description: string | null; enabled: boolean; schedule: string | null;
    essential: boolean; last_run_at: Date | null; last_status: string | null; next_run_at: Date | null; registered: boolean; config: any;
  }>(`SELECT * FROM agents WHERE registered ${sectorId ? "AND sector_id = $1" : ""} ORDER BY sector_id, name`, sectorId ? [sectorId] : []);
}

export async function activity(opts: { sectorId?: string; agentId?: string; level?: string; limit?: number; before?: number } = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.sectorId) { params.push(opts.sectorId); where.push(`sector_id = $${params.length}`); }
  if (opts.agentId) { params.push(opts.agentId); where.push(`agent_id = $${params.length}`); }
  if (opts.level) { params.push(opts.level); where.push(`level = $${params.length}`); }
  if (opts.before) { params.push(opts.before); where.push(`id < $${params.length}`); }
  params.push(opts.limit ?? 100);
  return q<{ id: number; ts: Date; sector_id: string | null; agent_id: string | null; level: string; message: string; data: any }>(
    `SELECT id, ts, sector_id, agent_id, level, message, data FROM activity_log ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT $${params.length}`,
    params,
  );
}

export async function openAlerts(sectorId?: string, limit = 50) {
  return q<{ id: number; ts: Date; sector_id: string; agent_id: string | null; severity: string; title: string; body: string | null; url: string | null }>(
    `SELECT id, ts, sector_id, agent_id, severity, title, body, url FROM alerts WHERE read_at IS NULL ${sectorId ? "AND sector_id = $2" : ""}
     ORDER BY CASE severity WHEN 'crucial' THEN 0 WHEN 'important' THEN 1 ELSE 2 END, ts DESC LIMIT $1`,
    sectorId ? [limit, sectorId] : [limit],
  );
}

export async function todaysEvents(offsetDays = 0) {
  const { start, end } = londonDayBounds(offsetDays);
  return q<{ id: string; source: string; title: string; location: string | null; start_at: Date; end_at: Date; all_day: boolean }>(
    "SELECT id, source, title, location, start_at, end_at, all_day FROM calendar_events WHERE start_at < $2 AND end_at > $1 ORDER BY all_day DESC, start_at",
    [start, end],
  );
}

export async function openTasks() {
  const { end } = londonDayBounds(0);
  return q<{ id: number; title: string; notes: string | null; due_at: Date | null; remind_at: Date | null; sector_id: string | null }>(
    "SELECT id, title, notes, due_at, remind_at, sector_id FROM tasks WHERE done_at IS NULL AND (due_at IS NULL OR due_at < $1::timestamptz + interval '7 days') ORDER BY due_at NULLS LAST, created_at",
    [end],
  );
}

export async function upcomingDeadlines(days = 21, sectorId?: string) {
  return q<{ id: number; title: string; due_at: Date; sector_id: string; source: string; url: string | null; detail: string | null }>(
    `SELECT id, title, due_at, sector_id, source, url, detail FROM deadlines
     WHERE NOT done AND due_at > now() - interval '1 day' AND due_at < now() + ($1 || ' days')::interval ${sectorId ? "AND sector_id = $2" : ""}
     ORDER BY due_at`,
    sectorId ? [String(days), sectorId] : [String(days)],
  );
}

export async function workerHealth() {
  const hb = await one<{ ts: Date; info: any }>("SELECT ts, info FROM heartbeats WHERE service = 'worker'");
  const ageSec = hb ? (Date.now() - new Date(hb.ts).getTime()) / 1000 : null;
  const failing = await q<{ key: string; consecutive_failures: number; last_error: string }>(
    "SELECT key, consecutive_failures, last_error FROM failure_tracker WHERE consecutive_failures > 0 ORDER BY consecutive_failures DESC",
  );
  return { heartbeat: hb?.ts ?? null, ageSec, ok: ageSec !== null && ageSec < 180, info: hb?.info ?? null, failing };
}

export async function spendByModel() {
  return q<{ model: string; cost: number; calls: number }>(
    `SELECT model, sum(cost_gbp)::float AS cost, count(*)::int AS calls FROM llm_usage
     WHERE ts >= date_trunc('month', now() AT TIME ZONE 'Europe/London') AT TIME ZONE 'Europe/London' GROUP BY model ORDER BY cost DESC`,
  );
}
