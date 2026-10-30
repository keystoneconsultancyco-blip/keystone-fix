# Bilal OS

A 24/7 personal agentic operating system: a Next.js dashboard (installable on iPhone/iPad/desktop),
an always-on worker that runs agents on schedules, Postgres + pgvector, a two-way Telegram bot,
and Google Calendar/Drive integration.

- **Setting it up (no coding needed):** [`SETUP_GUIDE.md`](SETUP_GUIDE.md)
- **Adding a new agent:** [`docs/ADDING_AN_AGENT.md`](docs/ADDING_AN_AGENT.md)
- **Decisions and defaults:** [`ASSUMPTIONS.md`](ASSUMPTIONS.md)

## Developer quick start

```bash
cp .env.example .env            # fill DATABASE_URL and MASTER_KEY
npm install
npm run migrate
npm run dev                     # dashboard on http://localhost:3000
npm run worker                  # in a second terminal
npm test                        # unit tests
npm run new-agent -- <sector> <slug> "<Name>"   # scaffold an agent
```

## Layout

| Path | What |
|---|---|
| `src/app/` | Dashboard pages (Next.js App Router) and server actions |
| `src/agents/<sector>/` | Agents, one file each, listed in the sector's `index.ts` |
| `src/lib/` | Shared services: db, crypto, settings, llm + cost guard, alerts, approvals, telegram, google, browser, embeddings |
| `src/lib/agent/` | Agent plugin contract, runtime context, runner |
| `worker/index.ts` | Always-on worker: pg-boss schedules, Telegram bot, commands from the dashboard |
| `migrations/` | SQL migrations, run automatically on start |
| `tests/` | Unit tests; `tests/e2e/` has fake Telegram, Moodle and Anthropic servers for local end-to-end testing |
