# How Keystone fits together

```
                Airtable "Keystone Client Finder"  (single source of truth)
   My Clients · Discounts · Quote Services · Quote Factors · Keystone Settings
   Agent Log · Call Log · Quotes · Needs Review · Ops Approvals · (Prospects etc. untouched)
                                   │ read by every run
 ┌──────────────────────────────── n8n Cloud ─────────────────────────────────────┐
 │ Client Config (Invoice / Phone)  ← sub-workflows: registry row → same fields     │
 │                                                                                   │
 │ Sheet Poller (5 min) → Invoice Automation ─→ Xero DRAFT ─→ Resend email           │
 │      client jobs sheets       │  messy data → Claude exception agent → DRAFT      │
 │                               │  or Needs Review + email      → Agent Log         │
 │                                                                                   │
 │ Twilio call → Inbound IVR ─1→ reception                                           │
 │                         └2→ Vapi (SIP) ↔ Vapi Tools (Calendar, Quote Calculator,  │
 │                                          urgent/complaint/message → Notify)       │
 │                Vapi end-of-call → Post-Call (emails, Call Log, safety net)        │
 │                                                                                   │
 │ Quote Calculator  (form page · phone · manual · approve link)                     │
 │ Monthly Reporting (1st of month) → value report email + Drive archive             │
 │ Ops Manager: 07:30 / 18:00 summaries · YES/NO approvals (email link / SMS reply)  │
 │ Ops - Notify (private): picks SMS or email; creates approvals                     │
 │ Ops - Failure Alerts: Error workflow on every workflow → email + SMS + Agent Log   │
 └───────────────────────────────────────────────────────────────────────────────────┘
```

## Rules built in
- **Every run is scoped to one client row** (by client ID, then called number, then "the only active client"). Stopped, paused, halal-screen or AI-disclosure failures stop the service safely.
- **Money:** every invoice is a Xero DRAFT; no payments are recorded; the AI never invents an amount.
- **Fail-safe:** callers always reach reception or voicemail, jobs stay in the sheet, and any failure emails Bilal (and texts once Twilio is live).
- **Demo clients** never email anyone except Bilal.

## Code layout (`keystone-fix` repo, branch `build-out`)
- `ops/lib/`: tested logic (registry, invoice, quote calculator, phone, alerts, ops manager, reporting, audit, pricing). It's inlined into the n8n Code nodes.
- `ops/workflows/`: the KS workflows as code. Deploy with `node ops/scripts/deploy.js "<name>"`; it never touches `[Stock]` workflows.
- `ops/changes/`: each change to a `[Stock]` workflow, applied by `ops/scripts/stock.js`. It backs up first (`n8n/backups/patches/`) and re-checks the workflow is active; undo with `node ops/scripts/stock.js restore <backup>`.
- `ops/scripts/vapi-setup.js`: creates a client's Vapi assistant, tools and SIP address from the registry.
- `ops/test/`: 77 tests, including a local n8n simulator for the KS workflows.
