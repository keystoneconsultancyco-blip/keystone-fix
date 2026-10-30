// Gathers "what matters today" for the briefing, wrap-up and /today command.
import { q } from "@/lib/db";
import { londonDayBounds, fmtTime, fmtDateTime, relative } from "@/lib/time";
import { costStatus } from "@/lib/cost";
import { esc } from "@/lib/telegram";

export async function eventsFor(offsetDays: number) {
  const { start, end } = londonDayBounds(offsetDays);
  return q<{ title: string; location: string | null; start_at: Date; end_at: Date; all_day: boolean; source: string }>(
    "SELECT title, location, start_at, end_at, all_day, source FROM calendar_events WHERE start_at < $2 AND end_at > $1 ORDER BY all_day DESC, start_at",
    [start, end],
  );
}

export async function tasksDue(untilOffsetDays: number) {
  const { end } = londonDayBounds(untilOffsetDays);
  return q<{ id: number; title: string; due_at: Date | null }>(
    "SELECT id, title, due_at FROM tasks WHERE done_at IS NULL AND (due_at IS NULL OR due_at < $1) ORDER BY due_at NULLS LAST, id LIMIT 30",
    [end],
  );
}

export async function deadlinesWithin(days: number) {
  return q<{ title: string; due_at: Date; sector_id: string; url: string | null }>(
    "SELECT title, due_at, sector_id, url FROM deadlines WHERE NOT done AND due_at > now() AND due_at < now() + ($1 || ' days')::interval ORDER BY due_at",
    [String(days)],
  );
}

export async function undigestedAlerts() {
  return q<{ id: number; severity: string; title: string; body: string | null; sector_id: string; notified_at: Date | null }>(
    "SELECT id, severity, title, body, sector_id, notified_at FROM alerts WHERE read_at IS NULL AND digest_at IS NULL ORDER BY ts LIMIT 40",
  );
}

export async function pendingApprovalCount() {
  return (await q<{ n: number }>("SELECT count(*)::int AS n FROM approvals WHERE status = 'pending'"))[0].n;
}

export interface Digest {
  events: Awaited<ReturnType<typeof eventsFor>>;
  tasks: Awaited<ReturnType<typeof tasksDue>>;
  deadlines: Awaited<ReturnType<typeof deadlinesWithin>>;
  alerts: Awaited<ReturnType<typeof undigestedAlerts>>;
  approvals: number;
  spend: { spent: number; cap: number };
}

export async function buildDigest(dayOffset = 0): Promise<Digest> {
  const [events, tasks, deadlines, alerts, approvals, cost] = await Promise.all([
    eventsFor(dayOffset), tasksDue(dayOffset), deadlinesWithin(7), undigestedAlerts(), pendingApprovalCount(), costStatus(),
  ]);
  return { events, tasks, deadlines, alerts, approvals, spend: { spent: cost.spent, cap: cost.cap } };
}

export function eventLine(e: Digest["events"][number]) {
  return `${e.all_day ? "All day" : `${fmtTime(e.start_at)}–${fmtTime(e.end_at)}`} ${esc(e.title)}${e.location ? ` <i>(${esc(e.location)})</i>` : ""}`;
}

/** Plain template version — used when AI is unavailable or over budget. */
export function renderDigest(d: Digest, heading: string, opts: { includeAlerts?: boolean } = {}): string {
  const parts = [`<b>${esc(heading)}</b>`];
  parts.push(d.events.length ? `\n📅 <b>Schedule</b>\n${d.events.map(eventLine).join("\n")}` : "\n📅 Nothing in the calendar.");
  if (d.tasks.length) parts.push(`\n✅ <b>Tasks</b>\n${d.tasks.map((t, i) => `${i + 1}. ${esc(t.title)}${t.due_at ? ` — ${fmtDateTime(t.due_at)}` : ""}`).join("\n")}`);
  if (d.deadlines.length) parts.push(`\n⏰ <b>Deadlines (7 days)</b>\n${d.deadlines.map((x) => `• ${esc(x.title)} — ${fmtDateTime(x.due_at)} (${relative(x.due_at)})`).join("\n")}`);
  if (opts.includeAlerts && d.alerts.length) parts.push(`\n🔔 <b>Alerts</b>\n${d.alerts.map((a) => `• [${a.severity}] ${esc(a.title)}`).join("\n")}`);
  if (d.approvals) parts.push(`\n🟡 ${d.approvals} item${d.approvals > 1 ? "s" : ""} waiting for your approval.`);
  parts.push(`\n💷 AI spend: £${d.spend.spent.toFixed(2)} / £${d.spend.cap.toFixed(2)}`);
  return parts.join("\n");
}

/** Facts given to the AI so it writes from data, not imagination. */
export function digestFacts(d: Digest): string {
  return JSON.stringify({
    events: d.events.map((e) => ({ title: e.title, start: e.all_day ? "all day" : fmtTime(e.start_at), end: e.all_day ? null : fmtTime(e.end_at), location: e.location, uni: e.source === "timetable" })),
    tasks: d.tasks.map((t) => ({ title: t.title, due: t.due_at ? fmtDateTime(t.due_at) : null })),
    deadlines: d.deadlines.map((x) => ({ title: x.title, due: fmtDateTime(x.due_at), in: relative(x.due_at), sector: x.sector_id })),
    alerts: d.alerts.map((a) => ({ severity: a.severity, title: a.title, detail: a.body?.slice(0, 200), sector: a.sector_id })),
    approvalsWaiting: d.approvals,
    aiSpend: `£${d.spend.spent.toFixed(2)} of £${d.spend.cap.toFixed(2)}`,
  });
}
