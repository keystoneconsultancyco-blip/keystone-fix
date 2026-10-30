import crypto from "node:crypto";
import type { AgentContext, AgentDefinition } from "@/lib/agent/types";
import { q, one } from "@/lib/db";
import { fromLondon } from "@/lib/time";

export const BROWSER_PROFILE = "jobs";
const MAX_PAGE_CHARS = 40_000;

const EXTRACT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["opportunities"],
  properties: {
    opportunities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "company", "url", "kind", "location", "deadline", "opens", "summary"],
        properties: {
          title: { type: "string" },
          company: { type: "string" },
          url: { type: "string", description: "Absolute link to the listing or application page, copied from the LINKS list." },
          kind: { type: "string", enum: ["spring_week", "insight_day", "internship", "work_experience", "other"] },
          location: { type: "string" },
          deadline: { type: "string", description: "YYYY-MM-DD, or empty if not stated." },
          opens: { type: "string", description: "YYYY-MM-DD when applications open, or empty." },
          summary: { type: "string", description: "One or two sentences." },
        },
      },
    },
  },
};

/** Visible text and links of a page, for the AI to read. */
export async function readPage(ctx: AgentContext, url: string): Promise<{ text: string; links: string }> {
  return ctx.browser(BROWSER_PROFILE, async (browser) => {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(3500); // let JavaScript-rendered listings load
    // Accept cookie banners so they don't hide content.
    await page.locator('button:has-text("Accept"), button:has-text("Agree"), button:has-text("Allow all")').first().click({ timeout: 1500 }).catch(() => {});
    const data = await page.evaluate(() => ({
      text: document.body.innerText,
      links: [...document.querySelectorAll<HTMLAnchorElement>("a[href]")]
        .map((a) => `${(a.innerText || "").trim().replace(/\s+/g, " ").slice(0, 100)} -> ${a.href}`)
        .filter((l) => l.length > 10 && !l.startsWith(" ->")),
    }));
    return { text: data.text.slice(0, MAX_PAGE_CHARS), links: [...new Set(data.links)].slice(0, 400).join("\n") };
  });
}

export function parseDay(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  return m ? fromLondon(+m[1], +m[2], +m[3], 23, 59) : null;
}

export async function extractOpportunities(ctx: AgentContext, sourceId: string, url: string): Promise<number> {
  const page = await readPage(ctx, url);
  const today = new Date().toISOString().slice(0, 10);
  const r = await ctx.llm({
    tier: "fast", schema: EXTRACT_SCHEMA, maxTokens: 8000, purpose: `extract ${sourceId}`,
    system: "You extract early-careers finance opportunities (spring weeks, insight days, work experience, first-year internships) from job-board pages. Only include real listings present on the page. Use URLs exactly as given in the LINKS list. UK English.",
    prompt: `Today is ${today}. Page: ${url}\n\nPAGE TEXT:\n${page.text}\n\nLINKS:\n${page.links}`,
  });
  let added = 0;
  for (const o of (r.json?.opportunities ?? []) as any[]) {
    if (!o.title || !o.url) continue;
    const externalId = crypto.createHash("sha1").update(o.url.replace(/[?#].*$/, "")).digest("hex").slice(0, 16);
    const row = await one<{ inserted: boolean }>(
      `INSERT INTO opportunities (source, external_id, title, company, url, location, kind, description, deadline, opens_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (source, external_id) DO UPDATE SET deadline = coalesce(EXCLUDED.deadline, opportunities.deadline), updated_at = now()
       RETURNING (xmax = 0) AS inserted`,
      [sourceId, externalId, o.title.slice(0, 300), o.company || null, o.url, o.location || null, o.kind, o.summary || null, parseDay(o.deadline), parseDay(o.opens)],
    );
    if (row?.inserted) added++;
  }
  return added;
}

export const opportunityFinder: AgentDefinition = {
  id: "workexp.opportunity-finder",
  sector: "workexp",
  name: "Opportunity finder",
  description: "Checks job boards twice a day for spring weeks, insight days and work experience in finance.",
  schedule: "10 8,18 * * *",
  permissions: ["browser", "llm"],
  timeoutSeconds: 1800,
  async run(ctx) {
    const sources = (await ctx.setting("workexp.sources")).filter((s) => s.enabled);
    // A single URL can also be passed in (e.g. "add this listing" from the dashboard).
    const single = typeof ctx.input.url === "string" ? [{ id: "manual", name: "Added by you", url: ctx.input.url, enabled: true }] : null;
    let added = 0;
    const errors: string[] = [];
    for (const s of single ?? sources) {
      try {
        const n = await extractOpportunities(ctx, s.id, s.url);
        added += n;
        await ctx.log(`${s.name}: ${n} new`);
      } catch (e) {
        errors.push(`${s.name}: ${(e as Error).message}`);
        await ctx.log(`${s.name} failed: ${(e as Error).message}`, undefined, "warn");
      }
    }
    if (errors.length === (single ?? sources).length && errors.length) throw new Error(errors.join("; "));
    if (added) await ctx.runAgent("workexp.opportunity-scorer");
    return { summary: `${added} new opportunit${added === 1 ? "y" : "ies"}${errors.length ? ` (${errors.length} source${errors.length > 1 ? "s" : ""} failed)` : ""}` };
  },
  async kpis() {
    const r = await one<{ week: number; open: number }>(
      `SELECT count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS week,
              count(*) FILTER (WHERE status IN ('new','shortlisted','drafting','draft_ready') AND (deadline IS NULL OR deadline > now()))::int AS open
       FROM opportunities`,
    );
    return [{ label: "New this week", value: r?.week ?? 0 }, { label: "Open opportunities", value: r?.open ?? 0 }];
  },
};
