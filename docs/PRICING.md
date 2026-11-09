# Keystone pricing, audit and website strategy (APPROVED, 9 Nov 2026)

This replaces every earlier pricing and audit instruction (the old PRICING_PROPOSAL.md is withdrawn). The code reads the same numbers from `ops/lib/pricing.js`; change both together. Keystone does not offer forecasting.

## 1. Core services (4)
| Service | What it does |
|---|---|
| Invoice Automation | Invoices auto-drafted in Xero when a job is completed, plus payment chasing |
| AI Phone Booking | Answers calls, books jobs, flags urgent calls and complaints |
| Quote Calculator | Instant quotes by phone, form or manually |
| Reporting Dashboard | Live figures plus a weekly money email |

Monthly Operations Management (monitoring, fixes, alerts) is included in every package.

## 2. Setup fees (one-off, per service)
| Service | Setup |
|---|---|
| Invoice Automation | £1,750 |
| AI Phone Booking | £1,250 |
| Quote Calculator | £1,250 |
| Reporting Dashboard | £1,500 |

Multi-service setup discount: 2 services 10%, 3 services 15%, 4 services 20%. Setup fees do not change with business size.

## 3. Monthly packages (monthly fees are sold only as packages)
| Package | Price (£1M–£3M band) | Includes |
|---|---|---|
| Starter | £750/month | 1 core service + monitoring and fixes |
| **Growth** (main offer) | £1,500/month | 3 core services + monitoring and fixes + monthly review call |
| Complete | £2,500/month | All 4 core services + monitoring and fixes + monthly review call + Complete-only extras: a custom AI agent built for their business, quarterly growth review, 4-hour priority response |

- AI phone call costs above 500 minutes a month are passed on at cost.
- Minimum term 3 months, then monthly rolling.
- 2 services = Growth (Growth covers up to 3).

## 4. Revenue-band pricing (monthly packages only, never setup)
| Annual revenue | Multiplier | Starter | Growth | Complete |
|---|---|---|---|---|
| £500k–£1M | ×0.8 | £600 | £1,200 | £2,000 |
| £1M–£3M | ×1.0 | £750 | £1,500 | £2,500 |
| £3M–£10M | ×1.5 | £1,125 | £2,250 | £3,750 |

Fixed bands only, never case by case. Every proposal includes a sense check: **monthly fee ≤ about one-third of the monthly loss the audit found**. If not, Bilal is told.

## 5. Finance Ops Audit (two levels)
A diagnostic before any sale: meet the owner, review 5 areas (invoicing and getting paid, cash flow, reporting, bookings and admin, planning), pull read-only Xero figures, quantify the money and time lost each month, and deliver a report with fixes and the recommended package. The audit agent drafts; Bilal reviews and presents.

**The 3 checks** (Client Hunter scores every lead):
- **Fit**: UK, £1M–£10M revenue, real admin volume (several staff, vans or jobs), no in-house finance team, passes the halal screen.
- **Timing**: at least one buying signal in the last 8 weeks (new director, revenue growth in filings, finance/admin job ad, expansion).
- **Pain**: a visible problem (reviews mentioning missed calls or slow replies, overload job ads, late-payment signs).

**Levels**
| Offer | Shown as | Who |
|---|---|---|
| Free | "Free Finance Ops Audit – worth £750" | High value leads only: pass all 3 checks, can comfortably afford £1,500+/month, urgent demand-inelastic pain, strong recurring potential |
| £100 | "87% off – normally £750" | Everyone else, and anyone Bilal marks as a possible time-waster. Credited against setup if they sign within 30 days. Paid by payment link before the audit is booked |

**Rules**
- Airtable Prospects fields: Lead value (High / Standard), Audit offer (Free / £100), Why. Bilal can override any lead.
- Sales Prep writes a 10-minute qualifying call script with 5 questions: decision-maker? annual revenue? biggest time/money drain? could you invest ~£1,500/month if savings are found? will you give read-only Xero access? If the answers contradict "High value", it downgrades to the £100 offer and tells Bilal.
- Outreach offers only the correct audit level per lead. First-touch outreach never states prices; the ask is always the audit / discovery call.

**Payment link (proposal, not set up):** Stripe Payment Links: no monthly fee, about 1.5% + 20p per UK card payment (about £1.70 on £100), a reusable link that can be put in Keystone Settings > `audit_payment_link`. Alternative: SumUp payment links (no monthly fee, about 2.5%). Nothing is set up until Bilal approves.

## 6. Pilot client (first client only)
Audit free, 50% off setup, in exchange for a written case study and testimonial. 3-month minimum.

## 7. Website quote calculator: free but email-verified
- Visitor enters name, business email, company name, annual revenue band, the services they're interested in, and an unticked marketing-consent box linked to the privacy notice.
- A 6-digit code is emailed (Resend). Results show only after the code is entered. Codes expire after 15 minutes; 3 attempts maximum.
- Bot protection: hidden honeypot field; at most 3 requests per email and per IP address per day.
- Free-mail addresses are allowed but flagged in Airtable.
- After verification: "from £X" ranges for setup and monthly (×1.0 band) only, with "Exact price depends on business size", then the CTA "Get your exact quote with a Finance Ops Audit – £100 (normally £750). Qualifying businesses may receive it free."
- Every verified submission is saved to Prospects (Source = Website), scored on the 3 checks, with Lead value and Audit offer set.
- Consented leads get the Nurture sequence (4 emails over 3 weeks: value, case-style example, audit offer, last call). Bilal approves the templates before anything sends.
- Verification emails only switch on once the email domain is verified in Resend (automatic; Bilal is told).

## 8. Presentation and admin
- Website shows the audit offer, setup fees, the 3 packages with "from" prices and "Pricing is based on business size".
- Bilal is a sole trader and not VAT registered: no VAT on Keystone invoices. Keystone Settings > `keystone_vat_registered` (no / yes) switches VAT on later.
