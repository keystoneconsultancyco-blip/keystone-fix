import { q, one } from "./db";
import { sendTelegram, esc } from "./telegram";
import { getSetting } from "./settings";
import { inQuietHours } from "./time";
import { logActivity } from "./activity";

export type Severity = "info" | "important" | "crucial";

/**
 * Escalation rules (every sector uses these):
 *  - crucial:   saved + sent to Telegram immediately, even during quiet hours.
 *  - important: saved + sent to Telegram straight away, unless it is quiet hours,
 *               in which case it is held and included in the next morning briefing.
 *  - info:      saved to the dashboard only; summarised in the daily briefing.
 * A dedupeKey stops the same open alert being raised twice.
 */
export async function raiseAlert(a: {
  sectorId: string; agentId?: string | null; severity: Severity; title: string; body?: string; url?: string; dedupeKey?: string;
}): Promise<number | null> {
  const row = await one<{ id: number }>(
    `INSERT INTO alerts (sector_id, agent_id, severity, title, body, url, dedupe_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND read_at IS NULL DO NOTHING
     RETURNING id`,
    [a.sectorId, a.agentId ?? null, a.severity, a.title, a.body ?? null, a.url ?? null, a.dedupeKey ?? null],
  );
  if (!row) return null; // duplicate of an open alert
  await logActivity({ sectorId: a.sectorId, agentId: a.agentId, level: a.severity === "info" ? "info" : "warn", message: `Alert (${a.severity}): ${a.title}` });

  if (a.severity === "info") return row.id;
  if (a.severity === "important") {
    const [s, e] = [await getSetting("general.quietHoursStart"), await getSetting("general.quietHoursEnd")];
    if (inQuietHours(s, e)) return row.id; // picked up by the morning briefing
  }
  const icon = a.severity === "crucial" ? "🚨" : "⚠️";
  const text = `${icon} <b>${esc(a.title)}</b>${a.body ? `\n${esc(a.body)}` : ""}`;
  const sent = await sendTelegram(text, { buttons: a.url ? [[{ text: "Open", url: a.url }]] : undefined }).catch(() => false);
  if (sent) await q("UPDATE alerts SET notified_at = now() WHERE id = $1", [row.id]);
  return row.id;
}

export async function markAlertRead(id: number) {
  await q("UPDATE alerts SET read_at = now() WHERE id = $1", [id]);
}

/**
 * Record a failure for `key`. Alerts once when a job has failed `threshold`
 * times in a row; stays quiet until it succeeds again (see recordSuccess).
 */
export async function recordFailure(key: string, error: string, ctx: { sectorId: string; agentId?: string; threshold?: number }) {
  const row = await one<{ consecutive_failures: number; alerted_at: Date | null }>(
    `INSERT INTO failure_tracker (key, consecutive_failures, last_error) VALUES ($1, 1, $2)
     ON CONFLICT (key) DO UPDATE SET consecutive_failures = failure_tracker.consecutive_failures + 1, last_error = $2, updated_at = now()
     RETURNING consecutive_failures, alerted_at`,
    [key, error.slice(0, 2000)],
  );
  if (row && row.consecutive_failures >= (ctx.threshold ?? 3) && !row.alerted_at) {
    await q("UPDATE failure_tracker SET alerted_at = now() WHERE key = $1", [key]);
    await raiseAlert({
      sectorId: ctx.sectorId, agentId: ctx.agentId, severity: "important",
      title: `${key} keeps failing`, body: `Failed ${row.consecutive_failures} times in a row. Latest error: ${error.slice(0, 300)}`,
    });
  }
}

export async function recordSuccess(key: string) {
  const prev = await one<{ alerted_at: Date | null }>("DELETE FROM failure_tracker WHERE key = $1 RETURNING alerted_at", [key]);
  return Boolean(prev?.alerted_at);
}
