import type { AgentContext, AgentDefinition } from "@/lib/agent/types";
import { getSetting } from "@/lib/settings";
import { dailyCron } from "@/lib/time";
import { q } from "@/lib/db";
import { buildDigest, digestFacts, renderDigest, type Digest } from "./digest";

const STYLE = `You are Bilal's personal assistant. Bilal is 18, a first-year Economics student at Royal Holloway, runs a finance-ops consultancy (Keystone) and a property-sourcing side business, and is chasing finance work experience (private equity / investment).
Write in UK English, warm but brisk. Plain language. Use Telegram HTML only (<b>, <i>, <a href>), no Markdown, no headings with #.
Only use facts from the JSON you are given — never invent events, deadlines or numbers. Keep it under 180 words.`;

async function aiOrTemplate(ctx: AgentContext, d: Digest, heading: string, instruction: string): Promise<string> {
  const fallback = renderDigest(d, heading, { includeAlerts: true });
  if (!(await ctx.llmAvailable())) return fallback;
  try {
    const r = await ctx.llm({ tier: "fast", system: STYLE, prompt: `${instruction}\n\nFacts (JSON):\n${digestFacts(d)}`, maxTokens: 1500, purpose: heading });
    return r.text || fallback;
  } catch (e) {
    await ctx.log(`AI briefing failed, sent plain version: ${(e as Error).message}`, undefined, "warn");
    return fallback;
  }
}

export const morningBriefing: AgentDefinition = {
  id: "pa.morning-briefing",
  sector: "pa",
  name: "Morning briefing",
  description: "Sends your day on Telegram: timetable, tasks, deadlines, overnight alerts and approvals.",
  schedule: async () => dailyCron(await getSetting("pa.briefingTime")),
  essential: true,
  permissions: ["llm", "telegram"],
  async run(ctx) {
    const d = await buildDigest(0);
    const text = await aiOrTemplate(ctx, d, "Good morning ☀️",
      "Write Bilal's morning briefing. Start with a one-line overview of the day. Then the schedule in time order, tasks, deadlines (flag anything within 48 hours), then any alerts and approvals waiting. End with one short, practical suggestion for the day.");
    const sent = await ctx.telegram(text);
    if (d.alerts.length) await q("UPDATE alerts SET digest_at = now() WHERE id = ANY($1::bigint[])", [d.alerts.map((a) => a.id)]);
    return { summary: `${sent ? "Sent" : "Prepared (Telegram not linked)"}: ${d.events.length} events, ${d.tasks.length} tasks, ${d.deadlines.length} deadlines, ${d.alerts.length} alerts` };
  },
};

export const eveningWrapup: AgentDefinition = {
  id: "pa.evening-wrapup",
  sector: "pa",
  name: "Evening wrap-up",
  description: "Evening check-in: what's still open today and what tomorrow looks like.",
  schedule: async () => dailyCron(await getSetting("pa.wrapupTime")),
  essential: true,
  permissions: ["llm", "telegram"],
  async run(ctx) {
    const d = await buildDigest(1);
    const text = await aiOrTemplate(ctx, d, "Evening wrap-up 🌙",
      "Write Bilal's evening wrap-up. Remind him of open tasks, preview tomorrow's schedule (these events are for TOMORROW), and flag deadlines in the next 48 hours. Suggest one thing to prepare tonight. Short.");
    const sent = await ctx.telegram(text, { silent: true });
    return { summary: `${sent ? "Sent" : "Prepared"}: ${d.events.length} events tomorrow, ${d.tasks.length} open tasks` };
  },
};
