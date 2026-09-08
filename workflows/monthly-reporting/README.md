# Monthly Reporting - Stock Template

Generates and delivers a monthly performance report to every active client,
compiled from data the other systems already produce (Phone Booking,
Invoice Automation, Collections/Reminders) - and archives an internal copy
per client in Google Drive. Built generic; the real per-client data lives
in the Clients Registry sheet described below, not in this repo.

## Architecture

```
Clients Registry (Google Sheet, "Clients" tab) - one row per active client
  -> Monthly Reporting (01-monthly-reporting.json): Schedule Trigger, 1st of month 08:00
       -> for each active client:
            -> Phone Booking: that client's CallLog sheet -> calls answered / bookings made
            -> Invoice Automation: that client's Jobs sheet -> invoices sent / cash jobs
            -> Collections/Reminders: Xero Invoice History (same COLLECTIONS_STAGE tags
               Collections itself writes) -> invoices chased / paid
            -> Quoting: not built yet - always skipped (usesQuoting is always false today)
       -> format a client-facing report (skips whole sections for unused services;
          shows genuinely-zero used services with graceful wording, not a bare 0)
       -> email it to the client via Resend
       -> archive an internal copy in Google Drive (one folder per client, named by
          client name, one file per month)
```

## Why a new "Clients Registry" exists

Every other workflow in this project is architected as **one deployment per
client** ("duplicate this folder, edit Client Config, swap credentials") -
Client Config itself is a single Set node holding one client's values, never
a list. This workflow is different in kind: it needs to run once and touch
*every* active client in a single execution, and nothing in the existing
templates tracks "the list of clients" at all. The Clients Registry (a new
Google Sheet, reusing the same Sheets credential already connected - no new
auth) is that list.

**"Clients" tab columns:**

| Column | Notes |
|---|---|
| `clientId` | Matches that client's `clientId` in their own Client Config(s) |
| `clientName` | Used as-is for the Drive folder name and report salutation |
| `contactEmail` | Where the report is emailed. Blank -> report is still archived, just not emailed (see "Format Client Report" below) |
| `active` | `TRUE`/`FALSE` - only active rows are processed |
| `usesPhoneBooking` | `TRUE`/`FALSE` - gates the calls/bookings section entirely |
| `usesInvoiceAutomation` | `TRUE`/`FALSE` - gates the invoicing section entirely |
| `usesCollections` | `TRUE`/`FALSE` - gates the collections sub-line within invoicing; meaningless if `usesInvoiceAutomation` is false |
| `usesQuoting` | `TRUE`/`FALSE` - always `FALSE` today, no quoting engine exists yet. Wired in now so nothing else changes when it does |
| `jobsSheetId` / `jobsSheetTabName` | This client's Invoice Automation Jobs sheet - **a synced copy** of the same values already in that client's own Invoice Automation Client Config |
| `reportingSheetId` / `callLogTabName` | This client's Phone Booking call log - **a synced copy** of the same values already in that client's own Phone Booking Client Config (`reportingSheetId`/`callLogTabName`, added alongside this feature - see `workflows/ai-phone-booking/00-client-config.json`) |

### Why the Registry stores sheet IDs directly instead of fetching them live

The obvious-looking alternative - store each client's Invoice
Automation/Phone Booking Client Config *workflow ID* in the Registry, and
`Execute Workflow` it per client to fetch `jobsSheetId`/`reportingSheetId`
live - was deliberately not used. It would require two mechanisms that have
never been exercised anywhere in this project: a **dynamic, per-item**
`workflowId` on an Execute Workflow node (uncertain whether n8n's resource
locator expression actually resolves per-item), and Execute Workflow's own
**per-item batch behavior**, which - like the Code node's default mode
(see the Payment Method and Collections bug-fixes) - has only ever been
proven with a single input item at a time in this codebase. Storing a
synced copy in the Registry avoids both unknowns entirely, at the cost of
one manual sync step whenever a client's `jobsSheetId`/`reportingSheetId`
changes - the same one-time-setup-sync convention already used for
`vapiSipCredentialId` and now `managerPhoneNumber`.

### The one real limitation this doesn't solve: one Xero credential

Every Xero call in this workflow (and everywhere else in this project) uses
one static, node-configured credential (`4p323BIqqLPBGyHS`) - n8n's
`predefinedCredentialType` can't be swapped per item at runtime. In this
project's real target architecture (separate Xero org per client), a
single Monthly Reporting workflow spanning multiple clients' *separate*
Xero orgs isn't actually possible without either a separate Monthly
Reporting deployment per client (matching the "duplicate per client"
convention already used for everything else), or custom credential-handling
outside what a stock n8n workflow can do. Today there is only one real Xero
org connected to this instance, so this is moot for actual use - but it's
the single biggest thing to revisit before a second real client with their
own Xero org exists. Non-Xero data (Jobs sheet, CallLog) is genuinely
per-client already (each client has their own sheet), so that part scales
correctly regardless.

## Report format rules

- A service flag **off** (`usesPhoneBooking` / `usesInvoiceAutomation` /
  `usesCollections` / `usesQuoting`) omits that entire section - never
  shown as a zero or "N/A".
- A service **on** but genuinely zero that month still shows, worded
  gracefully ("We didn't send any invoices this month.") rather than a bare
  0 - these are two different things and the brief's "skip zeros" note was
  about the first, not the second.
- One deliberate exception: cash jobs are only mentioned when the count is
  > 0 (a supplementary detail, not a headline metric) - the one place a
  genuine zero is omitted rather than gracefully worded, since "0 cash
  jobs" adds nothing a client would want to read.
- Subject: `Your Keystone Performance Report — {Month Year}`.

## Google Drive archive

One folder per client (named exactly `clientName`) under a single root
folder (`driveRootFolderId`, hardcoded placeholder in "Extract Tenant ID +
Reporting Config" - create this once by hand in Drive and paste its ID in).
Each month adds one file, named `{reportPeriodStart} - {Month Year}
Report.txt` (ISO-prefixed so files sort chronologically in the folder).
The archived file contains a short internal-reference block (raw numbers,
who it was emailed to, whether the email sent) followed by the exact
client-facing report text as sent - not a summary of it.

Folder lookup is scoped to the root folder
(`'{driveRootFolderId}' in parents`) so a same-named folder elsewhere in
Drive is never matched by mistake. Uses a **two-step** upload (create file
metadata, then `PATCH .../upload/drive/v3/files/{id}?uploadType=media` with
the raw text) rather than a single multipart/related call, since n8n's
httpRequest node has no built-in body type for that specific multipart
format - two plain-JSON/plain-text calls are far more reliably buildable.

## Parameter-shape uncertainty (unverified until a live test proves them)

This workflow introduces four mechanisms genuinely new to this project,
each independently flagged in the node notes:

1. **Google Drive API** - first use anywhere in this project (only
   Calendar and Sheets have been used from Google so far). Needs a "Google
   Drive OAuth2 API" credential in n8n; per the brief this should already
   exist alongside Sheets/Calendar, but that's unverified - if Drive access
   was never actually connected, this is the same underlying Google account
   needing Drive scope added, not a new provider.
2. **Sheets `values:append`** - a verb never used before in this project
   (only `.get`/`.update`/`:clear` have been proven), used both here
   (indirectly, via the CallLog write in Phone Booking) and directly by
   that same CallLog change.
3. **Authenticated HTTP calls from inside a Code node**
   (`this.helpers.httpRequestWithAuthentication`) - every previous
   Code-node HTTP call in this project (Sheet Poller, Collections) called
   n8n's own unauthenticated webhook. Calling Xero/Sheets with real OAuth2
   credentials from *inside* Code, and attaching a credential to a Code
   node at all, is new and unverified - if it doesn't work, the fallback is
   restructuring the real-data path as native httpRequest/IF node chains
   per service flag (more nodes, but every node type already proven
   elsewhere in this project).
4. **`specifyBody: "raw"` / `rawContentType`** on the httpRequest node
   (used for the Drive content upload) - every other httpRequest body in
   this whole project has been `specifyBody: "json"`; the raw-body option
   names here are best-effort.
5. **Monthly Schedule Trigger shape** (`field: "months"`,
   `triggerAtDayOfMonth`) - only `minutes` (Sheet Poller) and `days` +
   `triggerAtHour` (Collections) have been proven live so far.

## Current live deployment (keystoneconsultancy.app.n8n.cloud)

| Item | Live ID |
|---|---|
| `[Stock] Monthly Reporting` workflow | `uIusHeRCIBVactNt` |
| Clients Registry sheet ("Keystone - Reporting", "Clients" tab, headers only - no real client rows yet) | `1nZm1FLROmGQLyDm4T0p_Lli6WQYzJ6zHDJ2IsoEaWKs` |
| Drive root folder ("Keystone Client Reports") | `1U3BZHyNU-G1DNHN-picZkZAEXHaO66sW` |

`reportsFromEmail` is currently set to Resend's shared test sender
(`onboarding@resend.dev`) for testing - replace with a real
Resend-verified Keystone sending address before this runs live for real.

Two mock client folders/files from the test run above are left in Drive
under the root folder ("Ridgeline Plumbing & Heating", "Bright Spark
Electrical") so you can see exactly what the archive looks like - delete
them whenever you're done reviewing, they're demo data only.

## Setup (one-time)

1. Create the Clients Registry: one new Google Sheet with a "Clients" tab,
   headers exactly matching the column table above. Add one row per active
   client.
2. Create a root Google Drive folder for report archives (any name), copy
   its ID into `driveRootFolderId` in "Extract Tenant ID + Reporting
   Config".
3. Paste the Registry sheet's ID into `reportingRegistrySheetId` in the
   same node.
4. Set `reportsFromEmail` (Keystone's own sending address for these
   reports - **not** any client's `confirmationFromEmail`, since this email
   is from Keystone to the client, not the client's own outbound mail) -
   needs to be a Resend-verified domain before real delivery works, same
   caveat as every other Resend sender in this project.
5. For each client already using Phone Booking: add `reportingSheetId` /
   `callLogTabName` to their Phone Booking Client Config (new fields - see
   `workflows/ai-phone-booking/00-client-config.json`) and make sure that
   sheet has a `CallLog` tab with headers `timestamp, clientId,
   callerNumber, bookingMade, transferredToManager, service, date, time`.
6. Copy each client's `jobsSheetId`/`jobsSheetTabName` (from their Invoice
   Automation Client Config) and `reportingSheetId`/`callLogTabName` (from
   their Phone Booking Client Config) into their row in the Clients
   Registry.
7. Wire the Google Sheets, Xero, Google Drive, and Resend credentials into
   every node that needs them (same credentials already used elsewhere -
   no new auth setup).
8. Activate the workflow.

## Test results

Deployed live and tested against the real webhook with two mock clients in
one `testMode` payload - a "fictional trades business" covering every
service (Ridgeline Plumbing & Heating) and a partial-usage client (Bright
Spark Electrical, Invoice Automation only, zero activity) - verified via
the n8n executions API and independent re-reads of the actual Drive files,
not just the webhook's own response.

**Ridgeline Plumbing & Heating** (all services, mixed real numbers):

> Subject: Your Keystone Performance Report — August 2026
>
> Hi Ridgeline Plumbing & Heating team,
>
> Here's your Keystone performance summary for August 2026.
>
> This month, we answered 47 calls on your behalf, resulting in 22 booked
> jobs. We sent 19 invoices this month. Of those, 5 needed a collections
> follow-up, and we successfully chased 3 of them to full payment.
> Separately, 6 jobs were paid in cash and logged directly.
>
> If you have any questions about this report, just get in touch.
>
> Thanks for being a Keystone client.

**Bright Spark Electrical** (Invoice Automation only, zero activity -
proves both the section-skip and graceful-zero rules in one pass):

> Subject: Your Keystone Performance Report — August 2026
>
> Hi Bright Spark Electrical team,
>
> Here's your Keystone performance summary for August 2026.
>
> We didn't send any invoices this month.
>
> If you have any questions about this report, just get in touch.
>
> Thanks for being a Keystone client.

Confirmed for both: no calls/bookings section at all (usesPhoneBooking
false), no collections clause (usesCollections false), cash jobs correctly
omitted (0, the one deliberate zero-omission exception) - the "We didn't
send any invoices" graceful wording for a used-but-quiet service, exactly
as designed, sitting right next to a fully-skipped section on the same
report.

**Email delivery** - both emails sent via the real Resend API, both
returned real message IDs (`ec944cf8-...`, `52a7a15c-...`), no errors.

**Drive archive** - both clients got their own folder (named exactly by
`clientName`) under the root folder, each containing one
`2026-08-01 - August 2026 Report.txt` file. Re-fetched both files' actual
content directly from Drive afterward (not just trusting the upload
call's own success response) - each contains the internal-reference block
(raw numbers, recipient, email-sent flag) followed by the exact
client-facing text shown above. Also confirmed the "find existing folder"
path works, not just "create new": re-running the test a second time
correctly reused Ridgeline's already-existing folder and added a second,
separate file to it rather than creating a duplicate folder.

**Two real bugs found and fixed by this test round:**

1. **Config values scoped to the wrong branch.** `reportingRegistrySheetId`,
   `driveRootFolderId`, and `reportsFromEmail` were originally set inside
   the real-data-only branch ("Extract Tenant ID + Reporting Config"), but
   the shared downstream pipeline (report formatting, email, Drive
   archive) runs for **both** mock and real clients. Test mode never
   touched that branch, so mock clients reached the Drive-folder-search
   step with an empty `driveRootFolderId` - Google's API took the empty
   string literally (`'' in parents`) and returned "File not found: .".
   Fixed by moving those three config values upstream, into "Compute
   Report Period" (before the test/real branch split), and updating
   "Build Mock Clients" to carry them through.
2. **`Build Client Result` read the wrong node.** Same class of bug as the
   Payment Method and Collections fixes earlier in this project: the node
   read `$input.item.json` directly, but by that point in the chain
   `$input` was the Google Drive upload response (mostly empty), not the
   accumulated client/report data - every field except the three the code
   defensively coerced (`emailSent`, `emailSkippedReason`, `testMode`, all
   via `!!`/`|| null`) came back `undefined` and were silently dropped by
   JSON serialization. Fixed by referencing `$('Parse New File ID')`
   instead, matching the pattern already used correctly by every other
   post-httpRequest node in this workflow.

**One parameter-shape uncertainty resolved by testing, not just flagged:**
the Drive content-upload body needed `contentType: "raw"` as the actual
mode selector, not `specifyBody: "raw"` (which is only used for the JSON
body mode elsewhere in this project) - the wrong key was silently ignored
rather than erroring, so the first live run uploaded real files with
`size: "0"` and no error at all. Found by checking the archived files'
byte size directly rather than trusting the upload call's success
response. Fixed and reverified with real, non-empty archived content
(shown above).

**Call logging (Phone Booking prerequisite)** - separately smoke-tested:
deployed the updated `03-post-call-actions.json` to the live Phone
Booking workflow with a real temporary CallLog sheet wired in, fired a
simulated end-of-call-report, and confirmed via an independent read of the
sheet that a row was appended with the correct values
(`bookingMade: TRUE`, `transferredToManager: FALSE`, caller number,
service, date, time). Test row cleared and Client Config reverted to its
generic placeholder afterward, consistent with this deployment's
documented "not yet a real client instance" status.

**Not tested / left as designed-but-unverified:** the full real-data path
(Clients Registry fetch, per-client Jobs/CallLog sheet reads, Xero
Collections history checks) - there's no second real client with separate
data to exercise it against yet, and this project's biggest real
limitation (one static Xero credential = one Xero org, see above) makes a
faithful multi-client real-data test impossible today regardless. The
`this.helpers.httpRequestWithAuthentication` mechanism those nodes depend
on remains unverified - if it doesn't work as expected, the fallback is
restructuring that path as native httpRequest/IF chains (more nodes, but
every node type already proven elsewhere).

## Status

Built and deployed (live ID `uIusHeRCIBVactNt`, active). Mock-mode path -
the primary tested path per the brief - is fully verified end-to-end:
report generation, email delivery, and Drive archival all confirmed with
real API responses and independent re-reads, across two clients covering
full-usage and partial-usage/zero-activity cases. Two real bugs and one
wrong parameter shape were found and fixed via this testing before being
considered done. The real-data path (Clients Registry, per-client Sheets,
Xero Collections history) is built but unverified - see "Test results"
above for exactly why and what's needed to change that.
