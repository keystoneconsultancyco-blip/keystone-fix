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

## Personal Assistant (Phase 2)

- Morning briefing 07:00 and evening wrap-up 21:30 (UK time), both editable. Both are *essential*: when AI is unavailable they send a plain template instead.
- Reminders are checked every minute. Reminders wait (rather than being marked sent) until Telegram is linked.
- Deadline warnings go out at 7 days, 2 days, 1 day and 3 hours before — only the tightest applicable one, once each.
- Google Calendar is synced every 15 minutes for the next 21 days (`primary` calendar by default; more calendar IDs can be added in the agent's settings).
- "remind me to X at/in Y" is understood **without AI** (free). Anything else goes to the fast model, which turns it into an action (task, calendar event, schedule question, …). There is deliberately no general tutoring chat — the bot points study questions to the Claude app.

## Uni Tutor (Phase 3)

- **Moodle access** uses a real headless browser with a persistent profile, then Moodle's own internal AJAX API (`core_course_get_enrolled_courses_by_timeline_classification`, `core_calendar_get_action_events_by_timesort`) and the course pages. This works whether RHUL uses the plain Moodle login form or Microsoft single sign-on. I could not test against the real RHUL Moodle from the build environment, so it was tested end to end against a fake Moodle (`tests/e2e/fake-moodle.mjs`). Selectors may need a small tweak on first real run — the error will show on the Health page.
- **Microsoft MFA:** number-matching prompts are sent to Telegram as *crucial* alerts; 6-digit code prompts ask you to reply with the code. "Stay signed in" is ticked to avoid repeated MFA.
- Synced activity types: files (`resource`), folders, pages and assignment briefs. Videos, archives and files over 80 MB are skipped. Unchanged files are not downloaded again.
- Moodle sync runs at 06:15, 13:15 and 19:15. Courses whose names contain "Induction", "Skills", "Library" or "Careers" are ignored (editable); any module can be switched off on the Uni page.
- **Timetable** comes from the personal iCal feed of the RHUL timetable system (most reliable); the agent tries to discover the link itself and otherwise asks you for it. Timetable events are also written to Google Calendar (blue, tagged so they aren't double-counted), which you can switch off.
- **Drive layout:** `Bilal OS — Uni / <CODE — Module name> / Week NN — <topic> /`, plus `Assessments`, a `00 Index` doc and a `00 Module Guide` doc per module, and a top-level "README — how to use with Claude". Word/PowerPoint files are converted to Google Docs/Slides so the Claude app can read them; PDFs stay as PDFs.
- **Module guides** are built weekly (Sunday 17:00) with the strong model, **only for weeks whose files changed**, at most 6 sections per run, and only if at least £0.60 of budget is left. Source material per week is capped at ~15k tokens. Written for someone without A-level Maths: every step shown, worked numerical examples, key-term tables and self-check questions.
- **Search** uses local embeddings (`all-MiniLM-L6-v2`) over ~1,000-character passages; it powers the search box on the Uni page and costs nothing.

## Work Experience (Phase 4)

- Default job-board sources (Bright Network, RateMyPlacement, TARGETjobs) are starting points — their exact search URLs change often, so they're editable as a list on the Work Experience page. The finder reads any listing page with a browser and the fast model extracts the opportunities, so no site-specific code is needed.
- Scoring favours first-year eligibility, spring weeks/insight programmes, PE/investment/IB/asset management, and UK/London. 70+ (editable) triggers a Telegram message with **Draft / Shortlist / Ignore** buttons; below 30 is auto-ignored.
- Drafts use the strong model with your profile and CV text; unknown facts are left as `[ADD: …]` and possibly-outdated market facts are marked `[CHECK]`.
- **Applications are never submitted without approval.** After approval, Bilal OS opens the form, fills fields whose labels match the approved questions, uploads your CV if there's a file field, screenshots it and sends you the answers to paste. `workexp.autoSubmit` is **off** by default; even when on, it only clicks submit if there is exactly one submit button and every required field was filled. Most employer portals need you to log in, so expect to submit yourself.

## Deployment (Phase 5)

- Railway volumes can only attach to one service, so the **worker** owns the volume (`/data`: downloads, browser sessions, embedding model). Things the dashboard also needs (your CV) are stored in Postgres (`blobs` table). The dashboard downloads its own copy of the small embedding model on first search.
- Postgres must have **pgvector** — use Railway's *pgvector* template.
- The Docker image is based on `mcr.microsoft.com/playwright:v1.63.0-noble`, matching the pinned `playwright@1.63.0`. It was built and run locally (web + worker against a fresh database, Chromium launched inside the container) before handing over.
- Railway pricing in the setup guide is approximate; check Railway's live usage page.
