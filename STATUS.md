# Keystone build status (8 Nov 2026)

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
| [Stock] Collections Reminders | left off (out of scope) | untouched |

## Not built yet
| Item | Status |
|---|---|
| Reporting dashboard page + weekly explainer email | 🟡 logic and templates in `ops/lib` (tested); workflow not deployed |
| Finance Ops Audit agent workflow | 🟡 5-pillar logic and report builder tested; intake form and workflow not deployed |
| Registry check / onboarding automation | 🟡 checklist logic tested; workflow not deployed |
| Website update (launch services only) | ⬜ |

## Decisions made (from your approvals)
- Cash sales create a DRAFT; the automatic payment step is switched off (the node is kept but disabled).
- One client list: Airtable `My Clients`. Jobs stay in Google Sheets, one sheet per client.
- Demo customer emails go to khan.bilalbk408@gmail.com, because Resend's test sender only delivers to the account owner.
- Bugs found and fixed while testing: the confirmation email could fail a whole invoice job; the Monthly Reporting stats step could never run (Code nodes can't call `httpRequestWithAuthentication`); the IVR hung up on callers who pressed nothing or a wrong key; slots were worked out in server time; an unrecognised phone quote crashed the calculator.
