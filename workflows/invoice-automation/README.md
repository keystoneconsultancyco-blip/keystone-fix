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
in this workspace - not duplicated. The Resend HTTP node ("Send Confirmation
Email (Resend)") was deployed **without** a credential attached (the
placeholder doesn't exist in this workspace yet) - once you've created the
"Resend API" Header Auth credential, open that node and attach it.

## Outstanding blocker: Xero credential needs re-authentication

Every Xero API call in test runs fails with:

```
Unable to sign without access token
```

on the very first Xero step ("Xero - Get Connections"). This is n8n
reporting that the stored `Xero account` credential currently holds no
usable OAuth token - not a bug in this workflow's requests. The credential
was created 15 July and hasn't been used/refreshed since; something about
that refresh has failed silently. This can only be fixed interactively (it
needs your browser to complete Xero's consent screen), not via the API:

1. n8n -> Credentials -> "Xero account" -> Reconnect / Sign in with Xero again.
2. Let me know once that's done and I'll immediately re-run the remaining
   test cases (duplicate detection, contact found/not found, invoice
   creation, confirmation email) against it.

## Known-good so far (verified via live test executions against the deployed workflow)

- Validation: missing `customerId` -> `{"status":"rejected","reason":"validation_failed","errors":["MISSING_CUSTOMER_ID"]}`
- Validation: `jobValue` = 0 -> `errors":["INVALID_JOB_VALUE"]`
- Validation: `jobValue` missing -> `errors":["INVALID_JOB_VALUE"]`
- Send-window check routes correctly both ways (confirmed by forcing the
  client config's window narrow/wide and re-testing) - **caught and fixed a
  real bug here**: the original timezone math computed `resumeAt` off by the
  timezone's UTC offset (e.g. queued for 01:00 UTC instead of 01:00
  London time during BST). Rewrote it using `Intl.DateTimeFormat` to get
  wall-clock parts and the true UTC offset instead of the
  `toLocaleString()` + `new Date()` round-trip, which silently
  mis-parses. Reverified after the fix: `resumeAt` now lands on the
  correct UTC instant for the configured local window.
- The "outside window" branch correctly reaches a `waiting` execution with
  the Wait node holding the corrected resume time (confirmed via the
  executions API, then cleaned up so it doesn't fire against live Xero data
  once reconnected).

## Still to test once Xero is reconnected

- Happy path end-to-end (contact not found -> created -> invoice created -> email sent)
- Contact-found branch (run the happy path twice with the same `customerId` - second run should resolve the existing contact, not create a duplicate)
- Duplicate invoice detection (run the same `jobId` twice - second run should skip with `status: "skipped", reason: "duplicate_invoice"`)
- Missing customer email (invoice should still be created; response should show `emailSent: false, emailSkippedReason: "missing_customer_email"`)
- Confirmation email actually arriving (needs the Resend credential too)
