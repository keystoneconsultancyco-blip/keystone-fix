# Finance Ops Audit playbook

The £100 audit (normally £750) from payment to signed client. The system does the admin; you run two calls.
Prices always come from `docs/PRICING.md`. Never quote a price that is not on that list.

## The flow at a glance

| # | What happens | Who | Where |
|---|---|---|---|
| 1 | Client pays on the audit link. The card is **held**, not charged. | Client | Stripe link (Keystone Settings > `audit_payment_link`) |
| 2 | Audit Intakes row appears with Status **Held**. You get an SMS or email. | System | Airtable > Audit Intakes |
| 3 | You fill **Available slots**: one time per line, UK time, e.g. `Wed 18 Nov 10:00`. | You | Audit Intakes |
| 4 | The client gets an email from bilal.khan@ saying the £100 is reserved, not charged, with the times as buttons. They pick one, or suggest another. It is logged in **Confirmed time** and you are alerted. | System + client | Email, then the pick page |
| 5 | You tick **Confirm**. The £100 is taken, a Google Meet is created on Keystone's calendar, and the client gets the invite (.ics) plus the intake form. A reminder goes out about 24 hours before. | You, then system | Audit Intakes |
| – | No confirmed time by **day 3** or **day 5**: a chase. The client is chased if they have not picked a time, you are chased if they have. On **day 6** the hold is cancelled and the client is told nothing was charged. | System | – |
| 6 | The client fills the intake form: tools, team size, revenue band, top 3 manual tasks, admin hours a week, and a marketing consent tick. | Client | Intake form |
| 7 | **Call 1** (60 minutes, discovery). Script below. | You | Google Meet |
| 8 | Type your notes into **Call 1 notes** straight after the call. Opus writes the report from your notes plus the intake form, and the PDF goes into **Report PDF**. Status becomes **Report ready** and you are alerted. | You, then system | Audit Intakes |
| 9 | Read the PDF and tick **Approve report**. Fill **Call 2 slots** with times 3–7 days after Call 1. The client picks one, you tick **Confirm call 2**, and the Meet invite goes out. The report PDF is emailed 24 hours before. | You + client | Audit Intakes |
| 10 | **Call 2** (45 minutes, proposal). Script below. | You | Google Meet |
| 11 | Set **Outcome**. **Won**: the client gets the agreement PDF from you and the setup invoice (setup minus £100) from Keystone Accounts. **Lost**: nurture emails start, if they ticked consent. | You, then system | Audit Intakes |

**Rules the system keeps for you:**
- Clients only ever see Keystone addresses: bilal.khan@, accounts@ and operations@ keystoneconsultancyuk.co.uk. The gmail is never shown.
- The Meet lives on Keystone's Google calendar, but the client is not added as a Google guest; they get Keystone's own invite.
- Nothing is charged until you tick Confirm. Nothing is invoiced until you set Won.
- Every step is written to the **Flow log** field on the row.

---

## Call 1: discovery (60 minutes)

**Goal:** understand how money and time leak out of the business, in their words and with their numbers. You are not selling on this call. Take notes as you go: they are what the report is written from.

### 0. Open (2 minutes)
> "Thanks for making the time, [name]. I'll be taking notes as we go so I can get the numbers right in your report."

### 1. Set the scene (3 minutes)
> "Here's how today works. I'll ask about four areas: invoicing, calls, quotes and reporting. For each one I want to know what happens now, how long it takes, and what goes wrong. Then I go away and put numbers on it, and in a few days I come back with a written report and exactly what I'd fix and what it costs. Sound good?"

- Confirm what they told us on the intake form: team size, tools, revenue band, top 3 manual tasks.

### 2. Invoicing and getting paid (12 minutes)
- "Talk me through what happens from finishing a job to the money being in the bank."
- "Who raises the invoice, and how long after the job?" **Note the days.**
- "How many invoices a month? How long does each one take?" **Note the minutes.**
- "How much is owed to you right now that is past due? What is the oldest?" **Note the £ and the days.**
- "Who chases late payers, how, and how often?" **Note the hours a week.**
- "When did an invoice last go out wrong: wrong amount, wrong customer, missed?" **Note what it cost.**

### 3. Calls and bookings (12 minutes)
- "When the phone rings and nobody can answer, what happens?"
- "Roughly how many calls do you miss in a week? Evenings and weekends?" **Note the number.**
- "Of the people who call, how many become jobs? What is an average job worth?" **Note the conversion and £.**
- "How are bookings made and confirmed? Who does it, and how long does it take?"
- "When did a missed call last turn into a lost job you know about?"

### 4. Quotes (10 minutes)
- "How does someone get a quote from you? How long until they have it?" **Note the hours or days.**
- "How many quotes a month, and how many do you win?" **Note the win rate.**
- "Who prices them? Is it consistent? Do you follow up quotes that go quiet?"

### 5. Reporting and knowing your numbers (8 minutes)
- "How do you know how the business is doing this week? Cash, profit, what's owed?"
- "How long does month-end take, and who does it?" **Note the hours.**
- "When did a number surprise you, good or bad, too late to act?"

### 6. Hours, errors and the owner's time (5 minutes)
- "If you add it all up, how many hours a week go on admin across the team?" Compare this with the intake form.
- "What does an hour of your time or your admin person's time cost you?" If they don't know, we use the UK median of £19.67 an hour (ONS).
- "If you got those hours back, what would you do with them?" **Write down their answer word for word: it goes in the proposal.**

### 7. Close (3 minutes)
> "That's really helpful. I'll put numbers on all of this and you'll have a written report before our second call, where I'll show you what I found and exactly what I'd recommend, with prices. You'll get an email with times for that call in the next couple of days."
- Do not quote prices on Call 1. If asked: "Our prices are fixed and published, and I'll show you exactly which parts apply to you on the next call."

**After the call:** type your notes into **Call 1 notes** while it's fresh. The report is written automatically from your notes plus the intake form.
- Write down every number they gave you (hours, £, missed calls, days late, invoice counts). Opus only uses what is in your notes or the form, and never guesses missing numbers.
- Use their words for the problems, and note anything they said they'd do with the hours saved.
- Shorthand is fine, e.g. `invoices by hand ~6h/wk (Sarah); 3 inv 60+ days late ~£4.2k; misses ~5 calls/wk eves, avg job £400, wins ~1 in 3`.

---

## Call 2: the proposal (45 minutes)

**Goal:** agree the problem, the cost of doing nothing, and the fix, then ask for the business. They have had the report for 24 hours.

### 1. Open (2 minutes)
> "Did you get a chance to look at the report? What stood out?"
- Let them talk first. Their reaction tells you which problem to lead with.

### 2. The problems we found (10 minutes)
- Walk through the findings table. For each finding: "You told me … [their words]. That works out at about [hours] hours and £[amount] a year."
- Ask after each one: "Does that sound right? Have I over- or under-estimated?" Adjust if they correct you; credibility beats a big number.

### 3. What it costs per year (5 minutes)
> "Added up, that's about [hours] hours and £[total] a year, roughly £[total ÷ 12] a month, going out of the business today. That's the cost of changing nothing."

### 4. What I recommend (8 minutes)
- Only the services in the report, each tied to the finding it fixes:
  - **Invoice Automation**: invoices drafted in Xero when a job is completed, plus payment chasing.
  - **AI Phone Booking**: answers calls, books jobs, flags urgent calls and complaints.
  - **Quote Calculator**: instant quotes by phone, form or manually.
  - **Reporting Dashboard**: live figures plus a weekly money email.
- "You stay in control: invoices are drafts until you approve them, and nothing is sent to your customers without your rules."

### 5. The exact price (5 minutes)
Read it from the report. It is computed from `docs/PRICING.md`, so never improvise.

| Item | From PRICING.md |
|---|---|
| Setup, per service | Invoice Automation £1,750 · AI Phone Booking £1,250 · Quote Calculator £1,250 · Reporting Dashboard £1,500 |
| Multi-service discount on setup | 2 services 10% · 3 services 15% · 4 services 20% |
| Audit credit | the £100 audit fee comes off setup if they sign within 30 days |
| Monthly package | Starter £750 (1 service) · Growth £1,500 (up to 3 services) · Complete £2,500 (all 4 + custom AI agent) |
| Revenue band (monthly only) | £500k–£1M ×0.8 · £1M–£3M ×1.0 · £3M–£10M ×1.5 |
| Terms | 3-month minimum, then monthly rolling. Phone call minutes above 500 a month are at cost. No VAT is charged. |

> "So that's [services]. Setup is £[setup after discount], less the £100 you've already paid: £[setup after credit] one-off. Then [package] at £[monthly] a month. Against the £[monthly loss] a month it's costing you now, that's [x] times back."

**Sense check:** the monthly fee should be no more than about a third of the monthly loss. The report warns you if it isn't. If it isn't, recommend fewer services; never discount outside the price list.

### 6. Why Keystone (5 minutes)
- **Against doing nothing:** "Doing nothing costs £[total] a year, and it doesn't go away. It grows with the business."
- **Against hiring an admin person:** "A full-time admin person is about £25–30k a year plus NI, holidays, sickness and management time. They still miss the 7pm call, and it's another person to manage. This runs every day, logs everything, and costs [monthly]."
- **Against DIY tools:** "You can buy the tools. The work is joining them up to your Xero, your phone and your jobs sheet, then keeping them working. That's what the monthly covers: we monitor it and fix it."

### 7. Objections

| They say | You say |
|---|---|
| "It's too expensive." | "Compared with what? It's costing you £[x] a month now. If the numbers in the report are wrong, tell me where, and we'll redo them together." Never cut the price; offer fewer services instead. |
| "We need to think about it." | "Of course. What specifically do you want to think through? … Is it the price, the timing or whether it works?" Then answer that. "The £100 credit holds for 30 days, until [date]." |
| "We're too busy right now." | "That's exactly why. Setup takes a few hours of your time; we do the rest. What's the cost of another busy month like this one?" |
| "We tried software before and it didn't stick." | "What went wrong? … This sits on top of what you already use, and we run and fix it every month. If something breaks, it's our problem, not yours." |
| "Will AI talk to my customers wrongly?" | "It follows your rules, anything unusual comes to you, and you can listen to every call. Quotes above your limits wait for your approval." |
| "Can you do just one part?" | "Yes, that's Starter at £[price]. Which finding hurts most? Start there." |
| "I need to ask my partner or accountant." | "Great: shall we put 20 minutes in with them this week? I'll walk them through the report." Book it on the call. |

### 8. Close (5 minutes)
> "Based on what you've told me, I'd start with [services]. Shall we go ahead?"
- **Yes:** "Great. You'll get our agreement from me and the setup invoice from Keystone Accounts today." Set **Outcome = Won**.
- **Not yet:** agree a date to decide, and note it in the row. If they decide against: set **Outcome = Lost**. If they ticked consent, they get the monthly tips emails; otherwise nothing.
- **Never:** pressure, invented urgency, or prices that aren't in PRICING.md.

---

## Rules
- **Halal screen:** don't book audits for businesses that fail it (Audit Agent rules).
- **Money:** you approve every money decision. Ticking Confirm takes the £100; setting Won sends the invoice.
- **Data:** your call notes are only for the audit and stay in Airtable.