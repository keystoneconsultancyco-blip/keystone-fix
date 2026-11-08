# Change list for your existing [Stock] workflows: awaiting your OK

Nothing below has been deployed. Each workflow is backed up in `n8n/backups/2026-11-08/`, and before each change I take a fresh backup, so any change can be put back exactly as it was.
I **add to** each workflow; I don't replace it. Node names you know stay the same.

## 1. All 8 active [Stock] workflows: failure alerts (settings only)
- Set "Error workflow" to **KS Ops - Failure Alerts**. If any of them fails, you get the email (and the SMS once Twilio is connected) saying which workflow, which client, what went wrong and whether a customer or call was affected.
- Nothing else in the workflow changes.
- *Collections Reminders stays untouched and off* (collections is out of scope).

## 2. Invoice Automation - Client Config and Phone Booking - Client Config
- **Today:** one fixed block of settings, still a template (`REPLACE_WITH_…`).
- **After:** they read the client's row from the Airtable **My Clients** table, using the client ID (or, for phone, the number that was called). They hand back **the same setting names as today**, so the workflows that call them keep working.
- If no client is found, the call stops safely and you get an alert. No invoice is created and no call is dropped (callers go to reception).
- I'll add the few settings that only exist in Client Config today to My Clients: jobs sheet ID and tab, "from" email, and Xero cash account code.

## 3. Invoice Automation
1. **Cash sales (your decision):** these become a **DRAFT** invoice marked "paid in cash, mark as paid in Xero". The automatic "record payment" step is switched off, so no money is recorded without your approval.
2. **The right Xero organisation:** it uses the client's own Xero organisation ID from My Clients, not "the first Xero connection", so two clients can never mix.
3. **Milestone invoices:** a job row can carry several lines (for example deposit / first fix / completion), and they become one draft with multiple lines. Single-line jobs work exactly as now.
4. **Discounts:** read from the Airtable **Discounts** table per client and customer. The Google Sheet Discounts tab still works as a fallback.
5. **Messy data:** instead of just rejecting it, the AI checks it. If it's confident, it creates a DRAFT with a note. If not, the job goes to **Needs Review** and you get an email. It never invents an amount and never goes past DRAFT.
6. **Log:** every invoice decision is written to the Airtable **Agent Log** (this feeds the monthly value report).
- Unchanged: the timezone fix, VAT "Inclusive", same-name contact matching, the duplicate check, missing-email handling and out-of-window queuing.

## 4. Sheet Poller (already the production trigger)
- Loops over **every active client with invoicing on**, each with its own jobs sheet from My Clients, instead of one sheet.
- If a row errors, it still writes the error to the sheet as now, **and** emails you.
- Still runs every 5 minutes.

## 5. Phone Booking - 1. Inbound IVR
- The greeting comes from the client's **Greeting** in My Clients, with a British voice (today it's a fixed US voice and wording).
- The menu (1 = team, 2 = AI) and the SIP fallback to reception with an alert email stay as they are.

## 6. Phone Booking - 2. Vapi Tools
1. **Timezone fix:** slots are worked out in UK time. Today they're worked out in server time, so they'd be 1 hour off in summer time. Past times are no longer offered for today, and closed days are skipped.
2. Uses each **service's real duration** for gaps between bookings (as booking already does), and fixes an end-time bug for bookings that run past midnight.
3. **get_quote** now asks the new **KS Quote Calculator**, so phone prices match the quote form exactly and always come back as "an estimate".
4. **New tools:** `flag_urgent` (texts and emails the business straight away), `log_complaint`, `take_message` and `reschedule_booking`.
   - The AI agent only uses them once they're added to the assistant in your **Vapi dashboard**. I'll give you the exact settings to paste in (there's no Vapi credential in n8n for me to do it).

## 7. Phone Booking - 3. Post-Call Actions
- **Urgent calls and complaints:** an SMS (once Twilio is connected) and an email to the business immediately.
- **Safety net:** if the transcript contains the client's urgent words (for example "leak" or "gas smell") but nobody escalated it, it escalates anyway.
- Every call is also logged to the Airtable **Call Log**. The Google Sheet log carries on as now.

## 8. Monthly Reporting
- Reads the client list from Airtable **My Clients** instead of the separate clients sheet.
- Adds a **value report**: invoices drafted, calls answered, bookings, quotes, issues auto-fixed and estimated hours saved, from the Agent Log.
- Uses each client's own Xero organisation.

## How each change is tested before it's switched on
- I save each change, then run it against the demo clients with real Xero (Demo Company), Calendar, Airtable and Resend: normal cases plus missing or bad data, duplicates, empty calendar days, summer and winter times, and a failure part-way through.
- I confirm each workflow is active after saving, then delete all test invoices, contacts, events and rows.
- If any test fails, that workflow is put back from its backup.

**Reply "OK to all", or name the numbers you want me to leave out.**
