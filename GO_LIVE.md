# Keystone go-live (9 Nov 2026)

> **PAUSED since 11 Nov 2026.** Everything is switched off until Bilal says "GREEN LIGHT". Restart procedure: [`GREEN_LIGHT.md`](GREEN_LIGHT.md).

**Launch readiness: 79%.** All the building is done and tested end to end. The rest is the 12 steps below, which only you can do (money, accounts, legal). Several of them switch things on automatically once you fill in one Airtable cell.

## Full end-to-end test (demo, real services): passed
| Step | What happened |
|---|---|
| 1. Lead | Lead Researcher saved a high-potential prospect (halal screen + no duplicates) and woke Outreach |
| 2. Outreach | Haiku drafted a personal email; YES/NO arrived by email; YES held it until the domain is verified |
| 3. Call booked | Sales Prep wrote the call brief (Haiku) and emailed it |
| 4. Audit | Prospect filled in the questionnaire; Opus wrote the audit draft for review (now replies to the prospect in 3 s, report written in the background) |
| 5. Proposal | Audit marked Approved -> Opus wrote proposal + quote within the price rules (Growth: £3,187.50 setup after 15% discount + £995/month); YES held it until the domain is verified |
| 6. Onboarding | New client row checked: 10 missing setup items listed |
| 7. Invoice | Finished job -> Xero DRAFT INV-0029 + confirmation email |
| 8. Call + booking | Availability, £114 estimate, booking in Google Calendar, end-of-call log |
| 9. Report | Weekly money email (Haiku, cost logged) |

Everything created by the test was deleted afterwards (Airtable rows, Xero draft and contact, calendar event). AI Usage rows were kept: they are real spend and count towards the monthly credit.

## What's live
- **Client services:** Invoice Automation, AI phone (menu, assistant tools, post-call), Quote Calculator, Weekly Money + dashboard, Monthly Reporting, Audit Agent.
- **Ops:** Failure Alerts on every workflow, Ops Manager (summaries + YES/NO approvals), Ops Notify.
- **AI:** Haiku for routine work, Opus for audits and money decisions. Every Claude call is costed in Airtable **AI Usage**. KS AI Budget emails you at 80% and 100% of the monthly credit; above 100%, agent work queues and re-runs automatically when there is room. Customer-facing work never queues; it has non-AI fallbacks.
- **Agent team (live):** Chief of Staff (07:05 daily brief, Sunday scorecard towards £1M), Lead Researcher (20:35 daily, replaces the old Client Finder task), Outreach (drafts only), Sales Prep (3 times a day), Ops Monitor (twice a day, also watches the n8n execution allowance).
- **Switch-on automation:** KS Switch-On checks Keystone Settings 4 times a day (domain + Twilio), or straight away with "check now".
- **n8n allowance:** schedules were cut from about 15,300 to 1,360 runs a month (`docs/N8N_USAGE.md`). Ops Monitor emails you at 80% and 100% of `n8n_monthly_executions`.

## What's switched off, and why
| Agent | Switches on at | Why off now |
|---|---|---|
| Onboarding, Client Success, Keystone CFO | 5 active clients | Nothing to onboard or manage yet |
| Content, Compliance, Systems Builder | 20 active clients | Need volume to be worth running |

All six are built, deployed and tested once each. When a threshold is hit, the Chief of Staff emails you a YES/NO; YES switches the agent on.

## Pricing (approved 9 Nov)
All prices follow `docs/PRICING.md`; the website is live at https://keystoneconsultancyco-blip.github.io/keystone-website-v3/ with the audit offer, setup fees, packages and the email-verified estimate calculator.

## Your steps, in order
| # | Step | Link | What happens next |
|---|---|---|---|
| 0 | In n8n > Settings > Usage, check your plan's monthly executions and reset date; put them in `n8n_monthly_executions` (set to 2500) and `n8n_reset_day` (set to 1). If this month's allowance is used up, n8n runs nothing until it resets or you upgrade | [Keystone Settings](https://airtable.com/app8WDGaKEamwXTqh/tblpgFrCOqt5H5yFn) | Usage alerts use the real limit |
| 1 | Set your real monthly Claude API credit in `ai_monthly_credit_usd` (it is set to $100 as a placeholder) | [Keystone Settings](https://airtable.com/app8WDGaKEamwXTqh/tblpgFrCOqt5H5yFn) | Alerts at 80% use the real figure |
| 2 | Delete the old `N8N_API_KEY` environment variable | Claude cloud environment menu > Edit > Environment variables | Keys now live in network secrets and n8n credentials (`docs/SECURITY.md`) |
| 3 | Rotate the Twilio auth token, then update the n8n "Twilio" credential | [Twilio console](https://console.twilio.com/) > Account > API keys & tokens · [n8n credentials](https://keystoneconsultancy.app.n8n.cloud/home/credentials) | A Twilio API reply exposed the token in one n8n run log (deleted straight away); rotating is the safe step |
| 4 | Register as self-employed with HMRC, and pay the ICO data protection fee | [HMRC](https://www.gov.uk/register-for-self-assessment) · [ICO fee](https://ico.org.uk/for-organisations/data-protection-fee/) | Required before taking money and handling client data |
| 5 | Read the 10 Nurture preview emails in your inbox, then approve the ones you like (tick Approved; 4 sequence + 6 monthly). Optional: put your booking page link in `audit_booking_url` (until then the button opens an email to you), and a real testimonial in `nurture_social_proof` when you have one and choose the £100 audit payment provider (I suggest Stripe Payment Links: no monthly fee, about 1.5% + 20p; put the link in `audit_payment_link`) | [Nurture Templates](https://airtable.com/app8WDGaKEamwXTqh/tbli4PIHaOkU6UdeZ) · [Keystone Settings](https://airtable.com/app8WDGaKEamwXTqh/tblpgFrCOqt5H5yFn) | Nurture can send once the domain is verified; Sales Prep includes the payment link for £100 audits |
| 6 | Buy a domain, then put it in `sending_domain` (this also switches on the website calculator's verification emails) | [Keystone Settings](https://airtable.com/app8WDGaKEamwXTqh/tblpgFrCOqt5H5yFn) | You get an email with the exact DNS records; once Resend verifies them, every email switches sender, and approved outreach and proposals go out |
| 7 | Buy a UK Twilio number; fill `twilio_from`, `twilio_account_sid`, `alert_sms_to` | [Twilio numbers](https://console.twilio.com/us1/develop/phone-numbers/manage/search) | Number auto-connects to the phone menu + SMS approvals; SMS alerts switch on |
| 8 | Add Vapi credits, then follow `docs/VAPI_GO_LIVE.md` | [Vapi billing](https://dashboard.vapi.ai/) | Ask me to re-run the Vapi setup to enable transfer to a person |
| 9 | Make the 12 test calls in `docs/PHONE_LIVE_TEST.md` | – | Phone is proven on a real line |
| 10 | Reconnect the n8n "Xero account" credential with `accounting.reports.read` ticked | [n8n credentials](https://keystoneconsultancy.app.n8n.cloud/home/credentials) | Profit and bank figures appear in the weekly email |
| 11 | Jarvis: add `KEYSTONE_FEED_TOKEN` in Vercel (value: Keystone Settings > `jarvis_feed_token`), then merge the branch | [Vercel](https://vercel.com/dashboard) > Jarvis > Settings > Environment Variables · [Jarvis changes](https://github.com/khanbilalbk408-sudo/Jarvis/compare/main...keystone-agents) | Agent pages appear (tap "Keystone agent team" or ask Jarvis) |
| 12 | Have a solicitor check `docs/CLIENT_AGREEMENT.md` | – | Ready to sign your first client |

After that: approve the outreach emails the agents draft, book calls, and the rest of the pipeline runs itself.

## Useful links
- Agents switchboard: [Airtable > Agents](https://airtable.com/app8WDGaKEamwXTqh/tbl0hUNJIb689RuZH) (set Status to Paused to stop one)
- AI spend: [Airtable > AI Usage](https://airtable.com/app8WDGaKEamwXTqh/tbl6E7WRrGbnKNbuS)
- Agent activity: [Airtable > Agent Team Log](https://airtable.com/app8WDGaKEamwXTqh/tblmnvw0Es4UaSPYu)
- n8n: [all workflows](https://keystoneconsultancy.app.n8n.cloud/home/workflows)
