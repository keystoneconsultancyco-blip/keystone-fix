# Keystone build status (9 Nov 2026)

**See `GO_LIVE.md` for launch readiness (79%), the end-to-end test results and your remaining steps in order.**

## New on 9 Nov
| Item | Status |
|---|---|
| Keys out of plain-text env vars (network secrets + n8n credentials) | ✅ `docs/SECURITY.md` |
| AI routing (Haiku routine / Opus audits + money), cost of every call in AI Usage, 80%/100% alerts, queue + auto re-run | ✅ live-tested incl. forced over-budget |
| Agent team: Chief of Staff, Lead Researcher, Outreach, Sales Prep, Ops Monitor (live); Onboarding, Client Success, CFO, Content, Compliance, Systems Builder (built, off until 5/20 clients) | ✅ each run live once |
| Jarvis agent pages (team + one page per agent, approve buttons) | ✅ on Jarvis branch `keystone-agents`, needs one Vercel variable |
| Switch-on: domain (Resend) + Twilio number | ✅ domain path live-tested with a throwaway domain (removed); Twilio paths simulator-tested |
| Client agreement (draft – to be checked) | ✅ `docs/CLIENT_AGREEMENT.md` |
| Full end-to-end test lead → report | ✅ passed; test data removed |


✅ live and tested against real services · 🟡 partly done · ⛔ blocked on Bilal (see BLOCKERS.md) · ⬜ not started

## Live in n8n
| Workflow | Status | Tested how |
|---|---|---|
| KS Ops - Failure Alerts (on all 12 production workflows) | ✅ email · 🟡 SMS waits for a Twilio number | Forced failure plus a real one: client found, impact and plain-English cause; email arrived |
| [Stock] Invoice Automation | ✅ | 10 live cases on the Keystone Xero org: clean, duplicate, cash = DRAFT with no payment, 3-line milestone, Airtable discount, same-name customer, AI-fixed, zero value, no job ID. All drafts deleted and contacts archived. |
| [Stock] Invoice Automation - Sheet Poller | ✅ | Loops the registry and reads each client's jobs sheet; errors are emailed |
| [Stock] Invoice / Phone Client Config | ✅ | Read Airtable My Clients and output the same field names |
| [Stock] Phone Booking - 1. Inbound IVR | ✅ (real call ⛔) | Greeting, 1, 2, wrong key, SIP failed or completed, voicemail fail-safe |
| [Stock] Phone Booking - 2. Vapi Tools | ✅ (real call ⛔) | Availability, closed day, past time, booking on the real Calendar, double booking blocked, reschedule, quotes, urgent, message. Test events deleted. |
| [Stock] Phone Booking - 3. Post-Call Actions | ✅ | Booking, missed-urgent safety net, enquiry; Airtable Call Log; test rows cleared |
| [Stock] Monthly Reporting | ✅ | Real run: registry, value report, email, Drive archive (test files moved to the bin) |
| KS Quote Calculator (form, phone, manual, approve link) | ✅ | 7 live cases, including a real Claude estimate; approval emails arrived |
| KS Ops Manager + KS Ops - Notify | ✅ email · 🟡 SMS | Evening summary, quote approval, YES link sent the quote, bad and reused codes refused |
| Vapi assistant, tools and SIP address (demo client) | ✅ | Created by `ops/scripts/vapi-setup.js`; the IVR routes option 2 to it |
| KS Weekly Money + Dashboard | ✅ (Xero reports 🟡, see BLOCKERS #10) | Monday 07:15 email per client from Xero + Airtable with a Claude plain-English explainer; private dashboard link per client (wrong token refused). Both demo clients' emails arrived; test rows removed |
| KS Audit Agent | ✅ | Questionnaire form → halal screen → Xero snapshot → Claude-drafted report saved in Airtable Audit Intakes as "Draft ready for review". 3 live intakes (full, Xero, halal rejection); test rows removed |
| [Stock] Collections Reminders | left off (out of scope) | untouched |

## Not built yet
| Item | Status |
|---|---|
| Website update (7 launch services, no forecasting or collections, live quote calculator and audit questionnaire linked) | 🟡 done and tested on branch `launch-services`; goes live once you approve pricing and I merge it to main |
| Registry check / onboarding automation | 🟡 checklist logic tested; workflow not deployed (the manual checklist is in `docs/ONBOARDING.md`) |

## Decisions made (from your approvals)
- Cash sales create a DRAFT; the automatic payment step is switched off (the node is kept but disabled).
- One client list: Airtable `My Clients`. Jobs stay in Google Sheets, one sheet per client.
- Demo customer emails go to khan.bilalbk408@gmail.com, because Resend's test sender only delivers to the account owner.
- Bugs found and fixed while testing: the confirmation email could fail a whole invoice job; the Monthly Reporting stats step could never run (Code nodes can't call `httpRequestWithAuthentication`); the IVR hung up on callers who pressed nothing or a wrong key; slots were worked out in server time; an unrecognised phone quote crashed the calculator.
