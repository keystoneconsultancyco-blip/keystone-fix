# GREEN LIGHT: switching Keystone back on

**Keystone is PAUSED** (since 11 Nov 2026). Nothing runs until Bilal says **"GREEN LIGHT"**. Do not start this procedure before that.

Order: **alerts → core services → operations → agents → outside n8n**. Each stage is tested before the next. If a stage fails, stop and tell Bilal; do not go on. The whole procedure takes about 20 minutes and uses about 12 n8n executions for testing.

All commands run from `keystone-fix/ops`.

## What was paused (for reference)
- **n8n:** all 26 active workflows switched off. Full backups and the list of which were on are in `n8n/backups/2026-11-11-pause/` (`_active_before_pause.json`). 12 workflows were already off (tests, helpers, and agents waiting for client thresholds); they stay off.
- **Claude scheduled task:** "Email Bilal the trading trial report" (one-off, was due 14 Nov 09:00) was switched off. All other Keystone scheduled tasks were already off.
- **Jarvis GitHub Actions:** the hourly "Jarvis agents" schedule was taken out of `.github/workflows/agents.yml` on `main` (it can still be run by hand).
- **Website:** the calculator shows "coming soon" (`CALC_PAUSED = true` in `script.js`) and the two "See a live example" demo links are commented out.
- **Keystone Settings:** `system_status` = `PAUSED`. While it says PAUSED, `scripts/deploy.js` and `scripts/stock.js` will not switch any workflow on.

## Step 0: before you start (2 minutes)
1. Bilal has said **"GREEN LIGHT"** (in his own words, in the conversation).
2. n8n has executions left this month: n8n → Settings → Usage. If the allowance is used up, nothing will run: upgrading or waiting for the reset is Bilal's decision.
3. Look at the current state (read only, no executions):
   ```bash
   NODE_USE_ENV_PROXY=1 node --no-warnings scripts/green-light.js status
   ```
   Expect: `system_status = PAUSED`, 0 active workflows.

## Step 0b: apply the email sender update (from 15 Nov; no executions)
```bash
NODE_USE_ENV_PROXY=1 KS_GREEN_LIGHT=1 node --no-warnings scripts/green-light.js senders
```
- **What it does:**
  - redeploys every KS workflow with the new senders, all kept **off**;
  - patches the [Stock] workflows (change 11: Reply-To on their 10 email nodes, and Client Config rebuilt);
  - backs up each [Stock] workflow first.
- **Pass:** every line says `(off)` and the last line says `Active workflows after the sender update: 0`.
- **Who emails come from** once Resend has verified `keystoneconsultancyuk.co.uk` (until then, Resend's test sender, which reaches only Bilal):

| Sender | Used for |
|---|---|
| Bilal Khan \| Keystone &lt;bilal.khan@keystoneconsultancyuk.co.uk&gt; | outreach, proposals, audits, nurture, client emails from Bilal |
| Keystone Accounts &lt;accounts@keystoneconsultancyuk.co.uk&gt; | invoices, quotes, payment reminders |
| Keystone Operations &lt;operations@keystoneconsultancyuk.co.uk&gt; | bookings, reports, alerts, all automatic notifications |

  Reply-To on every email: keystoneconsultancy.co@gmail.com. All four are editable in Keystone Settings (`sender_personal`, `sender_accounts`, `sender_operations`, `reply_to`). A client with their own From address keeps it.
- **Domain:** on 15 Nov Resend showed the domain as **failed**: none of the DNS records were found. Add the records from the DNS email in Namecheap first. Switch-On (Step 3) then asks Resend to check again.

## Step 0c: audit flow (built 15 Nov, see `docs/AUDIT_PLAYBOOK.md`)
Do these before Step 3, which switches on **KS Audit Flow**:
1. **n8n credential "Keystone Stripe":** n8n → Credentials → New → **Header Auth**. Name: `Keystone Stripe`; header name: `Authorization`; value: `Bearer rk_live_…`, the same restricted key you gave me. Then run Step 0b again so the Stripe steps are redeployed.
2. **Stripe webhook on:** Stripe → Developers → Webhooks → "Keystone audit flow (KS Audit Flow)" (`we_1Uc7iYJR8vcxCxOmQ9hh9x4B`) → **Enable**. Or ask me to enable it.
3. **Airtable automation:** Airtable → Keystone Client Finder → Automations → Create:
   - **Trigger:** "When a record is updated", table **Audit Intakes**. Fields: Available slots, Confirm, Confirmed time at, Call 1 notes, Approve report, Call 2 slots, Confirm call 2, Call 2 confirmed at, Outcome.
   - **Action:** "Run a script". Input variable `recordId` = the trigger's Airtable record ID. Script:
     ```js
     const cfg = input.config();
     const settings = await base.getTable('Keystone Settings').selectRecordsAsync({ fields: ['Setting', 'Value'] });
     const row = settings.records.find((r) => r.getCellValueAsString('Setting') === 'audit_hook_token');
     await fetch('https://keystoneconsultancy.app.n8n.cloud/webhook/ks-audit-step', { method: 'POST', headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ recordId: cfg.recordId, token: row ? row.getCellValueAsString('Value') : '' }) });
     ```
   - Turn it on. If your Airtable plan has no "Run a script" action, skip this: the audit flow still checks every 2 hours from 09:05 to 19:05, so things you tick are actioned within 2 hours instead of straight away.
4. **Email forwarding:** Namecheap → Domain → **Redirect Email**: `bilal.khan@`, `accounts@` and `operations@` keystoneconsultancyuk.co.uk → your gmail. Client replies go to bilal.khan@, so test it by sending an email there.
5. **Website contact address:** once forwarding works, merge branch `green-light-contact` in `keystone-website-v3`. It replaces the gmail with bilal.khan@ on every page.
6. **Before the first Won:** a solicitor checks `docs/CLIENT_AGREEMENT.md`, then set `agreement_approved` = yes and fill `keystone_xero_tenant_id`.

## Step 0d: cold outreach (built 16 Nov, `ops/lib/coldoutreach.js`)
1. **Companies House API key** (free): register at developer.company-information.service.gov.uk, create an application, then add a "REST" API key. In n8n → Credentials → New → **Basic Auth**: name `Keystone Companies House`, user = the key, password empty. Then run Step 0b again.
2. **Business address:** Keystone Settings → `business_address`. Every cold email shows it; nothing sends while it is empty. A virtual office address is fine if you'd rather not show your home.
3. **Receiving replies:** Resend → Domains → add `reply.keystoneconsultancyuk.co.uk` with **receiving** switched on. Add the MX record Resend shows in Namecheap (host `reply`). Replies to cold emails go to team@reply.…
4. **Resend webhook:** Resend → Webhooks → add `https://keystoneconsultancy.app.n8n.cloud/webhook/ks-resend-events` with events `email.received`, `email.bounced`, `email.complained`. Or ask me to create it.
5. **n8n Resend key must be full access** (credential "Header Auth account 2"), so n8n can read the replies.
6. **How it runs:**
   - You approve the first 20 cold emails one by one (Outreach agent YES/NO, all from The Keystone Team, with footer).
   - Then KS Cold Outreach sends automatically on weekdays at 09:40 and 13:40: 10 a day in week 1, 20 in week 2, 30 in week 3, and 40 from week 4.
   - Only prospects that Companies House shows as an active limited company or LLP are emailed.
   - Interested replies come to you as a YES/NO with a drafted answer. Every Monday you get a summary.
   - To stop at any time: `cold_outreach` = off.

## Step 1: alerts
```bash
NODE_USE_ENV_PROXY=1 KS_GREEN_LIGHT=1 node --no-warnings scripts/green-light.js alerts
```
Switches on **KS Ops - Notify** and **KS Ops - Failure Alerts**. Pass: both say `ON` and `active`.

## Step 2: core services
```bash
NODE_USE_ENV_PROXY=1 KS_GREEN_LIGHT=1 node --no-warnings scripts/green-light.js core
```
- **Switches on:**
  - both Client Config sub-workflows;
  - Invoice Automation and the Sheet Poller;
  - Monthly Reporting;
  - Phone IVR, Vapi Tools and Post-Call;
  - Quote Calculator, Audit Agent, and Weekly Money + Dashboard.
- **Tests:** the demo quote form page should return 200; invoice "poll now" should return 2xx; the newest execution should show as `success`.
- **If something fails:** check n8n → Executions, and Bilal's inbox for a failure alert. A failure alert arriving also proves Step 1 works.

## Step 3: operations
```bash
NODE_USE_ENV_PROXY=1 KS_GREEN_LIGHT=1 node --no-warnings scripts/green-light.js ops
```
- **Switches on:** Ops Manager, AI Budget, Switch-On, Website Calculator, Nurture Tracking, Jarvis Feed, Agent Switch and **KS Audit Flow** (new; it was never on before the pause).
- **Tests (each should say OK):**
  - Jarvis feed should return `ok:true`;
  - the email open pixel should return 200;
  - the website calculator bot test should return 200, and it stores and sends nothing;
  - the Switch-On check should return 2xx. It also re-checks the email domain `keystoneconsultancyuk.co.uk` with Resend.

## Step 4: agents
```bash
NODE_USE_ENV_PROXY=1 KS_GREEN_LIGHT=1 node --no-warnings scripts/green-light.js agents
```
- **Switches on:** Ops Monitor, Chief of Staff, Client Hunter, Outreach, Sales Prep and Nurture. Onboarding, Client Success, CFO, Content, Compliance and Systems Builder stay off until their client thresholds.
- **Test:** Ops Monitor runs once. Pass: its row in Airtable → Agent Team Log says **26/26 workflows on**, and it records `n8n_exec_used`.
- **No forced runs:** the other agents start on their normal schedules, because forced runs would spend AI credit and could send emails.

## Step 5: outside n8n
1. **Website** (`keystone-website-v3`, branch `main`):
   - In `script.js`, set `var CALC_PAUSED = false;`.
   - In `index.html` and `services.html`, un-comment the two `<!-- PAUSED until GREEN LIGHT: ... -->` demo links.
   - Commit and push. GitHub Pages republishes in about a minute.
   - Then open the live site, click "Get your estimate", and check the form appears (not "coming soon").
2. **Jarvis** (`Jarvis` repo, branch `main`):
   - In `.github/workflows/agents.yml`, put the schedule back under `on:`:
     ```yaml
     on:
       schedule:
         - cron: "17 * * * *"
       workflow_dispatch:
     ```
   - Commit and push. Check GitHub → Actions → "Jarvis agents" shows the next scheduled run.
3. **Claude scheduled task** "Email Bilal the trading trial report":
   - **Before 14 Nov 09:00:** switch it back on.
   - **After that time:** ask Bilal whether to run it once now.
   - "Keystone Nurture reply check" stays off until Bilal adds the Gmail and Airtable connectors to it.

## Step 6: final check
```bash
NODE_USE_ENV_PROXY=1 KS_GREEN_LIGHT=1 node --no-warnings scripts/green-light.js check
```
- **Pass:** `Active now: 26. Active before the pause: 26. Missing: none`. The script then sets `system_status` = `LIVE` by itself.
- **Report to Bilal:** a short list of what's back on, each test result, and the n8n executions used by the tests.

## If you need to pause again
- Run `scripts/green-light.js status` to see what is on.
- Set `system_status` = `PAUSED`, then switch off every active workflow in n8n (as on 11 Nov 2026).
- Repeat the "What was paused" list above.
