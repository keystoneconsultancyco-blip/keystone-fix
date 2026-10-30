import type { AgentDefinition } from "@/lib/agent/types";
import { q } from "@/lib/db";
import { esc } from "@/lib/telegram";
import { fmtDate } from "@/lib/time";

const SCORE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["scores"],
  properties: {
    scores: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "score", "reason"],
        properties: {
          id: { type: "integer" },
          score: { type: "integer", description: "0-100 fit for Bilal" },
          reason: { type: "string", description: "One sentence, plain English." },
        },
      },
    },
  },
};

/** Scores new opportunities against Bilal's goals and pings him about the good ones. */
export const opportunityScorer: AgentDefinition = {
  id: "workexp.opportunity-scorer",
  sector: "workexp",
  name: "Opportunity scorer",
  description: "Rates each new opportunity for fit (first-year eligibility, PE/investment focus, location) and alerts you to the best.",
  schedule: "30 8,18 * * *",
  permissions: ["llm", "telegram"],
  quietWhenIdle: true,
  async run(ctx) {
    const rows = await q<{ id: number; title: string; company: string | null; kind: string | null; location: string | null; description: string | null; deadline: Date | null; url: string | null }>(
      "SELECT id, title, company, kind, location, description, deadline, url FROM opportunities WHERE score IS NULL ORDER BY id LIMIT 40",
    );
    if (!rows.length) return { summary: "Nothing to score", skipped: true };
    const profile = await ctx.setting("workexp.profile");
    const r = await ctx.llm({
      tier: "fast", schema: SCORE_SCHEMA, maxTokens: 6000, purpose: "score opportunities",
      system: `You help a UK first-year undergraduate choose finance work experience. Score fit 0-100:
+ high if open to first-years / spring week / insight programme, in private equity, investment management, investment banking or asset management, in London/Surrey/UK or virtual.
- low if for penultimate/final-year students or graduates only, unrelated fields, outside the UK, or the deadline has passed.
Be strict: 80+ only for clearly great matches.`,
      prompt: `Today: ${new Date().toISOString().slice(0, 10)}\nStudent: ${profile.summary}\nTargets: ${profile.targets.join(", ")}\n\nOpportunities:\n${JSON.stringify(rows.map((o) => ({ id: o.id, title: o.title, company: o.company, kind: o.kind, location: o.location, deadline: o.deadline?.toISOString().slice(0, 10), about: o.description?.slice(0, 400) })))}`,
    });
    const minAlert = Number(await ctx.setting("workexp.minScoreToAlert"));
    let good = 0;
    for (const s of (r.json?.scores ?? []) as { id: number; score: number; reason: string }[]) {
      const o = rows.find((x) => x.id === s.id);
      if (!o) continue;
      const score = Math.max(0, Math.min(100, Math.round(s.score)));
      await q("UPDATE opportunities SET score = $2, score_reason = $3, status = CASE WHEN $2 < 30 THEN 'ignored' ELSE status END, updated_at = now() WHERE id = $1", [o.id, score, s.reason]);
      if (score >= minAlert) {
        good++;
        if (o.deadline) {
          await q(
            `INSERT INTO deadlines (title, due_at, sector_id, source, source_ref, url) VALUES ($1,$2,'workexp','opportunity',$3,$4)
             ON CONFLICT (source, source_ref) DO UPDATE SET due_at = EXCLUDED.due_at`,
            [`Apply: ${o.company ? `${o.company} — ` : ""}${o.title}`, o.deadline, String(o.id), o.url],
          );
        }
        await ctx.telegram(
          `💼 <b>${esc(o.title)}</b>${o.company ? ` — ${esc(o.company)}` : ""}\nFit ${score}/100: ${esc(s.reason)}${o.deadline ? `\nDeadline: ${fmtDate(o.deadline)}` : ""}`,
          { buttons: [[{ text: "✍️ Draft application", data: `wx:${o.id}:draft` }, { text: "⭐ Shortlist", data: `wx:${o.id}:short` }, { text: "🙈 Ignore", data: `wx:${o.id}:ignore` }], ...(o.url ? [[{ text: "Open listing", url: o.url }]] : [])] },
        );
      }
    }
    // Any left unscored (model skipped them) get another try next run.
    return { summary: `Scored ${rows.length}; ${good} strong match${good === 1 ? "" : "es"}` };
  },
};
