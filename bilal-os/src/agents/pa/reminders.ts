import type { AgentDefinition } from "@/lib/agent/types";
import { q } from "@/lib/db";
import { esc } from "@/lib/telegram";
import { fmtDateTime, relative } from "@/lib/time";

// When to warn about a deadline, in hours before it's due.
const DEADLINE_WARNINGS: [string, number][] = [["7d", 168], ["2d", 48], ["1d", 24], ["3h", 3]];

export const reminders: AgentDefinition = {
  id: "pa.reminders",
  sector: "pa",
  name: "Reminders",
  description: "Texts you task reminders on time and warns about deadlines 7 days, 2 days, 1 day and 3 hours ahead.",
  schedule: "* * * * *",
  essential: true,
  quietWhenIdle: true,
  retries: 0,
  permissions: ["telegram"],
  async run(ctx) {
    // Hold reminders until Telegram is linked, rather than marking them sent.
    if (!(await ctx.secret("telegram_chat_id"))) return { summary: "Telegram not linked", skipped: true };
    let sent = 0;
    const due = await q<{ id: number; title: string; notes: string | null; due_at: Date | null }>(
      "UPDATE tasks SET reminded_at = now() WHERE done_at IS NULL AND reminded_at IS NULL AND remind_at <= now() RETURNING id, title, notes, due_at",
    );
    for (const t of due) {
      await ctx.telegram(`⏰ <b>Reminder:</b> ${esc(t.title)}${t.notes ? `\n${esc(t.notes)}` : ""}`, {
        buttons: [[{ text: "✅ Done", data: `task:${t.id}:done` }, { text: "⏱ 1 hour", data: `task:${t.id}:1h` }, { text: "📅 Tomorrow", data: `task:${t.id}:tmrw` }]],
      });
      sent++;
    }

    const deadlines = await q<{ id: number; title: string; due_at: Date; url: string | null; warned: string[]; sector_id: string }>(
      "SELECT id, title, due_at, url, warned, sector_id FROM deadlines WHERE NOT done AND due_at > now() AND due_at < now() + interval '7 days 1 minute'",
    );
    for (const d of deadlines) {
      const hoursLeft = (new Date(d.due_at).getTime() - Date.now()) / 3600_000;
      // Only the tightest warning that applies, and only once.
      const stage = [...DEADLINE_WARNINGS].reverse().find(([, h]) => hoursLeft <= h);
      if (!stage || d.warned.includes(stage[0])) continue;
      const covered = DEADLINE_WARNINGS.filter(([, h]) => h >= stage[1]).map(([k]) => k);
      await q("UPDATE deadlines SET warned = (SELECT array_agg(DISTINCT x) FROM unnest(warned || $2::text[]) x) WHERE id = $1", [d.id, covered]);
      const icon = hoursLeft <= 24 ? "🔴" : hoursLeft <= 48 ? "🟠" : "🟡";
      await ctx.telegram(`${icon} <b>Deadline ${relative(d.due_at)}</b>\n${esc(d.title)}\nDue ${fmtDateTime(d.due_at)}`, {
        buttons: d.url ? [[{ text: "Open", url: d.url }, { text: "✅ Done", data: `deadline:${d.id}:done` }]] : [[{ text: "✅ Done", data: `deadline:${d.id}:done` }]],
        silent: hoursLeft > 48,
      });
      sent++;
    }
    return sent ? { summary: `Sent ${sent} reminder${sent > 1 ? "s" : ""}` } : { summary: "Nothing due", skipped: true };
  },
  async kpis() {
    const r = await q<{ open: number; done_week: number; overdue: number }>(
      `SELECT count(*) FILTER (WHERE done_at IS NULL)::int AS open,
              count(*) FILTER (WHERE done_at > now() - interval '7 days')::int AS done_week,
              count(*) FILTER (WHERE done_at IS NULL AND due_at < now())::int AS overdue
       FROM tasks`,
    );
    return [
      { label: "Open tasks", value: r[0].open },
      { label: "Done this week", value: r[0].done_week, tone: "good" },
      { label: "Overdue", value: r[0].overdue, tone: r[0].overdue ? "bad" : "good" },
    ];
  },
};
