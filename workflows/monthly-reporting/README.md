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

_Filled in after the live test run - see the chat response for this
session for full details until this section is updated._

## Status

Built, not yet deployed or tested against live infrastructure. Mock-mode
path (test payload with fully pre-computed per-client stats, bypassing all
real Sheets/Xero/Drive calls except the actual email send and Drive
archive) is the primary tested path per the brief - see "Test results"
above once populated.
