import fs from "node:fs";
import type { AgentContext, AgentDefinition } from "@/lib/agent/types";
import { q, one } from "@/lib/db";
import { dataPath } from "@/lib/browser";
import { esc, sendTelegram, sendTelegramPhoto } from "@/lib/telegram";
import { fmtDateTime } from "@/lib/time";
import { BROWSER_PROFILE, readPage } from "./finder";
import type { Approval } from "@/lib/approvals";

const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answers", "cover_letter", "notes"],
  properties: {
    answers: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["question", "answer"],
        properties: { question: { type: "string" }, answer: { type: "string" } },
      },
    },
    cover_letter: { type: "string", description: "Short cover letter, or empty if clearly not needed." },
    notes: { type: "string", description: "Anything Bilal must check or add himself (facts you could not know)." },
  },
};

const WRITER = `You draft early-careers finance applications for Bilal: an 18-year-old first-year BSc Economics student at Royal Holloway, University of London, who runs Keystone (a finance-operations consultancy) and a property-sourcing side business, and wants a career in private equity / investment.
Rules:
- UK English. Confident, specific, genuine — no clichés ("passionate", "dynamic environment"), no exaggeration.
- Only use facts from the profile/CV given. Where a strong answer needs a fact you don't have (grades, a specific deal he followed, a name), write [ADD: …] so he fills it in. Never invent achievements.
- Respect word limits stated in questions; otherwise 150–250 words per answer.
- Show commercial awareness through reasoning about the firm and its sector, flagged with [CHECK] if it relies on facts that may be out of date.`;

const DEFAULT_QUESTIONS = [
  "Why are you interested in this programme and this firm?",
  "Why are you interested in a career in finance, particularly private equity or investment?",
  "Tell us about a time you showed leadership or initiative.",
  "Describe a recent deal, market event or news story that interested you and why.",
];

/** Drafts application answers and asks Bilal to approve them. */
export const applicationDrafter: AgentDefinition = {
  id: "workexp.application-drafter",
  sector: "workexp",
  name: "Application drafter",
  description: "Drafts answers and a cover letter for an opportunity you pick, then asks for your approval before anything is filled in.",
  permissions: ["llm", "browser", "telegram"],
  approvals: [{ kind: "submit_application", description: "filling in (and, if auto-submit is on, submitting) any application form" }],
  timeoutSeconds: 1200,
  async run(ctx) {
    const id = Number(ctx.input.opportunityId);
    const queued = id ? [id] : (await q<{ id: number }>("SELECT id FROM opportunities WHERE status = 'drafting' ORDER BY updated_at LIMIT 3")).map((r) => r.id);
    if (!queued.length) return { summary: "No applications waiting to be drafted", skipped: true };
    const done: string[] = [];
    for (const oid of queued) done.push(await draftOne(ctx, oid));
    return { summary: done.join("; ") };
  },
  async onApproval(ctx, approval) {
    return handleDecision(ctx, approval);
  },
  async kpis() {
    const r = await one<{ short: number; drafts: number; applied: number; interviews: number }>(
      `SELECT count(*) FILTER (WHERE status = 'shortlisted')::int AS short, count(*) FILTER (WHERE status = 'draft_ready')::int AS drafts,
              count(*) FILTER (WHERE status = 'applied')::int AS applied, count(*) FILTER (WHERE status IN ('interview','offer'))::int AS interviews
       FROM opportunities`,
    );
    return [
      { label: "Shortlisted", value: r?.short ?? 0 },
      { label: "Drafts to review", value: r?.drafts ?? 0, tone: (r?.drafts ?? 0) > 0 ? "warn" : "neutral" },
      { label: "Applied", value: r?.applied ?? 0, tone: "good" },
      { label: "Interviews / offers", value: r?.interviews ?? 0, tone: "good" },
    ];
  },
};

async function draftOne(ctx: AgentContext, oid: number): Promise<string> {
  const o = await one<{ id: number; title: string; company: string | null; url: string | null; description: string | null; deadline: Date | null; kind: string | null }>(
    "SELECT id, title, company, url, description, deadline, kind FROM opportunities WHERE id = $1", [oid],
  );
  if (!o) return `#${oid} not found`;
  await q("UPDATE opportunities SET status = 'drafting', updated_at = now() WHERE id = $1", [oid]);
  const profile = await ctx.setting("workexp.profile");

  // Read the listing to find the actual questions (best effort; many forms sit behind a login).
  let pageText = "";
  if (o.url) {
    try { pageText = (await readPage(ctx, o.url)).text.slice(0, 20_000); }
    catch (e) { await ctx.log(`Couldn't open listing: ${(e as Error).message}`, undefined, "warn"); }
  }
  const r = await ctx.llm({
    tier: "strong", system: WRITER, schema: DRAFT_SCHEMA, maxTokens: 12000, purpose: `draft application #${oid}`,
    prompt: `OPPORTUNITY: ${o.title}${o.company ? ` at ${o.company}` : ""} (${o.kind ?? "programme"})${o.deadline ? `, deadline ${fmtDateTime(o.deadline)}` : ""}
About: ${o.description ?? "-"}

LISTING PAGE TEXT (find any application questions and word limits here):
${pageText || "(not available)"}

If the page shows no specific questions, answer these standard ones:
${DEFAULT_QUESTIONS.map((x) => `- ${x}`).join("\n")}

BILAL'S PROFILE:
${profile.summary}

CV:
${profile.cvText || "(no CV text saved yet — use [ADD: …] placeholders where needed)"}`,
  });
  const d = r.json as { answers: { question: string; answer: string }[]; cover_letter: string; notes: string };
  const app = await one<{ id: number }>(
    "INSERT INTO applications (opportunity_id, answers, cover_letter, notes) VALUES ($1,$2,$3,$4) RETURNING id",
    [oid, JSON.stringify(d.answers), d.cover_letter, d.notes],
  );
  await q("UPDATE opportunities SET status = 'draft_ready', updated_at = now() WHERE id = $1", [oid]);
  const summary = [
    ...d.answers.map((a) => `Q: ${a.question}\n${a.answer}`),
    d.cover_letter ? `COVER LETTER:\n${d.cover_letter}` : "",
    d.notes ? `⚠️ CHECK BEFORE SENDING:\n${d.notes}` : "",
  ].filter(Boolean).join("\n\n");
  await ctx.requestApproval("submit_application", `Application: ${o.title}${o.company ? ` — ${o.company}` : ""}`, summary, { applicationId: app!.id, opportunityId: oid });
  return `Drafted #${oid} ${o.title}`;
}

/** After approval: fill the form where possible and hand over to Bilal; after rejection: back to shortlist. */
async function handleDecision(ctx: AgentContext, approval: Approval): Promise<string> {
  const { applicationId, opportunityId } = approval.payload as { applicationId: number; opportunityId: number };
  if (approval.status === "rejected") {
    await q("UPDATE opportunities SET status = 'shortlisted', updated_at = now() WHERE id = $1", [opportunityId]);
    await q("UPDATE applications SET status = 'failed', notes = coalesce(notes,'') || $2 WHERE id = $1", [applicationId, `\nRejected: ${approval.decision_note ?? ""}`]);
    return "Draft rejected — moved back to shortlist. Edit the profile or ask for a new draft.";
  }
  const app = await one<{ answers: { question: string; answer: string }[]; cover_letter: string | null }>("SELECT answers, cover_letter FROM applications WHERE id = $1", [applicationId]);
  const o = await one<{ title: string; company: string | null; url: string | null; deadline: Date | null }>("SELECT title, company, url, deadline FROM opportunities WHERE id = $1", [opportunityId]);
  if (!app || !o) return "Application not found";

  const autoSubmit = Boolean(await ctx.setting("workexp.autoSubmit"));
  let outcome = "handed over";
  let screenshot: string | null = null;
  if (o.url) {
    try {
      const res = await fillForm(ctx, o.url, app.answers, app.cover_letter, autoSubmit);
      screenshot = res.screenshot;
      outcome = res.submitted ? "submitted" : res.filled ? `pre-filled ${res.filled} field${res.filled > 1 ? "s" : ""}` : "handed over";
    } catch (e) {
      await ctx.log(`Form filling failed: ${(e as Error).message}`, undefined, "warn");
    }
  }
  const submitted = outcome === "submitted";
  await q("UPDATE applications SET status = $2, screenshot_path = $3, submitted_at = CASE WHEN $2 = 'submitted' THEN now() END WHERE id = $1", [applicationId, submitted ? "submitted" : "approved", screenshot]);
  await q("UPDATE opportunities SET status = $2, updated_at = now() WHERE id = $1", [opportunityId, submitted ? "applied" : "draft_ready"]);
  if (!submitted) {
    await q("INSERT INTO tasks (title, due_at, remind_at, sector_id, source) VALUES ($1, $2, now() + interval '2 hours', 'workexp', 'agent')", [
      `Submit application: ${o.title}${o.company ? ` (${o.company})` : ""}`, o.deadline,
    ]);
  }
  await sendTelegram(
    `${submitted ? "✅ Submitted" : "📝 Ready for you to submit"}: <b>${esc(o.title)}</b>\n` +
      (submitted ? "" : `I ${outcome === "handed over" ? "couldn't fill the form automatically (most need you to log in)" : outcome}. Your approved answers are below to paste in.\n`) +
      (o.url ? `\n${esc(o.url)}` : ""),
  );
  if (screenshot) await sendTelegramPhoto(screenshot, submitted ? "What was submitted" : "What I filled in so far").catch(() => false);
  if (!submitted) {
    for (const a of app.answers) await sendTelegram(`<b>${esc(a.question)}</b>\n\n${esc(a.answer)}`, { silent: true });
    if (app.cover_letter) await sendTelegram(`<b>Cover letter</b>\n\n${esc(app.cover_letter)}`, { silent: true });
  }
  return `Application #${applicationId}: ${outcome}`;
}

/** Best-effort form filling: match textarea/input labels to approved questions. Never submits unless autoSubmit is on and the form is simple. */
async function fillForm(ctx: AgentContext, url: string, answers: { question: string; answer: string }[], cover: string | null, autoSubmit: boolean) {
  return ctx.browser(BROWSER_PROFILE, async (browser) => {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(3000);
    const fields = await page.evaluate(() => {
      const out: { selector: string; label: string; required: boolean }[] = [];
      document.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>("textarea, input[type=text]").forEach((el, i) => {
        const id = el.id ? `#${CSS.escape(el.id)}` : null;
        el.setAttribute("data-bos", String(i));
        const label = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent) || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.closest("label, .field, .form-group, div")?.textContent || "";
        out.push({ selector: id ?? `[data-bos="${i}"]`, label: label.trim().slice(0, 300), required: el.required });
      });
      return out;
    });
    const words = (s: string) => new Set(s.toLowerCase().match(/[a-z]{4,}/g) ?? []);
    let filled = 0;
    for (const f of fields) {
      const lw = words(f.label);
      let best: { answer: string; score: number } | null = null;
      for (const a of answers) {
        const qw = words(a.question);
        const overlap = [...qw].filter((w) => lw.has(w)).length / Math.max(1, qw.size);
        if (!best || overlap > best.score) best = { answer: a.answer, score: overlap };
      }
      const value = /cover/i.test(f.label) && cover ? cover : best && best.score >= 0.4 ? best.answer : null;
      if (value && !value.includes("[ADD:")) {
        await page.fill(f.selector, value).then(() => filled++).catch(() => {});
      }
    }
    const cv = dataPath("profile", "cv.pdf");
    if (fs.existsSync(cv)) await page.locator("input[type=file]").first().setInputFiles(cv).catch(() => {});
    const shot = dataPath("applications", `${Date.now()}.png`);
    await page.screenshot({ path: shot, fullPage: true });

    let submitted = false;
    const unfilledRequired = fields.filter((f) => f.required).length > filled;
    const submits = page.locator('button[type=submit]:visible, input[type=submit]:visible');
    if (autoSubmit && filled > 0 && !unfilledRequired && (await submits.count()) === 1) {
      await submits.first().click();
      await page.waitForTimeout(4000);
      submitted = true;
      await page.screenshot({ path: shot, fullPage: true });
    }
    return { filled, submitted, screenshot: shot };
  });
}
