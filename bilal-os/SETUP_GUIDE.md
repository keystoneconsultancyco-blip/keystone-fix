# Bilal OS — setup guide

This guide takes you from nothing to a working Bilal OS running 24/7, step by step.
You don't need to know how to code. Set aside about **1½ hours**. Do the steps in order.

**What you'll end up with**

- A private dashboard at an address like `https://bilal-os-web.up.railway.app` that you can add to your iPhone, iPad and laptop home screens.
- A Telegram bot that texts you your day each morning, reminds you about things, and lets you text it back.
- Your Moodle files organised in Google Drive, ready for tutoring in the Claude app.
- A work-experience scout that finds spring weeks and drafts applications for you to approve.

**What it costs (roughly)**

| Thing | Cost |
|---|---|
| Railway (hosting) | Hobby plan $5/month (about £4), which includes $5 of usage. Bilal OS (dashboard + worker + database) typically uses a bit more than that, so expect roughly **£5–£10/month**. You can see live usage in Railway. |
| Anthropic API (AI) | Pay-as-you-go. Capped by Bilal OS at **£10/month** (you can change this). Normal use is usually well under that. |
| Telegram, Google | Free |

---

## Step 1 — Accounts you need

Create these if you don't have them (all free to sign up):

1. **GitHub** — you already have this; the code lives in your `keystone-fix` repository.
2. **Railway** — go to <https://railway.com>, click **Login → Login with GitHub**. Then choose the **Hobby** plan under *Account → Plans* (needed for always-on services).
3. **Anthropic Console** — go to <https://console.anthropic.com> and sign up. This is separate from your Claude app subscription.
4. **Telegram** — install the Telegram app on your phone and sign up.
5. **Google** — your normal Google account (the one whose Drive and Calendar you use).

---

## Step 2 — Make a secret key (MASTER_KEY)

Bilal OS encrypts every password and API key with one master key. You make it once.

1. Go to <https://www.random.org/bytes/>.
2. Set **Number of bytes** to `32` and **Format** to *Hexadecimal*. Click **Get Bytes**.
3. Copy the result and **remove all the spaces** so it's one long line of 64 characters (letters a–f and numbers).
4. Save it in your password manager (e.g. iPhone Passwords) as "Bilal OS MASTER_KEY".

> ⚠️ Never change or lose this key after setup. If you do, all saved credentials become unreadable and you'll have to enter them again on the Setup page.

---

## Step 3 — Create the project on Railway

### 3a. The database

1. In Railway, click **New Project**.
2. Choose **Deploy a Template**, search for **pgvector**, and pick the **pgvector** Postgres template (it includes the vector extension Bilal OS needs for search). Click **Deploy**.
3. Wait until the database box turns green. Click it and note its name (e.g. `pgvector`).

### 3b. The dashboard (web service)

1. In the same project, click **+ Create → GitHub Repo** and choose **keystone-fix**.
2. Click the new service, open **Settings**:
   - **Source → Root Directory:** type `bilal-os` and press Enter.
   - **Source → Branch:** choose the branch with Bilal OS (`main` once it's merged).
   - **Service name** (top): rename it to `web`.
3. Open the **Variables** tab and click **+ New Variable** for each of these:

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | `${{pgvector.DATABASE_URL}}` (type it exactly; Railway fills in the real value. If your database service has a different name, use that name instead of `pgvector`.) |
   | `MASTER_KEY` | the 64-character key from Step 2 |
   | `APP_URL` | leave for now — you'll set it in 3d |
   | `ROLE` | `web` |

4. Go to **Settings → Networking → Public Networking** and click **Generate Domain**. Railway gives you an address like `web-production-1234.up.railway.app`. Copy it.

### 3c. The worker (the part that runs 24/7)

1. Click **+ Create → GitHub Repo → keystone-fix** again (a second service from the same repo).
2. In **Settings**: Root Directory `bilal-os`, same branch, rename the service to `worker`.
3. **Variables:** add the same `DATABASE_URL` and `MASTER_KEY`, plus:

   | Name | Value |
   |---|---|
   | `ROLE` | `worker` |
   | `DATA_DIR` | `/data` |
   | `PORT` | `3000` (for Railway's health check) |
   | `APP_URL` | (set in 3d) |

4. Give the worker a **volume** (persistent storage for downloaded files and the browser's login session): right-click the worker box (or use **+ Create → Volume**), attach it to `worker`, and set the **mount path** to `/data`.
5. The worker doesn't need a public domain.

### 3d. Set APP_URL on both services

On **both** `web` and `worker`, set `APP_URL` to your dashboard address **with https://**, e.g. `https://web-production-1234.up.railway.app` (no slash at the end).

### 3e. Deploy

Railway builds and starts both services automatically after variable changes (it takes ~5–8 minutes the first time). When both boxes are green:

- Open `https://<your-address>/api/health` — you should see `"ok":true` and, after a minute, `"worker":"ok"`.

> If a deploy fails, click the service → **Deployments** → the failed one → **View logs**, and copy the red lines into a Claude Code session in this repo — it will know what to do.

---

## Alternative: one-click setup on Render

If Railway isn't available, use Render instead. The repository contains `render.yaml`, which creates everything for you: the database, the dashboard, the always-on worker with its storage, and a randomly generated `MASTER_KEY`.

1. Sign up at <https://render.com> with GitHub and add a payment card.
2. **New → Blueprint** → pick your repository → branch `claude/bilal-os-build-dpbr7w` → **Apply**.
3. Wait about 10 minutes until all three show **Available / Live**.
4. Open the dashboard address Render shows for `bilal-os` (e.g. `https://bilal-os.onrender.com`) and continue from **Step 4 — Create your dashboard login** above.

Notes: the dashboard runs on Render's free tier, so it naps after 15 minutes unused and takes ~30 seconds to wake. The worker and database are paid and always on. You don't need to set `APP_URL` on Render.

---

## Step 4 — Create your dashboard login

1. Open your dashboard address in Safari/Chrome.
2. Choose a **password of 12+ characters** (save it in your password manager).
3. You'll be asked to set up **two-step login**: open an authenticator app (iPhone: *Settings → Passwords → [any entry] → Set Up Verification Code*, or Google Authenticator / Microsoft Authenticator), scan the QR code, and type the 6-digit code.
4. You land on the **Setup** page. Your phone/laptop stays signed in for 6 months.

---

## Step 5 — Connect the AI (Anthropic)

1. Go to <https://console.anthropic.com> → **Settings → Billing** and add a card. Buy **$10 of credit** to start (you can turn on auto-reload later; Bilal OS still enforces your monthly cap).
2. Go to **API keys → Create key**, name it `bilal-os`, and copy it (starts with `sk-ant-`).
3. In your dashboard **Setup** page, paste it into **Anthropic API key**, press **Save**, then **Test AI connection**. You should see `Anthropic replied: "ok"`.

---

## Step 6 — Connect Telegram

1. In Telegram, search for **@BotFather** (blue tick) and open it.
2. Send `/newbot`. Give it a name (e.g. `Bilal OS`) and a username ending in `bot` (e.g. `bilal_os_pa_bot`).
3. BotFather replies with a **token** like `123456789:AA…`. Copy it.
4. On the dashboard **Setup** page, paste it into **Telegram bot token** → **Save**.
5. Click **Link my Telegram**. Tap the link it shows (or open your bot and send the `/start CODE` it shows). The bot replies "✅ Linked!".
6. Click **Send test message** to check.

From now on, you can text the bot things like:

- `remind me to email my tutor at 4pm`
- `what's on tomorrow?`
- `/today`, `/tasks`, `/done 2`, `/deadlines`, `/jobs`, `/spend`, `/help`

---

## Step 7 — Connect Google Calendar & Drive

This is the fiddliest step. Take it slowly.

1. Go to <https://console.cloud.google.com> and sign in with your Google account.
2. At the top, click the project picker → **New Project** → name `Bilal OS` → **Create**. Make sure it's selected.
3. Turn on the APIs: search the top bar for **Google Calendar API** → **Enable**. Then search **Google Drive API** → **Enable**.
4. Left menu → **APIs & Services → OAuth consent screen** (may be called **Google Auth Platform**):
   - Click **Get started**. App name `Bilal OS`, support email = your email. Audience: **External**. Contact email = your email. Agree and **Create**.
   - Under **Audience**, add your own Gmail address as a **Test user**.
   - Then click **Publish app** → confirm. *(Important: apps left in "Testing" lose access every 7 days. Publishing for your own use is fine; Google will show an "unverified app" warning that you can click through because you made it.)*
5. Left menu → **Clients** (or **Credentials → Create credentials → OAuth client ID**):
   - Application type: **Web application**. Name: `Bilal OS`.
   - **Authorised redirect URIs → Add URI:** copy the exact address shown on your dashboard's Setup page under "Google Calendar & Drive" (it looks like `https://<your-address>/api/google/callback`).
   - **Create**. Copy the **Client ID** and **Client secret**.
6. On the dashboard **Setup** page, paste the Client ID and Client secret → **Save** each.
7. Click **Connect Google**. Choose your account. If you see "Google hasn't verified this app", click **Advanced → Go to Bilal OS (unsafe)** — it's your own app. Tick both permissions and **Continue**.
8. You're sent back to Setup with Google showing **connected**.

> Bilal OS can only see Drive files **it creates** (the `Bilal OS — Uni` folder), not the rest of your Drive.

---

## Step 8 — Connect Moodle (Royal Holloway)

1. On the **Setup** page, enter your **RHUL username / email** and **RHUL password** → **Save** each. They're encrypted and only used by the Moodle and timetable agents.
2. Go to **Uni Tutor → Agents** and press **Run now** on **Moodle sync**.
3. If your university login uses **Microsoft Authenticator**, your Telegram will buzz with "Approve your RHUL sign-in: enter **NN**". Open Authenticator and approve it (type the number). If it asks for a 6-digit code instead, just **reply to the bot with the code**.
   - Bilal OS ticks "Stay signed in", so you'll rarely need to do this again.
4. After a few minutes, refresh **Uni Tutor**: your modules appear, files are downloaded, deadlines show on the Hub, and Drive fills up shortly after (the Drive organiser runs every hour, or press **Run now**).

**Timetable:** Bilal OS tries to find your timetable's calendar link automatically. If it can't, you'll get an alert. Then:
1. Log in to the RHUL timetable website, look for **Subscribe**, **iCal**, **Add to calendar** or **Export**, and copy the link.
2. Paste it into **Uni Tutor → Overview → Uni settings → Timetable iCal link** → **Save**.

**Use it with Claude:** in the Claude app, connect Google Drive (Settings → Connectors) and ask things like *"Using my Drive folder for EC1101, explain this week's lecture step by step"*. Each module folder has a **00 Module Guide** (written weekly) and **00 Index**.

---

## Step 9 — Work Experience

1. Go to **Work Experience → Overview**.
2. Upload your **CV (PDF)** — its text is used for drafting. Check **About you** and **Target areas**.
3. The finder checks the job boards in **Where to look** twice a day. You can add any page that lists opportunities, or paste one listing's link under **Found one yourself?**
4. Good matches arrive on Telegram with **Draft application / Shortlist / Ignore** buttons.
5. Drafts arrive in **Approvals** (and on Telegram). Read them, fix anything marked **[ADD: …]**, then approve. Bilal OS pre-fills what it can on the form, sends you a screenshot and your answers, and adds a reminder to submit. **It never submits for you** unless you switch on `workexp.autoSubmit` (not recommended).

---

## Step 10 — Put it on your home screens

- **iPhone / iPad (Safari):** open your dashboard → **Share** button → **Add to Home Screen** → **Add**.
- **Mac (Safari):** **File → Add to Dock**. **Chrome (Mac/Windows):** the install icon in the address bar, or ⋮ → **Cast, save and share → Install page as app**.

---

## Everyday use

- **Hub** — today's timetable and calendar, tasks, deadlines, alerts, approvals, AI spend, and system health.
- **Approvals** — anything an agent wants to do on your behalf waits here.
- **Each sector page** — agents (switch on/off, **Run now**), activity log, KPIs, alerts, approvals and settings.
- **Settings** — AI budget, model names, briefing times, quiet hours, add a new sector.
- **Health & spend** — worker heartbeat, failing jobs, spend by model and agent, recent runs.

**Alerts:** 🚨 *crucial* reach Telegram immediately; ⚠️ *important* reach Telegram unless it's quiet hours (then they're in your morning briefing); *info* stay on the dashboard and in the briefing. If a job keeps failing you're told **once**, and again when it recovers.

**AI budget:** you get a Telegram warning at 80%. At 100%, non-essential AI jobs pause until the 1st of the month; your briefings and reminders keep coming (in a simpler, non-AI form).

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Dashboard says **"Worker not started"** / heartbeat old | Railway → `worker` → Deployments → View logs. Common cause: `DATABASE_URL` or `MASTER_KEY` missing or different from the web service. |
| Telegram doesn't answer | Check the token on Setup, press **Link my Telegram** again, and make sure the worker is running. Only one copy of the worker may run with the same bot token. |
| Google stops working after a week | The OAuth app is still in "Testing". Publish it (Step 7.4), then **Reconnect Google**. |
| Moodle sync fails with "rejected the username or password" | Re-enter your RHUL login on Setup. If you changed your university password, update it here too. |
| Moodle sync keeps waiting for MFA | Make sure you approve the Authenticator prompt within 3 minutes, or reply to the bot with the 6-digit code. |
| "Monthly AI budget reached" | Raise **Monthly cap** on Settings, or wait for the 1st. |
| Anything else | Open the failing run on **Health & spend**, copy the error, and ask Claude Code in this repo. |

## Changing or adding things later

Open Claude Code in this repository and ask, e.g. *"add a lead-finder agent to Keystone"*.
It follows `docs/ADDING_AN_AGENT.md`. When it pushes, Railway redeploys automatically and the new agent appears on the dashboard.
