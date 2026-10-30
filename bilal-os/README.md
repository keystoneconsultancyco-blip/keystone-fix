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
```
