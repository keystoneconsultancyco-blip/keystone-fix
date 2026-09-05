# Invoice Automation - Stock Template

Reusable n8n workflow that takes job-completion data, resolves the customer to
a real Xero Contact, creates the invoice, and emails a confirmation - built
generic; duplicate this folder and edit `00-client-config.json` (plus swap
credentials) to stand up a new client.

## Architecture

```
Google Sheet "Jobs" tab, Status = "Complete"
  -> Sheet Poller (02-sheet-poller.json): Schedule Trigger every 5 min
       -> reads the Jobs tab, POSTs each qualifying row to the webhook below
       -> writes the result back to that row's Status/invoiceReference/invoiceNumber/errorMessage

Job completion data
  -> Manual Trigger + sample data (editor testing)
  -> Webhook POST /webhook/invoice/job-completed (API testing / real system integration / the Sheet Poller itself)
       -> Validate Job Data (required fields, job value > 0)
            invalid -> rejected result, stop
       -> Client Config (branding, discount, payment options, send window, Xero/email/Sheets settings)
       -> Normalize Payment Method (Send Invoice / Paid Cash; blank or unrecognized defaults to Send Invoice + a logged warning)
       -> Check Customer Discount (Google Sheets "Discounts" tab lookup by customerId, falls back to Client Config's flat discountPercent)
       -> Apply Branding, Discount, Payment Options
       -> Check Send-Time Window
            outside window -> Wait node resumes at the next window start, then continues
       -> Xero: get tenant -> check for an existing invoice with this Reference (duplicate detection)
            duplicate -> skipped result, stop
       -> Xero: search Contact by Name == customerName
            name match AND (email or phone also matches) -> use existing ContactID
            no name match, or name matches but email/phone don't -> create Contact -> use new ContactID
       -> branch on Payment Method:
            "Send Invoice" (or defaulted) -> Xero: create DRAFT Invoice against the resolved ContactID
                 -> Resend: email confirmation if customerEmail present, else skip with a flagged reason
                 -> eligible for Collections/Reminders as normal
            "Paid Cash" -> Xero: create AUTHORISED Invoice -> Xero: create Payment against xeroCashAccountCode
                 -> no email, ever. AmountDue is 0, so Collections/Reminders' own filter excludes it automatically.

Xero (outstanding invoices, AUTHORISED, AmountDue > 0)
  -> Collections Reminders (03-collections-reminders.json): Schedule Trigger daily 08:00
       -> per invoice: days overdue = today - DueDate
       -> Xero Invoice History read -> highest reminder stage already sent (dedup)
       -> 7+ days AND not yet sent -> Reminder 1 (gentle)
       -> 14+ days AND not yet sent -> Reminder 2 (firmer)
       -> 21+ days AND not yet sent -> Reminder 3 (firm) + internal "flag for manual follow-up" email
       -> Xero Invoice History write -> records the stage just sent (and the flag, at 21+)
```

The internal `customerId` is never passed to Xero as if it were a Xero
GUID - only the resolved `ContactID` GUID is ever used to create the
invoice. This was the root cause of the bug in the original build and is
handled from the start here, not patched in afterwards.

Contact matching is name-first with an email/phone check to disambiguate,
not a pure internal-ID lookup (see "Contact matching logic" below for why
and how). `customerId` is still stored on every contact's `AccountNumber`
field for reference/traceability, it's just no longer the primary lookup
key.

## Files

| File | Purpose |
|---|---|
| `00-client-config.json` | Sub-workflow holding all per-client placeholders. Edit this per deployment. |
| `01-invoice-automation.json` | The full pipeline described above. |
| `02-sheet-poller.json` | Polls the Jobs sheet and feeds completed rows into the pipeline above via its own webhook. |
| `03-collections-reminders.json` | Daily overdue-invoice escalation: reminder emails at 7/14/21 days overdue, manual-follow-up flag at 21. See "Collections / Reminders" below. |

## Google Sheet structure

One Google Sheet, two tabs, referenced from Client Config (`jobsSheetId`,
`jobsSheetTabName`, `discountsSheetTabName`). Row 1 of each tab must be
exactly these headers (case-sensitive, the code reads them by name) - the
Poller and the discount lookup both fail closed (no rows matched) rather
than guess at a different layout.

**"Jobs" tab** - the trigger source. Whoever finishes a job fills in
columns A-I and leaves the rest blank; the Poller owns everything from
`status` onward.

| Column | Filled in by | Notes |
|---|---|---|
| `jobId` | staff | Must be unique - also used for Xero duplicate-invoice detection |
| `customerId` | staff | Your internal customer ID |
| `customerName` | staff | |
| `customerEmail` | staff | Optional - confirmation email is skipped without it (and never sent at all for Paid Cash, regardless) |
| `customerPhone` | staff | Optional but recommended - the only disambiguator when an existing Xero contact has no email on file |
| `jobDescription` | staff | Shows on the invoice line item |
| `jobValue` | staff | Numeric, > 0 |
| `paymentMethod` | staff | Dropdown (data validation), exactly `Send Invoice` or `Paid Cash`. Blank or anything else is treated as `Send Invoice` and logs a warning - it never blocks the job, but check the sheet if you see one. |
| `status` | staff, then the Poller | Leave blank until the job is genuinely done, then set to exactly `Complete`. The Poller overwrites this with `Invoiced`, `Skipped - Duplicate`, or an `Error - ...` message - never set those yourself. |
| `invoiceReference` | Poller | Written back after processing |
| `invoiceNumber` | Poller | Written back after processing |
| `processedAt` | Poller | Written back after processing |
| `errorMessage` | Poller | Only populated when something went wrong - check this if a row shows an `Error - ...` status |

Column order matters here: `paymentMethod` sits at H and `status` at I,
which shifted the Poller's write-back range from the original H:L to I:M
(see `02-sheet-poller.json`'s "Process Complete Rows" notes) - if you ever
reorder columns again, that range needs updating too.

**"Discounts" tab** - per-customer overrides, read fresh on every invoice
run (no caching, so edits take effect on the very next job).

| Column | Notes |
|---|---|
| `customerId` | Matched exactly against the job's `customerId` |
| `customerName` | Reference only, not matched on - fill in for readability |
| `discountPercent` | e.g. `10` for 10% off. A customer with no row here just gets Client Config's flat `discountPercent` (0 by default) |
| `notes` | Optional, e.g. why they get the discount |

An empty Discounts tab (header row only) is fine - every job just falls
back to the flat default.

## Payment Method (Send Invoice vs Paid Cash)

### Chosen approach for "Paid Cash": Xero Invoice + Payment, not a Bank Transaction

Two Xero objects could record a cash sale: a Bank Transaction, or an
Invoice immediately paired with a Payment. This template uses **Invoice +
Payment**:

1. Create the invoice exactly as the "Send Invoice" path does (same
   Contact resolution, same discount/branding, same duplicate check by
   `Reference`) but with `Status: "AUTHORISED"` instead of `DRAFT`, and
   `DueDate` set to today instead of `invoiceDueDays` out.
2. Immediately `POST /Payments` against it for the full amount, against a
   new Client Config field, `xeroCashAccountCode`.

Reasoning: a Bank Transaction is a materially different Xero object
(`Type`, `BankAccount`, `IsReconciled`, its own `LineItems` shape) with no
proven pattern anywhere in this project, and it would require a real bank
account already connected in Xero - nothing in this template's existing
setup establishes or verifies one. Invoice + Payment reuses close to 100%
of the already-proven, already-tested code path (Contact resolution,
discount/branding, duplicate detection, invoice creation) and only adds
one new Xero call (`Payments`) instead of an entirely new object family -
a smaller, lower-risk delta from what's already working. It also means a
cash sale still gets a normal Xero invoice for record-keeping (the
"invoice-less" framing in the original ask was closer to "no *unpaid*
invoice", which this fully satisfies - see "Why Collections excludes
these" below for the mechanism).

`xeroCashAccountCode` must be a real **BANK type** account in the client's
chart of accounts (Xero's Payments API only accepts `Type: "BANK"`
accounts - not `xeroSalesAccountCode`, a revenue account, and not a
generic `CURRENT` asset account like a "Cash in Hand" account some charts
have by default). Ships as a placeholder. **This Xero org currently has
zero BANK-type accounts at all** (confirmed via `GET /Accounts?where=Type=="BANK"`
during testing) - a real one needs to be created/connected in Xero before
any `Paid Cash` row can be processed live; see "Test results" below for
exactly what this blocked and what didn't.

### Blank / unrecognized paymentMethod

Handled by a new "Normalize Payment Method" node right after Client
Config: exactly `"Send Invoice"` or `"Paid Cash"` (case-sensitive, matches
the sheet's dropdown values) map to their respective paths; anything else
- blank, a typo, a value from before this column existed - defaults to
`Send Invoice` (the pre-existing behavior) and sets a
`paymentMethodWarning` string that flows through to the job's final
result (visible in the webhook response / n8n execution), plus a
best-effort `this.logger.warn(...)` call. It never rejects the job outright
- per the brief, a bad value shouldn't silently fail, but shouldn't block
invoicing either.

### Why Collections/Reminders excludes Paid Cash jobs

No workflow change was needed. Collections/Reminders' own Xero query
(`Xero - Get Outstanding Invoices` in `03-collections-reminders.json`)
filters on `Status=="AUTHORISED"&&AmountDue>0`. A Paid Cash invoice is
AUTHORISED but has `AmountDue: 0` the moment its Payment posts, so it
never matches that filter and is never even fetched - there's nothing
inside Collections' own logic that needs to know about payment method at
all. Partially confirmed live (the inclusion side - see "Test results"
below); the exclusion side is a direct mechanical consequence of the same
already-proven numeric filter and will be fully confirmed once a real
Payment can post (see the BANK account gap above).

### Test results

All against the live deployed workflow via its real webhook, verified
independently via the n8n executions API and direct Xero re-fetches - not
just the webhook's own response.

1. **"Send Invoice" (regression check)** - `paymentMethod: "Send Invoice"`
   correctly normalized to `send_invoice`, routed through the unchanged
   original path, created a real DRAFT invoice (`INV-0017`) with the
   correct Contact/discount/branding logic untouched ✅. The confirmation
   email step itself failed - see "Unrelated issue found" below, not a
   regression from this change.
2. **Blank / unrecognized `paymentMethod`** - tested with `""` and with
   `"GARBAGE_VALUE"`; both correctly defaulted to `send_invoice` behavior
   (invoice still created, `INV-0019`) and - after a bug fix (below) - the
   response correctly carried a `paymentMethodWarning` string naming the
   bad value and the `jobId` ✅.
3. **"Paid Cash"** - `paymentMethod: "Paid Cash"` correctly normalized to
   `paid_cash`, routed to the new branch, and created a real Xero invoice
   (`INV-0020`) with `Status: "AUTHORISED"` and `DueDate` set to today -
   independently confirmed via a direct Xero re-fetch ✅. No email was
   sent (`emailSkippedReason: "paid_cash_no_email"`), and no attempt was
   made to reach the Resend API at all for this path ✅. The actual
   `Xero - Create Payment` call was **mocked** for this test (per your
   choice, to avoid creating a permanent BANK account just for testing) -
   a stub returned a realistic-shaped fake `Payments` response so the rest
   of the pipeline (parsing, result formatting) could still be verified
   end to end.
4. **Collections exclusion mechanism** - ran Collections' exact
   `Get Outstanding Invoices` query directly against the live org: the
   unpaid test invoice (`INV-0020`, `AmountDue: 250`) correctly appeared
   in the result set (proving the query itself works and would currently
   chase this invoice, since no real payment exists yet) ✅. Could not
   test the exclusion side with a real zero-balance invoice, since that
   requires an actual Payment against a real BANK account - blocked on
   the same gap as #3.
5. **Cleanup** - all 4 test invoices (`INV-0017` through `INV-0020`)
   removed from the real Xero org (`DELETED` for the 3 DRAFT ones,
   `VOIDED` for the AUTHORISED cash one, since a voided invoice can't be
   deleted and no real payment was ever recorded against it), and all 4
   test contacts set to `ContactStatus: ARCHIVED` - confirmed via the
   executions API.

**One real bug found and fixed by this test round:** inserting
"Normalize Payment Method" between "Merge Config + Job" and "Check
Customer Discount" broke "Match Customer Discount", which still
referenced `$('Merge Config + Job')` for its base data - silently
dropping `effectivePaymentMethod` and `paymentMethodWarning` for every
job. This meant `Is Paid Cash?` would always have seen `undefined` and
always fallen through to the "Send Invoice" branch, regardless of the
sheet's actual `paymentMethod` value - the Paid Cash path would have been
completely unreachable in production. Caught because `paymentMethodWarning`
came back `null` on a deliberately-blank test payload where it should not
have. Fixed by pointing that reference at `$('Normalize Payment Method')`
instead; reverified clean afterward (test #2 above).

**Unrelated issue found (not caused by this change) - since resolved:** the
Resend API key behind the "Header Auth account 2" credential was
invalid/expired at the time of the tests above - the "Send Invoice"
test's confirmation email failed with `"API key is invalid"`. The key was
rotated and reverified live with a fresh test job: Resend accepted it and
returned a real message ID (`INV-0021`, message id
`7c32d98d-310f-4d1a-899e-ccf9b74dd8f0`), no error. Confirmation emails are
working again as of this check; test invoice/contact cleaned up
afterward.

## Current live deployment (keystoneconsultancy.app.n8n.cloud)

| Workflow | Live ID | Active |
|---|---|---|
| `[Stock] Invoice Automation - Client Config` | `s2riyS1tZ0jtVuSR` | Yes |
| `[Stock] Invoice Automation` | `MParifnFIYCIuXUs` | Yes |
| `[Stock] Invoice Automation - Sheet Poller` | `ai7GdjmZaEOF6Ich` | Yes - wired to the real Google Sheet and credential, live-tested (see below) |
| `[Stock] Invoice Automation - Collections Reminders` | `PD8OAS7LPLoiGMkx` | **No** - deployed and mock-tested (see "Collections / Reminders" below), deliberately left inactive so its daily Schedule Trigger doesn't run against real Xero data before your own live check. Activate when ready. |

Webhook: `POST https://keystoneconsultancy.app.n8n.cloud/webhook/invoice/job-completed`

Expected job payload:

```json
{
  "jobId": "JOB-1001",
  "customerId": "CUST-001",
  "customerName": "Jane Doe",
  "customerEmail": "jane@example.com",
  "customerPhone": "+15551234567",
  "jobDescription": "Boiler service and safety check",
  "jobValue": 250.00,
  "milestoneNumber": null,
  "milestoneLabel": null
}
```

`customerPhone` is optional but strongly recommended - it's the only
disambiguator available when an existing Xero contact has no email on file
(see "Contact matching logic" below).

Wired to the existing `Xero account` credential (`4p323BIqqLPBGyHS`) and the
`Header Auth account 2` Resend credential (`YHY8OwE9VDR10sYO`), both already
in this workspace - neither duplicated. Both reconnected/created and fully
verified live end-to-end (see below), including actual email delivery.

## Sheet Poller + discount lookup: live and verified

Wired to a real Google Sheet
(`Keystone - Invoice Automation Data`, tabs `Jobs` and `Discounts`, headers
written into row 1 of both exactly per "Google Sheet structure" above) and a
real `Google Sheets OAuth2 API` credential in this n8n workspace. `jobsSheetId`
is filled in on the live `Client Config` (kept as `REPLACE_WITH_GOOGLE_SHEET_ID`
in this repo's template, per the usual convention of not committing real
per-client values).

Live-tested end to end:

- **Jobs trigger** - added a row with `status: "Complete"`, fired the Poller
  (via its webhook), confirmed it read the row, POSTed it to the main
  workflow's already-tested webhook, got back a real Xero `DRAFT` invoice
  (`INV-0015`), and wrote `Invoiced` + `invoiceReference` + `invoiceNumber` +
  `processedAt` back into the correct row/columns - confirmed via an
  independent raw read of the sheet afterwards, not just the Poller's own
  reported summary ✅
- **Discounts lookup** - added a `Discounts` row for the same customer
  (`discountPercent: 20`), submitted a second job for that customer
  (`jobValue: 200`), and confirmed the resulting Xero invoice (`INV-0016`)
  totalled `160` (20% off), independently re-fetched from Xero directly (not
  just the workflow's own response) ✅

All test data (both Xero invoices, the test contact, and both sheet test
rows) was cleaned up afterwards - see "Test results" below.

### Parameter-shape fixes found during this test (as expected, same pattern as Google Calendar/Xero earlier)

1. **Native `googleSheets` node abandoned.** Its `update`/`append`
   resource-mapper behavior proved unreliable live: `update` with
   `matchingColumns` failed outright on an empty sheet ("could not retrieve
   column names from row 1"), and `append` connected straight to a webhook
   silently wrote ambient webhook-request fields (`headers`, `query`, etc.)
   into extra columns alongside the intended ones. Replaced every Google
   Sheets read/write in both this workflow and the Poller with raw Sheets
   REST API v4 calls (`values.get` / `values.update` / `values:clear`) via
   `httpRequest` nodes using `predefinedCredentialType` /
   `googleSheetsOAuth2Api` - the same pattern already proven for Xero
   throughout this project.
2. **`fetch` is not available in n8n Cloud's Code node.** The Poller's
   "Process Complete Rows" node originally called the main workflow's
   webhook with `fetch(...)`, which failed live (`"fetch is not defined"`).
   Fixed by using n8n's built-in HTTP helper,
   `await this.helpers.httpRequest({ method, url, body, json: true })`,
   which also returns the parsed JSON body directly.
3. **Column-letter fix for the write-back range.** The Poller originally
   wrote status/reference/number/timestamp/error back to columns `I:M`;
   the actual `Jobs` header order (`status` is column H, not I) means the
   correct range is `H:L`. Fixed and reverified against the real sheet.

## Test results (all against the live deployed workflow, via its real webhook + the n8n executions API)

- Missing `customerId` -> `{"status":"rejected","reason":"validation_failed","errors":["MISSING_CUSTOMER_ID"]}` ✅
- `jobValue` = 0 -> `errors":["INVALID_JOB_VALUE"]` ✅
- `jobValue` missing -> `errors":["INVALID_JOB_VALUE"]` ✅
- Send-window check routes correctly both ways ✅ - **found and fixed a real
  bug**: the original timezone math computed `resumeAt` off by the
  timezone's UTC offset (e.g. queued for 01:00 UTC instead of 01:00 London
  time during BST), because `toLocaleString()` + `new Date()` silently
  mis-parses. Rewrote it using `Intl.DateTimeFormat` to get true wall-clock
  parts and UTC offset. Reverified: `resumeAt` now lands on the correct UTC
  instant, and the outside-window branch correctly reaches a `waiting`
  execution via the Wait node.
- Contact resolution, new customer -> Xero Contact created with
  `AccountNumber` set to the internal `customerId`, and that returned
  `ContactID` GUID (not the internal ID) used on the invoice ✅
- Contact resolution, repeat customer -> second job for the same customer
  (same name, same email) correctly finds the existing Contact and reuses
  its `ContactID` - confirmed via the executions API that "Xero - Create
  Contact" did **not** run on the second call ✅
- Contact resolution, **same name, different person** -> two jobs with
  different `customerId`s, the same `customerName` ("Alex Morgan") but
  different emails. Confirmed two genuinely separate, independently
  fetchable Xero contacts (`ACTIVE`, distinct `ContactID`s), not a silent
  merge - the second contact's Xero-visible Name became "Alex Morgan
  (DISAMB-CUST-A2)" (see "Contact matching logic" below for why) ✅
- Duplicate invoice detection -> same `jobId` submitted twice returns
  `{"status":"skipped","reason":"duplicate_invoice", ...}` on the second
  call, no second invoice created ✅
- Missing customer email -> invoice still created successfully, response
  shows `"emailSent": false, "emailSkippedReason": "missing_customer_email"`,
  Resend never gets called ✅
- **Found and fixed a second real bug**: Xero invoices defaulted to
  `LineAmountTypes: "Exclusive"`, so the sales account's default 20% VAT
  was added *on top* of `jobValue` (a £180.50 job invoiced as £216.60
  total). Added `invoiceLineAmountType` to Client Config (default
  `"Inclusive"`) so the invoice total matches `jobValue` exactly, with tax
  backed out of it instead of added on. Reverified: same £180.50 job now
  totals £180.50 (£150.42 net + £30.08 VAT) ✅
- All test invoices were created as `Status: "DRAFT"` as configured -
  nothing was auto-sent to a real customer during testing ✅
- Confirmation email -> `Send Confirmation Email (Resend)` fires and Resend
  accepts the message, returning a real message id (e.g.
  `560c89f2-a9b9-446c-a8ee-c0ded1a40a18`) ✅. Note: the `confirmationFromEmail`
  placeholder in the stock config (`billing@REPLACE_WITH_CLIENT_DOMAIN.com`)
  isn't a real domain, so Resend rejects it (`422 Invalid 'from' field`)
  until a client's real, Resend-verified sending domain is filled in - this
  is expected for a generic template, not a bug. Verified the send path
  itself using Resend's built-in `onboarding@resend.dev` test sender, which
  works without domain verification.
- Test data cleanup: all test invoices (`Status: DELETED`) and contacts
  (`ContactStatus: ARCHIVED`) created across every test round were removed
  from the real Xero org afterwards, via temporary one-off n8n workflows
  built and torn down for that purpose, confirmed via the executions API.
- **Sheet Poller (Jobs trigger)** - test row `SHEET-TEST-001` added to the
  live `Jobs` tab with `status: "Complete"`. Poller fired via its webhook,
  correctly picked up the row, called the main workflow's webhook, and got
  back a real Xero `DRAFT` invoice (`INV-0015`, `£200`). Wrote
  `Invoiced` / `SHEET-TEST-001` / `INV-0015` / a timestamp back into
  columns H-L of row 2 - confirmed via an independent raw REST read of the
  sheet afterwards ✅
- **Discounts lookup** - test row added to `Discounts` for the same
  customer (`discountPercent: 20`), then a second job (`SHEET-TEST-002`,
  `jobValue: 200`) submitted for that customer. Resulting invoice
  (`INV-0016`) totalled `£160` (20% off `£200`), confirmed via an
  independent Xero `GET /Invoices?InvoiceNumbers=INV-0016` (not just the
  workflow's own response) ✅
- Sheet test data cleanup: both test invoices (`INV-0015`, `INV-0016`) set
  to `Status: DELETED`, the test Xero contact (`Sheet Test Customer`) set
  to `ContactStatus: ARCHIVED`, and both sheet test rows cleared - all via
  temporary one-off n8n workflows built and torn down for that purpose,
  confirmed via the executions API and independent re-reads.

## Collections / Reminders

Daily branch (`03-collections-reminders.json`) that checks Xero for
outstanding sales invoices (`Type=="ACCREC"`, `Status=="AUTHORISED"`,
`AmountDue>0`) and escalates by days past `DueDate`:

| Days overdue | Action |
|---|---|
| < `collectionsReminder1Days` (default 7) | No action |
| >= 7 | Reminder Email 1 (gentle) |
| >= 14 | Reminder Email 2 (firmer) |
| >= 21 | Reminder Email 3 (firm) + internal "flag for manual follow-up" notification |

Only the **highest stage currently reached** is sent per run - if the
workflow hasn't run in a while and an invoice jumps straight to 25 days
overdue with nothing sent yet, it gets Reminder 3 only, not a backdated
burst of 1 + 2 + 3.

Thresholds are configurable per client via Client Config
(`collectionsReminder1Days` / `2Days` / `3Days`, default 7/14/21).

### Dedup / reminder-stage tracking - chosen approach: Xero Invoice History

Each invoice's progress is tracked with tagged entries on that invoice's
own Xero History (`PUT /Invoices/{id}/History`, `Details:
"COLLECTIONS_STAGE=N ..."`), read back every run (`GET
/Invoices/{id}/History`) to compute the highest stage already sent. An
invoice only gets a given reminder once: e.g. still at 8 days overdue
after Reminder 1 already went out does **not** trigger a second Reminder
1 the next day.

This was chosen over standing up a new Google Sheet (or any new
credential) specifically because the brief said to reuse only the
existing Xero + Resend auth with no new setup - tracking lives entirely
inside Xero's own audit trail on the invoice itself, nothing external to
create or share access to.

### Manual follow-up flag (21+ days) - chosen approach: both

At stage 3, in addition to the client-facing Reminder 3 email:

1. A second tagged Xero History entry
   (`COLLECTIONS_FLAGGED_FOR_MANUAL_FOLLOWUP`) is written, so it's
   permanently visible on the invoice's own audit trail in Xero.
2. An internal notification email is sent via Resend to a new
   `collectionsNotificationEmail` Client Config field.

Reasoning: a note nobody actively checks isn't really a flag - the email
actively surfaces it to a person, while the History entry makes the flag
itself idempotent (won't re-flag on every subsequent daily run) and
auditable directly on the invoice.

### Testing approach

Three triggers, same pattern as every other workflow in this project:

- **Schedule Trigger** - real production path, daily at 08:00.
- **Manual Trigger + "Sample Mock Invoices"** - click-to-test in the n8n
  editor with 5 built-in fake invoices.
- **Webhook** (`POST /webhook/invoice/collections-check`) - accepts
  `{ testMode: true, testInvoices: [...] }` to run the exact same
  escalation logic (not a separate copy of it) against custom fake
  invoices via API.

`testMode: true` bypasses the real Xero invoice fetch and skips the real
Xero History write (so testing never touches real Xero data), but still
sends real Resend emails so delivery is actually proven end-to-end, not
just simulated. The 5 fixtures cover all four overdue states plus an
explicit duplicate-prevention case:

| Fixture | Due date | Already sent | Expected |
|---|---|---|---|
| A - Not Yet Due Co | +10 days | stage 0 | No action |
| B - Eight Days Overdue Co | -8 days | stage 0 | Reminder 1 sent |
| C - Fifteen Days Overdue Co | -15 days | stage 1 | Reminder 2 sent (not 1 again) |
| D - Twenty-Five Days Overdue Co | -25 days | stage 2 | Reminder 3 sent + flagged |
| E - Already Reminded Co | -8 days | stage 1 | No action (dedup - already got Reminder 1) |

### Test results

All 5 fixtures sent in a single `testMode` webhook call, verified both via
the webhook's own response and independently via the n8n executions API
(full per-node item counts and outputs, not just the summary):

| Fixture | daysOverdue | targetStage | alreadySentStage | actionTaken | emailSent |
|---|---|---|---|---|---|
| A - Not Yet Due Co | -10 | 0 | 0 | `no_action` (not_yet_due) | false |
| B - Eight Days Overdue Co | 8 | 1 | 0 | `reminder_1_sent` | true |
| C - Fifteen Days Overdue Co | 15 | 2 | 1 | `reminder_2_sent` | true |
| D - Twenty-Five Days Overdue Co | 25 | 3 | 2 | `reminder_3_sent_and_flagged` | true |
| E - Already Reminded Co | 8 | 1 | 1 | `no_action` (already_sent_this_stage) | false |

All 4 expected emails (Reminder 1, 2, 3, and the internal manual-follow-up
notification) came back with real Resend message IDs, confirming actual
delivery attempts, not just simulated logic:

```
Reminder 1 (invoice B): 01a06431-1efb-71d8-bb51-8f9056875108
Reminder 2 (invoice C): 01a06431-1ff2-75f9-b9fc-44d72e340645
Reminder 3 (invoice D): 01a06431-20c0-7222-a657-8e2069d125af
Manual follow-up notification (invoice D): 01a06431-21ab-70e6-aac5-5b7faa625a11
```

The invoice D `historyNote` correctly captured both tags in one entry:
`COLLECTIONS_STAGE=3 sent ... (25 days overdue - reminder 3 of 3, firm) |
COLLECTIONS_FLAGGED_FOR_MANUAL_FOLLOWUP`. All 5 items showed
`historyWriteSkipped: true` as expected (test-mode invoice IDs don't exist
in real Xero, so the write step is skipped rather than 404ing).

**Two real bugs found and fixed by this test run:**

1. **Multi-item Code nodes silently dropped 4 of 5 invoices.** Every Code
   node downstream of the point where the batch fans out from 1 item to N
   (one per invoice) defaults to n8n's "Run Once for All Items" mode, in
   which `$input.item` is only a convenience alias for the *first* item -
   not an error, just silently wrong. The first test run only processed
   Invoice A and dropped B-E entirely with no error. Fixed by explicitly
   setting `mode: "runOnceForEachItem"` on the 10 affected Code nodes
   (returning `{ json: {...} }` instead of `[{ json: {...} }]` in that
   mode). This never surfaced in any earlier workflow in this project
   because every prior one processes exactly one entity (one job, one
   poll's completed rows handled sequentially) per Code node execution -
   this is the first genuinely batch-per-execution workflow here.
2. **Manual follow-up notification email sent all-`undefined` fields.**
   "Send Manual Follow-up Notification" read `$json.invoiceNumber` etc.,
   but by that point `$json` was the *previous* node's output - the
   Resend API response from the Reminder 3 email, not the invoice data
   (caused a real `500` on the first full-batch test run: Resend rejected
   `to: [null]`). Fixed by reading `$('Is Stage 2?').item.json.*` instead,
   matching the pattern already used correctly in the very next node.

Both fixes are live in `03-collections-reminders.json` and confirmed via a
clean rerun (results table above).

**Not tested / needs your live check:** the webhook's own HTTP response
only reflects the last of the 5 items processed (n8n runs a downstream
node once per incoming branch when multiple branches fan into it without
an explicit Merge node - here that only affects the webhook's test
response body, not the real per-invoice actions, which were independently
confirmed correct for all 5 via the executions API above). Not fixed, to
avoid introducing an unproven native node (Merge) for a cosmetic,
test-only gap - happy to add it if you want a single combined JSON
response from future test calls.

### Parameter-shape uncertainty flagged (unverified against real Xero data, same caveat as Calendar/Xero/Sheets on first build)

1. **Xero History HTTP method** - used `PUT /Invoices/{id}/History`,
   matching Xero's documented pattern for History/Notes on Contacts,
   CreditNotes, etc., but this exact call has not been exercised against
   a real invoice. If the first live run 404s/405s on the write step,
   this is the first thing to check.
2. **Multi-condition `where` filter + `summaryOnly=false`** on `GET
   /Invoices` - only single-condition `where` clauses (`Reference==`,
   `Name==`) have actually been proven live in this project; the
   combined `Type==...&&Status==...&&AmountDue>0` filter and
   `summaryOnly=false` are best-effort.
3. **Contact `EmailAddress` on the invoice list response** - may not be
   present even with `summaryOnly=false`, which is why a dedicated `GET
   /Contacts/{id}` fetch was added per invoice rather than relying on the
   embedded `Contact` object.
4. **Daily Schedule Trigger shape** (`field: "days"`,
   `triggerAtHour`/`triggerAtMinute`) - only the `minutes` field type has
   been proven live so far (Sheet Poller runs every 5 minutes); worth
   confirming the first scheduled run actually fires at 08:00.

None of these affect the escalation/dedup logic itself (fully covered by
the mocked test above) - they're isolated to the real-Xero data path,
which only runs when `testMode` is not set.

## Contact matching logic

Earlier testing found that Xero enforces unique contact Names within an
org: `POST /Contacts` with a Name that already exists **updates that
existing contact instead of creating a second one** - confirmed live (two
different `customerId`s, same Name, ended up as one Xero contact with the
second `AccountNumber` silently overwriting the first). That's Xero's own
platform behavior, not something this workflow's requests control.

The matching logic now accounts for this directly:

1. Search Xero Contacts by `Name == customerName`.
2. If a name match exists, also check whether that contact's stored
   `EmailAddress` or any of its `Phones` matches the current job's
   `customerEmail`/`customerPhone` (case-insensitive for email,
   digits-only comparison for phone).
3. Reuse the existing contact only if the name matches **and** at least
   one of email/phone also matches. A name match with no email/phone
   overlap - or where the existing contact has neither on file - is
   treated as a different person.
4. When treated as a different person, the new contact's Xero-visible
   `Name` is suffixed with the internal `customerId` (e.g. `"Alex Morgan
   (CUST-042)"`) before creating it. This is the only way to make Xero
   actually create a second, separate contact record instead of silently
   merging into the existing same-name one - confirmed necessary and
   sufficient via live testing. **This is a visible, deliberate
   tradeoff**: that customer's name shows with the suffix on this
   contact record and any invoices against it, in exchange for not
   silently attributing their invoice to a different real person.
   `customerPhone` is now also stored on new contacts (not just email),
   since it's needed on the *existing* contact for step 2 to have
   anything to compare against on a future job.

## Status

The core pipeline (validation, send-window, Xero contact/duplicate/invoice
logic including name+email/phone disambiguation, Resend email) is fully
tested against live Xero + Resend API calls, including actual email
delivery and independent re-fetches of created contacts.
**Update:** the Resend API key (`Header Auth account 2`) went invalid at
one point during the Payment Method testing round, breaking confirmation
emails - since rotated and reverified live (real test job, `INV-0021`,
Resend accepted it and returned a real message ID,
`7c32d98d-310f-4d1a-899e-ccf9b74dd8f0`, no error). Confirmation emails are
working again as of this check; test invoice/contact cleaned up
afterward.

The Sheet Poller and Discounts lookup are built, deployed, and now fully
live-tested against the real Google Sheet and live Xero connection (see
"Sheet Poller + discount lookup: live and verified" above) - a `Complete`
Jobs row produces a real Xero draft invoice, and a `Discounts` row correctly
changes the invoiced amount. Nothing outstanding on either feature.

Collections/Reminders (`03-collections-reminders.json`, live ID
`PD8OAS7LPLoiGMkx`) is built, deployed, and its escalation/dedup logic is
fully mock-tested against all 5 fixtures with real Resend emails sent
(see "Collections / Reminders" -> "Test results" above), including a
duplicate-prevention case and two real bugs found and fixed during that
testing. **Deliberately left inactive** - the live-Xero data path (real
invoice fetch, Contact email lookup, History read/write) is untested
against real data and carries the parameter-shape flags listed above;
`collectionsNotificationEmail` is currently set to
`keystoneconsultancy.co@gmail.com` for testing and should be replaced with
a real monitored inbox before going live. Activate the workflow in n8n
(or ask me to) once you've done your own live check.

Payment Method (Send Invoice / Paid Cash) is built, deployed to the live
main workflow, and live-tested for routing, defaulting/warning behavior,
and real Xero invoice creation on both paths (see "Payment Method" ->
"Test results" above) - including a real bug found and fixed
(`effectivePaymentMethod` was being silently dropped, which would have
made the Paid Cash branch unreachable). **Not fully tested end-to-end:**
the actual `Xero - Create Payment` call was mocked, since this Xero org
has no BANK-type account yet - `xeroCashAccountCode` needs a real one
before any `Paid Cash` row is processed live, at which point that one
call (and the Collections-exclusion mechanism it enables) should be
re-verified for real.
