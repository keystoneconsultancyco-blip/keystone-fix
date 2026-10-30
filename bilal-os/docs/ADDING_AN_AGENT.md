# Adding an agent

This is the exact recipe for requests like **"add a lead-finder agent to Keystone"**.
An agent is one TypeScript file in `src/agents/<sector>/`. You never need to touch
the core (`src/lib/`, `worker/`, the dashboard pages): registering the agent in its
sector's `index.ts` is enough for it to be scheduled, logged, budget-checked,
shown on the dashboard with an on/off switch, and retried on failure.

## 1. Scaffold it

```bash
cd bilal-os
npm run new-agent -- keystone lead-finder "Lead finder"
```

This creates `src/agents/keystone/lead-finder.ts` from the template and adds it to
`src/agents/keystone/index.ts`. If the sector folder doesn't exist yet (for example a
sector Bilal created from the dashboard), the folder and its `index.ts` are created and
registered in `src/agents/index.ts` too. **Use the same sector id the dashboard shows**
(the URL `/sectors/<id>`).

## 2. Fill in the definition

```ts
export const leadFinder: AgentDefinition = {
  id: "keystone.lead-finder",          // "<sector>.<slug>", unique, never rename once live
  sector: "keystone",
  name: "Lead finder",
  description: "Finds UK SMEs that may need finance-ops help and drafts intro emails.",
  schedule: "0 9 * * 1-5",             // cron in UK time; omit for on-demand only;
                                       // or async () => cron string from settings
  essential: false,                    // true = keeps running when the AI budget is used up
                                       //        (it must then work WITHOUT ctx.llm)
  permissions: ["browser", "llm", "telegram"],
  approvals: [{ kind: "send_email", description: "sending any outreach email" }],
  settings: [{ key: "maxLeads", label: "Leads per run", type: "number", default: 10 }],
  retries: 2,                          // optional, default 2 (exponential backoff)
  timeoutSeconds: 900,                 // optional
  quietWhenIdle: false,                // true for agents that poll often: skipped runs aren't logged

  async run(ctx) { ... return { summary: "Found 4 leads" }; },
  async onApproval(ctx, approval) { ... },   // only if it declares approvals
  async kpis() { return [{ label: "Leads this week", value: 12 }]; },
};
```

### Permissions (declare only what you use)

| Permission | Unlocks |
|---|---|
| `llm` | `ctx.llm(...)` — Anthropic, cost-tracked and budget-capped |
| `telegram` | `ctx.telegram(html, { buttons })` |
| `calendar` | `ctx.calendar()` — googleapis Calendar v3 client |
| `drive` | `ctx.drive()` — googleapis Drive v3 client (only files Bilal OS created) |
| `browser` | `ctx.browser(profile, async (browserContext) => …)` — persistent Playwright Chromium |
| `secrets:moodle` | `ctx.secret("moodle_username" / "moodle_password")` |

Using something you didn't declare throws a `PermissionError` (the run fails and is logged).
`ctx.alert`, `ctx.log`, `ctx.state`, `ctx.setting`, `ctx.config` and `ctx.runAgent` are always available.

## 3. The context (`ctx`) cheat-sheet

```ts
await ctx.log("Checked 30 companies", { extra: "data" });          // activity log (secrets auto-redacted)
const { text, json, costGbp } = await ctx.llm({
  tier: "fast",                     // "fast" = cheap model, "strong" = drafting model
  system: "…", prompt: "…",
  schema: { type: "object", … },    // optional: structured JSON output → `json`
  maxTokens: 4000, purpose: "score leads",
});
if (!(await ctx.llmAvailable())) { /* no key or over budget: do the non-AI version */ }

await ctx.alert("important", "Title", "Body", { url, dedupeKey: "lead-123" });
await ctx.requestApproval("send_email", "Email to Acme Ltd", "full text for Bilal to read", { leadId: 123 });
await ctx.telegram("<b>Hi</b>", { buttons: [[{ text: "Open", url: "https://…" }]] });

await ctx.state.get<string>("cursor"); await ctx.state.set("cursor", "abc");   // per-agent memory
await ctx.config<number>("maxLeads");                                       // per-agent setting
await ctx.setting("general.timezone");                                      // global setting
await ctx.runAgent("keystone.lead-scorer", { leadId: 1 });                  // chain agents
await ctx.browser("keystone", async (b) => { const page = await b.newPage(); … });
```

Database access: `import { q, one, tx } from "@/lib/db"` with parameterised SQL (`$1, $2`).

## 4. Escalation rules (use them consistently)

| Severity | Use for | What happens |
|---|---|---|
| `crucial` | Bilal must act within hours (MFA prompt, deadline today, budget exhausted, something broken that costs money) | Telegram immediately, even at night |
| `important` | Worth knowing today (new strong opportunity, new deadline, repeated failures) | Telegram now, or in the morning briefing if it's quiet hours |
| `info` | Nice to know (files synced, guide updated) | Dashboard + daily briefing only |

Always pass a `dedupeKey` when the same thing could be raised twice.

## 5. Approvals

Anything that **sends, submits, pays, posts, books or deletes** on Bilal's behalf must go through an approval:

1. Declare it: `approvals: [{ kind: "send_email", description: "sending any outreach email" }]`.
2. Ask: `await ctx.requestApproval("send_email", title, fullTextToReview, payload)`.
3. Act in `onApproval(ctx, approval)` — check `approval.status` (`"approved"` / `"rejected"`) and read `approval.payload`.

Bilal approves from the dashboard (Approvals page) or the ✅/❌ buttons on Telegram.

## 6. Optional extras

- **New tables:** add `migrations/00N_<name>.sql` (next number). They run automatically on start. Never edit an old migration.
- **Dashboard panel for the sector:** write an async server component and add it to `SECTOR_PANELS` in `src/components/sector-panels.tsx`. Mutations go in `src/app/actions.ts` and must start with `await guard()`.
- **Telegram commands/buttons:** create `src/agents/<sector>/telegram.ts` using `registerCommand` / `registerCallback` from `../pa/bot`, and add one import line to `src/agents/telegram.ts`.
- **New credential:** add it to `SECRET_DEFS` in `src/lib/settings.ts` (it appears on the Setup page), and add a permission in `src/lib/agent/types.ts` + check in `src/lib/agent/context.ts`.
- **New global setting:** add a default to `SETTING_DEFAULTS` in `src/lib/settings.ts`.

## 7. Checklist before committing

- [ ] `id` is `<sector>.<slug>` and unique; the sector exists.
- [ ] `permissions` lists exactly what `run` uses; anything outward-facing is behind an approval.
- [ ] AI calls use `tier: "fast"` unless quality really needs `"strong"`; inputs are trimmed to what's needed (the whole system has a £10/month cap).
- [ ] If `essential: true`, the agent still works when `ctx.llmAvailable()` is false.
- [ ] `run` returns a one-line `summary`; returns `{ skipped: true }` when there was nothing to do.
- [ ] Throw on real failures (the queue retries with backoff, and Bilal is alerted once after 3 failures). Don't swallow errors silently.
- [ ] No secrets in code or logs; credentials come from the Setup page via `ctx.secret`.
- [ ] Text for Bilal is UK English, plain and short.
- [ ] `npm run typecheck` and `npm test` pass.
- [ ] Commit and push; Railway redeploys; the agent appears on its sector page automatically.

## Worked example: "add a lead-finder agent to Keystone"

```ts
// src/agents/keystone/lead-finder.ts
import type { AgentDefinition } from "@/lib/agent/types";
import { q } from "@/lib/db";

export const leadFinder: AgentDefinition = {
  id: "keystone.lead-finder",
  sector: "keystone",
  name: "Lead finder",
  description: "Each weekday, finds small UK businesses hiring for bookkeeping/finance roles (a sign they need finance-ops help) and drafts an intro email for approval.",
  schedule: "30 9 * * 1-5",
  permissions: ["browser", "llm", "telegram"],
  approvals: [{ kind: "send_email", description: "sending any outreach email" }],
  settings: [{ key: "searchUrl", label: "Job search page to scan", type: "string", default: "https://…" }],
  async run(ctx) {
    const url = await ctx.config<string>("searchUrl");
    const text = await ctx.browser("keystone", async (b) => {
      const page = await b.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded" });
      return (await page.innerText("body")).slice(0, 30000);
    });
    const { json } = await ctx.llm({
      tier: "fast", purpose: "extract leads",
      schema: { type: "object", additionalProperties: false, required: ["leads"], properties: { leads: { type: "array", items: { type: "object", additionalProperties: false, required: ["company", "reason"], properties: { company: { type: "string" }, reason: { type: "string" } } } } } },
      prompt: `Pick companies that look like good finance-ops consultancy clients:\n${text}`,
    });
    for (const lead of json.leads.slice(0, 3)) {
      const draft = await ctx.llm({ tier: "strong", purpose: "intro email", prompt: `Write a short, honest intro email from Bilal at Keystone to ${lead.company}. Reason: ${lead.reason}` });
      await ctx.requestApproval("send_email", `Intro email to ${lead.company}`, draft.text, { company: lead.company, body: draft.text });
    }
    return { summary: `Found ${json.leads.length} leads, drafted ${Math.min(3, json.leads.length)} emails` };
  },
  async onApproval(ctx, approval) {
    if (approval.status !== "approved") return "Skipped";
    // send the email here (e.g. via a Gmail API helper with its own permission)
    await ctx.log(`Would send to ${approval.payload.company}`);
    return "Sent";
  },
  async kpis() {
    const r = await q<{ n: number }>("SELECT count(*)::int AS n FROM approvals WHERE agent_id = 'keystone.lead-finder' AND created_at > now() - interval '7 days'");
    return [{ label: "Leads drafted this week", value: r[0].n }];
  },
};
```
