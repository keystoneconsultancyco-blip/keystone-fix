# Assumptions & decisions

Choices made where the brief left something open. Each one is easy to change later.

## General

- **Truncated brief.** The build prompt was cut off mid-sentence in the escalation section ("Crucial aler…"), so the phase list after that point was not received. I inferred the rest:
  - Phase 1 core platform, Phase 2 PA, Phase 3 Uni Tutor, Phase 4 Work Experience, Phase 5 deployment + documentation.
  - Escalation rules (see below) were completed in the most sensible way.
- **Location in the repo.** The repository already holds the Keystone marketing website at the root (deployed to GitHub Pages). Bilal OS lives in its own folder, `bilal-os/`, so the website is untouched. On Railway set the service's *Root Directory* to `bilal-os`.
- **One Docker image, two services.** The same image runs the dashboard (`ROLE=web`, default) and the worker (`ROLE=worker`). Simpler to deploy and keeps versions in sync. The worker also answers `/api/health` on `$PORT` so Railway's health check works for both.
- **No ORM.** Plain SQL migrations in `migrations/` run automatically on every start (`npm run migrate`, guarded by a Postgres advisory lock). Easier for a future Claude Code session to read than generated ORM code.
- **Dashboard → worker commands** go through a `commands` table plus Postgres `LISTEN/NOTIFY` (with a 30-second polling fallback), so the web app never has to run jobs itself.

## Escalation (completing the truncated section)

| Severity | Dashboard | Telegram | Briefing |
|---|---|---|---|
| `crucial` | yes | immediately, even in quiet hours | yes |
| `important` | yes | immediately, unless quiet hours (22:30–07:30 by default) | held ones appear in the morning briefing |
| `info` | yes | never on its own | summarised in the daily briefing |

Open alerts with the same `dedupeKey` are never raised twice. Repeated job failures alert **once** (after 3 consecutive failed attempts) and send an "is working again" note when the job recovers.

## AI / cost

- **Models:** fast = `claude-haiku-5-5` (briefings, classification, summaries), strong = `claude-opus-5-5` (application drafting, module guides). Both editable on the Settings page.
- **Strong-tier calls** enable Anthropic's server-side refusal fallback (`fallbacks: "default"`), so an over-cautious refusal is retried automatically on another model instead of failing the job.
- **Prices** are stored in the `llm.prices` setting in US dollars per million tokens and converted at `llm.usdToGbp` (default 0.79). An unknown model is costed at the most expensive configured price so spend is never under-counted.
- **Hard cap of £10/month.** At 80% you get one Telegram warning. At 100%, AI calls are refused for the rest of the month (London calendar month). "Essential" agents (the morning briefing, the reminders agent) keep running but fall back to a plain template without AI — the cap is genuinely hard.
- **Embeddings** run locally with `Xenova/all-MiniLM-L6-v2` (384 dimensions) via transformers.js. The model (~25 MB) is downloaded once into the data volume.

## Security

- Passwords hashed with scrypt; TOTP 2FA is mandatory (enrolment is forced on first login). Sessions last 180 days, stored hashed in the database, `HttpOnly` + `Secure` + `SameSite=Lax` cookies.
- 5 wrong passwords/codes in 15 minutes locks the login for 15 minutes.
- Only **four** values live in environment variables: `DATABASE_URL`, `MASTER_KEY`, `APP_URL`, `DATA_DIR`. Every other credential is entered on the Setup page and stored AES-256-GCM encrypted.
- The activity log redacts anything that looks like a password, token or API key.
- Google uses the narrow `drive.file` scope: Bilal OS can only see Drive files and folders it created itself, not the rest of your Drive.
- Telegram only answers the chat linked through a one-time pairing code; messages from anyone else are ignored.

## Telegram

- Long polling (not webhooks), so no public webhook URL or extra configuration is needed.
