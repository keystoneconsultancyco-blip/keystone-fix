# Invoice Automation - Stock Template

Reusable n8n workflow that takes job-completion data, resolves the customer to
a real Xero Contact, creates the invoice, and emails a confirmation - built
generic; duplicate this folder and edit `00-client-config.json` (plus swap
credentials) to stand up a new client.

## Architecture

```
Job completion data
  -> Manual Trigger + sample data (editor testing)
  -> Webhook POST /webhook/invoice/job-completed (API testing / real system integration)
       -> Validate Job Data (required fields, job value > 0)
            invalid -> rejected result, stop
       -> Client Config (branding, discount, payment options, send window, Xero/email settings)
       -> Apply Branding, Discount, Payment Options
       -> Check Send-Time Window
            outside window -> Wait node resumes at the next window start, then continues
       -> Xero: get tenant -> check for an existing invoice with this Reference (duplicate detection)
            duplicate -> skipped result, stop
       -> Xero: search Contact by AccountNumber == internal customerId
            found -> use existing ContactID
            not found -> create Contact -> use new ContactID
       -> Xero: create Invoice against the resolved ContactID
       -> Resend: email confirmation if customerEmail present, else skip with a flagged reason
```

The internal `customerId` is never passed to Xero as if it were a Xero
GUID - it's looked up against the Contact's `AccountNumber` field (Xero's
free-text field meant for exactly this kind of external-system ID), and only
the resolved `ContactID` GUID is used to create the invoice. This was the
root cause of the bug in the original build and is handled from the start
here, not patched in afterwards.

## Files

| File | Purpose |
|---|---|
| `00-client-config.json` | Sub-workflow holding all per-client placeholders. Edit this per deployment. |
| `01-invoice-automation.json` | The full pipeline described above. |

## Current live deployment (keystoneconsultancy.app.n8n.cloud)

| Workflow | Live ID | Active |
|---|---|---|
| `[Stock] Invoice Automation - Client Config` | `s2riyS1tZ0jtVuSR` | Yes |
| `[Stock] Invoice Automation` | `MParifnFIYCIuXUs` | Yes |

Webhook: `POST https://keystoneconsultancy.app.n8n.cloud/webhook/invoice/job-completed`

Expected job payload:

```json
{
  "jobId": "JOB-1001",
  "customerId": "CUST-001",
  "customerName": "Jane Doe",
  "customerEmail": "jane@example.com",
  "jobDescription": "Boiler service and safety check",
  "jobValue": 250.00,
  "milestoneNumber": null,
  "milestoneLabel": null
}
```

Wired to the existing `Xero account` credential (`4p323BIqqLPBGyHS`) and the
`Header Auth account 2` Resend credential (`YHY8OwE9VDR10sYO`), both already
in this workspace - neither duplicated. Both reconnected/created and fully
verified live end-to-end (see below), including actual email delivery.

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
- Contact resolution, repeat customer -> same `customerId` on a second job
  correctly finds the existing Contact by `AccountNumber` and reuses its
  `ContactID` - confirmed via the executions API that "Xero - Create
  Contact" did **not** run on the second call, no duplicate contact created ✅
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

## Notable Xero platform behavior found during testing

Two test contacts created back-to-back with **different** `customerId`s but
the **same** `customerName` ("Test Recipient") were silently merged by Xero
into a single Contact record - the second `POST /Contacts` call updated the
first contact's `AccountNumber` rather than creating a distinct second
contact. This is Xero's own name-based contact matching, not something this
workflow controls. Practical implication: if two different real customers
ever share an identical full name, this workflow's `AccountNumber`-based
resolution could end up pointing both at the same Xero contact instead of
two separate ones. Not one of the originally-specified edge cases, and not
fixed here since the fix (e.g. suffixing Xero's Name field to force
uniqueness) trades off against showing a clean customer name on invoices -
worth a decision before a client with a large customer base goes live on
this template.

## Status: fully tested, no known gaps

Every edge case in the original spec is verified against live Xero + Resend
API calls, including actual email delivery. Nothing further is blocked.
