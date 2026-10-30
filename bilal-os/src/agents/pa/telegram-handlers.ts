// What the PA understands on Telegram: /commands, button presses and plain messages.
import { registerCommand, registerCallback, setTextHandler } from "./bot";
import { q, one } from "@/lib/db";
import { esc } from "@/lib/telegram";
import { parseWhen } from "@/lib/when";
import { fmtDateTime, fromLondon, londonParts, relative } from "@/lib/time";
import { costStatus } from "@/lib/cost";
import { complete } from "@/lib/llm";
import { getSecret } from "@/lib/settings";
import { calendarApi, isGoogleConnected } from "@/lib/google";
import { sendCommand } from "@/lib/commands";
import { AGENTS } from "@/agents";
import { buildDigest, renderDigest, eventsFor, eventLine } from "./digest";
import { env } from "@/lib/env";

async function addTask(title: string, when: Date | null, source = "telegram") {
  const row = await one<{ id: number }>("INSERT INTO tasks (title, due_at, remind_at, source) VALUES ($1, $2, $2, $3) RETURNING id", [title, when, source]);
  return row!.id;
}

function taskConfirm(title: string, when: Date | null) {
  return when ? `👍 I'll remind you to <b>${esc(title)}</b> on ${fmtDateTime(when)} (${relative(when)}).` : `👍 Added to your tasks: <b>${esc(title)}</b>`;
}

async function listTasks(): Promise<string> {
  const tasks = await q<{ id: number; title: string; due_at: Date | null }>("SELECT id, title, due_at FROM tasks WHERE done_at IS NULL ORDER BY due_at NULLS LAST, id LIMIT 25");
  if (!tasks.length) return "No open tasks 🎉";
  return `<b>Open tasks</b>\n${tasks.map((t, i) => `${i + 1}. ${esc(t.title)}${t.due_at ? ` — ${fmtDateTime(t.due_at)}` : ""}`).join("\n")}\n\nSend /done 2 to tick off number 2.`;
}

async function listDeadlines(): Promise<string> {
  const d = await q<{ title: string; due_at: Date; sector_id: string }>("SELECT title, due_at, sector_id FROM deadlines WHERE NOT done AND due_at > now() ORDER BY due_at LIMIT 15");
  if (!d.length) return "No upcoming deadlines.";
  return `<b>Upcoming deadlines</b>\n${d.map((x) => `• ${esc(x.title)} — ${fmtDateTime(x.due_at)} (${relative(x.due_at)})`).join("\n")}`;
}

async function dayText(offset: number): Promise<string> {
  const events = await eventsFor(offset);
  const label = offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : `In ${offset} days`;
  return events.length ? `<b>${label}</b>\n${events.map(eventLine).join("\n")}` : `${label}: nothing in the calendar.`;
}

registerCommand("today", "Today's schedule, tasks and deadlines", async () => renderDigest(await buildDigest(0), "Today"));
registerCommand("tomorrow", "Tomorrow's schedule", async () => dayText(1));
registerCommand("tasks", "Open tasks", listTasks);
registerCommand("deadlines", "Upcoming deadlines", listDeadlines);
registerCommand("done", "Tick off a task: /done 2", async (args) => {
  const n = Number(args.trim());
  const tasks = await q<{ id: number; title: string }>("SELECT id, title FROM tasks WHERE done_at IS NULL ORDER BY due_at NULLS LAST, id LIMIT 25");
  const t = tasks[n - 1];
  if (!t) return "Which one? Send /tasks to see the numbers.";
  await q("UPDATE tasks SET done_at = now() WHERE id = $1", [t.id]);
  return `✅ Done: ${esc(t.title)}`;
});
registerCommand("remind", "Add a reminder: /remind call bank | fri 2pm", async (args) => {
  const [title, whenText] = args.split("|").map((s) => s.trim());
  if (!title) return "Use it like: /remind call the bank | fri 2pm";
  const when = whenText ? parseWhen(whenText) : null;
  if (whenText && !when) return `I couldn't understand "${esc(whenText)}". Try "tomorrow 9am" or "in 2 hours".`;
  await addTask(title, when);
  return taskConfirm(title, when);
});
registerCommand("spend", "AI spend this month", async () => {
  const c = await costStatus();
  return `💷 £${c.spent.toFixed(2)} of £${c.cap.toFixed(2)} (${Math.round(c.pct)}%)${c.paused ? "\nBudget reached — non-essential AI is paused." : ""}`;
});
registerCommand("approvals", "Things waiting for your OK", async () => {
  const a = await q<{ id: number; title: string }>("SELECT id, title FROM approvals WHERE status = 'pending' ORDER BY created_at LIMIT 10");
  if (!a.length) return "Nothing waiting for approval.";
  return `<b>Waiting for you</b>\n${a.map((x) => `• #${x.id} ${esc(x.title)}`).join("\n")}\n\nApprove from the original message or the dashboard: ${env.appUrl}/approvals`;
});
registerCommand("status", "System health", async () => {
  const hb = await one<{ age: number }>("SELECT extract(epoch from now() - ts)::int AS age FROM heartbeats WHERE service = 'worker'");
  const failing = await q<{ key: string }>("SELECT key FROM failure_tracker WHERE consecutive_failures > 0");
  return `🩺 Worker heartbeat ${hb?.age ?? "?"}s ago.\n${failing.length ? `Failing: ${failing.map((f) => esc(f.key)).join(", ")}` : "No failing jobs."}`;
});
registerCommand("run", "Run an agent now: /run pa.morning-briefing", async (args) => {
  const id = args.trim();
  const a = AGENTS.find((x) => x.id === id || x.name.toLowerCase() === id.toLowerCase());
  if (!a) return `Agents:\n${AGENTS.map((x) => `<code>${x.id}</code>`).join("\n")}`;
  await sendCommand("agent.run", { agentId: a.id, trigger: "manual" });
  return `▶️ Running ${esc(a.name)}…`;
});

// ---- Buttons on reminder messages ----
registerCallback("task:", async (data) => {
  const [idStr, action] = data.split(":");
  const id = Number(idStr);
  if (action === "done") {
    await q("UPDATE tasks SET done_at = now() WHERE id = $1", [id]);
    return "Marked done ✅";
  }
  const p = londonParts();
  const when = action === "1h" ? new Date(Date.now() + 3600_000) : fromLondon(p.year, p.month, p.day + 1, 9, 0);
  await q("UPDATE tasks SET remind_at = $2, reminded_at = NULL WHERE id = $1", [id, when]);
  return `Snoozed until ${fmtDateTime(when)}`;
});
registerCallback("deadline:", async (data) => {
  await q("UPDATE deadlines SET done = true WHERE id = $1", [Number(data.split(":")[0])]);
  return "Marked done ✅";
});

// ---- Plain messages ----
const REMIND_RE = /^(?:remind me (?:to |about )?|reminder:? |todo:? |add task:? )(.+?)(?: (?:at|on|by|in|tomorrow|tonight|today|next|this) .+)?$/i;

/** Cheap first pass: "remind me to X at/in Y" without AI. */
export function quickParse(text: string): { title: string; when: Date | null } | null {
  const m = REMIND_RE.exec(text.trim());
  if (!m) return null;
  const rest = text.trim().slice(text.toLowerCase().indexOf(m[1].toLowerCase()) + m[1].length).trim();
  if (!rest) return { title: m[1], when: null };
  const when = parseWhen(rest);
  return when ? { title: m[1], when } : null;
}

const INTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "title", "when", "end", "day_offset", "reply"],
  properties: {
    intent: { type: "string", enum: ["add_task", "add_calendar_event", "show_day", "show_tasks", "show_deadlines", "show_spend", "other"] },
    title: { type: "string", description: "Task or event title, short. Empty if not relevant." },
    when: { type: "string", description: "Local UK time as YYYY-MM-DDTHH:MM, or empty string if none." },
    end: { type: "string", description: "Event end as YYYY-MM-DDTHH:MM, or empty string." },
    day_offset: { type: "integer", description: "For show_day: 0 today, 1 tomorrow, etc." },
    reply: { type: "string", description: "For intent 'other': a brief, friendly reply (max 2 sentences)." },
  },
};

function fromLocalIso(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s);
  return m ? fromLondon(+m[1], +m[2], +m[3], +m[4], +m[5]) : null;
}

setTextHandler(async (text) => {
  const quick = quickParse(text);
  if (quick) {
    await addTask(quick.title, quick.when);
    return taskConfirm(quick.title, quick.when);
  }
  const lower = text.toLowerCase();
  if (/^(what'?s on )?today\??$/.test(lower)) return renderDigest(await buildDigest(0), "Today");
  if (/^(what'?s on )?tomorrow\??$/.test(lower)) return dayText(1);

  if (!(await getSecret("anthropic_api_key")) || (await costStatus()).paused) {
    return "I can only do the basics right now (AI is off or over budget). Try /help, or \"remind me to … at 4pm\".";
  }
  const p = londonParts();
  const nowLocal = `${p.weekday} ${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
  const r = await complete({
    tier: "fast",
    agentId: "pa.telegram",
    purpose: "telegram-intent",
    maxTokens: 800,
    schema: INTENT_SCHEMA,
    system: `You turn Bilal's Telegram messages into actions for his personal-assistant system. Current UK time: ${nowLocal}. UK English.
- Reminders, to-dos and "don't let me forget" → add_task (when = reminder time if given).
- Meetings/appointments with a specific time to put in the calendar → add_calendar_event (default 1 hour long if no end).
- Questions about his schedule → show_day; about tasks → show_tasks; deadlines → show_deadlines; AI cost → show_spend.
- Anything else → other, with a short helpful reply. Tutoring questions belong in the Claude app (it reads his organised Google Drive), so point him there.`,
    prompt: text,
  });
  const it = r.json as { intent: string; title: string; when: string; end: string; day_offset: number; reply: string };
  switch (it.intent) {
    case "add_task": {
      const when = it.when ? fromLocalIso(it.when) : null;
      await addTask(it.title || text, when);
      return taskConfirm(it.title || text, when);
    }
    case "add_calendar_event": {
      const start = fromLocalIso(it.when);
      if (!start) return "When is it? Try again with a time, e.g. \"lunch with Sam fri 1pm\".";
      const end = fromLocalIso(it.end) ?? new Date(start.getTime() + 3600_000);
      if (!(await isGoogleConnected())) {
        await addTask(it.title, start);
        return `Google Calendar isn't connected, so I saved it as a reminder instead: <b>${esc(it.title)}</b> ${fmtDateTime(start)}.`;
      }
      const cal = await calendarApi();
      const ev = await cal.events.insert({ calendarId: "primary", requestBody: { summary: it.title, start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() } } });
      await q(
        `INSERT INTO calendar_events (id, source, title, start_at, end_at) VALUES ($1,'google',$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
        [`google:primary:${ev.data.id}`, it.title, start, end],
      );
      return `📅 Added to your calendar: <b>${esc(it.title)}</b>, ${fmtDateTime(start)}.`;
    }
    case "show_day": return dayText(Math.max(0, Math.min(14, it.day_offset || 0)));
    case "show_tasks": return listTasks();
    case "show_deadlines": return listDeadlines();
    case "show_spend": {
      const c = await costStatus();
      return `💷 £${c.spent.toFixed(2)} of £${c.cap.toFixed(2)} this month.`;
    }
    default: return esc(it.reply || "Got it.");
  }
});
