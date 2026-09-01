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
       -> Check Customer Discount (Google Sheets "Discounts" tab lookup by customerId, falls back to Client Config's flat discountPercent)
       -> Apply Branding, Discount, Payment Options
       -> Check Send-Time Window
            outside window -> Wait node resumes at the next window start, then continues
       -> Xero: get tenant -> check for an existing invoice with this Reference (duplicate detection)
            duplicate -> skipped result, stop
       -> Xero: search Contact by Name == customerName
            name match AND (email or phone also matches) -> use existing ContactID
            no name match, or name matches but email/phone don't -> create Contact -> use new ContactID
       -> Xero: create Invoice against the resolved ContactID
       -> Resend: email confirmation if customerEmail present, else skip with a flagged reason
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

## Google Sheet structure

One Google Sheet, two tabs, referenced from Client Config (`jobsSheetId`,
`jobsSheetTabName`, `discountsSheetTabName`). Row 1 of each tab must be
exactly these headers (case-sensitive, the code reads them by name) - the
Poller and the discount lookup both fail closed (no rows matched) rather
than guess at a different layout.

**"Jobs" tab** - the trigger source. Whoever finishes a job fills in
columns A-H and leaves the rest blank; the Poller owns everything from
`status` onward.

| Column | Filled in by | Notes |
|---|---|---|
| `jobId` | staff | Must be unique - also used for Xero duplicate-invoice detection |
| `customerId` | staff | Your internal customer ID |
| `customerName` | staff | |
| `customerEmail` | staff | Optional - confirmation email is skipped without it |
| `customerPhone` | staff | Optional but recommended - the only disambiguator when an existing Xero contact has no email on file |
| `jobDescription` | staff | Shows on the invoice line item |
| `jobValue` | staff | Numeric, > 0 |
| `status` | staff, then the Poller | Leave blank until the job is genuinely done, then set to exactly `Complete`. The Poller overwrites this with `Invoiced`, `Skipped - Duplicate`, or an `Error - ...` message - never set those yourself. |
| `invoiceReference` | Poller | Written back after processing |
| `invoiceNumber` | Poller | Written back after processing |
| `processedAt` | Poller | Written back after processing |
| `errorMessage` | Poller | Only populated when something went wrong - check this if a row shows an `Error - ...` status |

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

## Current live deployment (keystoneconsultancy.app.n8n.cloud)

| Workflow | Live ID | Active |
|---|---|---|
| `[Stock] Invoice Automation - Client Config` | `s2riyS1tZ0jtVuSR` | Yes |
| `[Stock] Invoice Automation` | `MParifnFIYCIuXUs` | Yes |
| `[Stock] Invoice Automation - Sheet Poller` | `ai7GdjmZaEOF6Ich` | Yes (but Google Sheets nodes have a placeholder credential until you provide one - see "Outstanding" below) |

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

## Outstanding: Sheet Poller + discount lookup need two things from you

Built and deployed with the same placeholder-credential pattern as
everything else in this template, but **not yet live-tested** - both need
things only you can set up:

1. **The actual Google Sheet.** Create one Sheet with two tabs named
   exactly `Jobs` and `Discounts`, headers exactly as in "Google Sheet
   structure" above (row 1). Send me the Sheet's ID (from its URL:
   `https://docs.google.com/spreadsheets/d/THIS_PART/edit`).
2. **A `Google Sheets OAuth2 API` credential in this n8n workspace** -
   separate from the existing Google Calendar credential even though it
   can reuse the same underlying Google Cloud OAuth app; n8n treats each
   integration as its own credential. Share the Sheet with whichever
   Google account you authorize that credential as (edit access).

Once both exist, tell me and I'll fill in `jobsSheetId` in Client Config,
attach the credential to the four Google Sheets nodes involved (`Check
Customer Discount` in the main workflow; `Get Jobs Rows` and `Update Row`
in the Poller), activate the Poller, and run the same kind of live test as
everything else: confirm a `Complete` row actually produces a real Xero
invoice and gets written back correctly, and confirm a `Discounts` row
actually changes the invoiced amount - cleaning up test data afterward.

I built the Google Sheets node parameters from best-effort recollection of
n8n's current schema for `documentId`/`sheetName`/`columns` (resource
mapper), the same way I did for every other native node in this project -
expect the first live run to surface parameter-shape corrections, same
pattern as the Google Calendar and Xero nodes earlier.

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
delivery and independent re-fetches of created contacts. Nothing blocked
there.

The Sheet Poller and Discounts lookup are built and deployed but **not yet
live-tested** - blocked on the Google Sheet + Google Sheets credential
described in "Outstanding" above.
