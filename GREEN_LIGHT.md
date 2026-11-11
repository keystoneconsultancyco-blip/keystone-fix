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
- **Switches on:** Ops Manager, AI Budget, Switch-On, Website Calculator, Nurture Tracking, Jarvis Feed and Agent Switch.
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
