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

Wired to the existing `Xero account` credential (`4p323BIqqLPBGyHS`) already
in this workspace - not duplicated. Reconnected and verified live (see
below). The Resend HTTP node ("Send Confirmation Email (Resend)") is still
deployed **without** a credential attached - the "Resend API" Header Auth
credential doesn't exist in this workspace yet. Once you create it, open
that node and attach it; everything upstream of it (validation, config,
branding, send-window, Xero contact + invoice) is fully verified working.

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
- Test data cleanup: deleted all 4 test invoices (`Status: DELETED`) and
  archived all 3 test contacts (`ContactStatus: ARCHIVED`) created during
  testing, via a temporary one-off n8n workflow built and torn down for
  that purpose - confirmed via the executions API, so this real paid Xero
  org is left clean, not cluttered with test data.

## Only remaining gap: Resend credential

The `Send Confirmation Email (Resend)` node is correctly wired and
structurally unreachable-error-free (it fails with a clean "Credentials
not found" precisely because no credential is attached yet - not a logic
bug). This is the one piece I can't finish myself: once you create the
"Resend API" Header Auth credential (Header: `Authorization: Bearer
<resend-api-key>`) and I attach it to that node, I'll run one more happy-path
test to confirm the email actually sends and arrives.
