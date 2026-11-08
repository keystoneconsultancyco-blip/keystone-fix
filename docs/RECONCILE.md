# Step 1: Reconcile, live n8n vs build-out code (8 Nov 2026)

Backups of all 9 live workflows: `n8n/backups/2026-11-08/` (the secret scan found nothing to redact). Nothing in n8n has been changed.

| Workflow | Live in n8n? | In my code? | Gaps found | Plan |
|---|---|---|---|---|
| [Stock] Invoice Automation | ✅ Active (44 nodes) | ✅ KS-01 (overlaps) | 1. **Cash-sale path creates an AUTHORISED invoice and records a Xero payment automatically.** This breaks the DRAFT-only rule. 2. Xero tenant = *first* Xero connection, not the client's own org, so two clients would mix. 3. Milestones put a label on one line only; no multi-line. 4. No exception agent: bad data is rejected, not fixed. 5. No Agent Log, Needs Review queue or error alert. | **Add to existing** |
| … - Client Config | ✅ Active | ✅ Airtable My Clients | One hard-coded Set node, still a template (`REPLACE_WITH_…`). Can't serve 2 clients. | **Add to existing**: same sub-workflow, but it looks up the client's Airtable row. Every caller keeps working. |
| … - Sheet Poller | ✅ Active, every 5 min | ✅ (my Jobs poller) | **This already is the production trigger** (Google Sheet Jobs, Status = Complete). Gaps: one sheet for one client; a failure only writes to the sheet, no email to you. | **Keep + add**: loop over active clients' sheets, alert on errors. Drop my Airtable Jobs poller. |
| … - Collections Reminders | Inactive | ❌ | Out of scope (collections dropped). | **Keep as-is, untouched, inactive** |
| Phone Booking - Client Config | ✅ Active | ✅ Airtable My Clients | Template (`REPLACE_WITH_…`), one client only. | **Add to existing** (Airtable lookup) |
| Phone 1. Inbound IVR | ✅ Active | ✅ | Greeting is hard-coded wording, not per client. SIP fallback and alert are good. | **Add to existing**: greeting from registry |
| Phone 2. Vapi Tools | ✅ Active | ✅ | Slot times probably shift by 1 hour in British Summer Time (computed in server time, not UK time). Past times are offered for today. No reschedule, urgent, complaint or message tools. | **Add to existing**: timezone-safe slots, plus the 4 new tools |
| Phone 3. Post-Call Actions | ✅ Active | ✅ | No urgent or complaint escalation by SMS/email; logs to a Google Sheet. | **Add to existing**: escalations, safety net, Airtable Call Log |
| [Stock] Monthly Reporting | ✅ Active | ✅ (reporting + value report) | Uses its *own* clients sheet (a third client list). No Xero P&L/cash, no weekly explainer, no dashboard. | **Add to existing** (registry + value report). **Build new**: weekly explainer and dashboard. |
| Quote Calculator (web/manual) | ❌ (only `get_quote` inside phone) | ✅ engine + agent | Not callable from web or manual. | **Build new**, reusing the same pricing rules |
| Ops Monitor / error handler | ❌ | ✅ logic | No error workflow on anything live. | **Build new**, attach to all |
| Daily health + Registry check | ❌ | ✅ logic | n/a | **Build new** |
| Audit agent | ❌ | ✅ logic | Diagnosis doc not found | **Build new** |

## Decisions I need from you before building

1. **Cash-sale invoices:** change the cash-sale path to create a DRAFT and *not* record the payment automatically. You then approve it in Xero and mark it paid. (Recommended; this matches your rule.)
2. **One client list:** both Client Config sub-workflows and Monthly Reporting read the Airtable `My Clients` table. (Recommended.)
3. **Jobs feed:** keep Google Sheets as the jobs source, with one sheet per client named in the registry. My Airtable Jobs table is then retired. (Recommended; it's what's already tested.)
