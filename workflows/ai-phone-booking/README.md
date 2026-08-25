# AI Phone Booking - Stock Template

Reusable n8n + Twilio + Vapi workflow for inbound call routing with an AI booking
agent. Built generic; duplicate this folder and edit `00-client-config.json`
(plus swap credentials) to stand up a new client.

## Architecture

```
Inbound call
  -> Twilio number's Voice webhook -> n8n: 01-inbound-ivr (webhook, TwiML)
       "Press 1 for enquiries, Press 2 to book"
       Press 1 -> <Dial> straight to reception (plain Twilio forwarding, no AI)
       Press 2 -> <Dial><Sip> handoff to the Vapi assistant (SIP trunking)
            -> Vapi assistant runs the conversation
            -> mid-call, calls n8n: 02-vapi-tools for check_availability / book_appointment
               (Google Calendar placeholder - swappable per client)
            -> on hangup, Vapi posts "end-of-call-report" to n8n: 03-post-call-actions
               -> customer confirmation email + business notification email
```

Each of the three call-handling workflows calls `00-client-config` via
"Execute Sub-Workflow" so there is exactly one place to edit per-client
values (business name, reception number, calendar ID, business hours,
service menu, notification emails, Vapi/SIP IDs).

## Files

| File | Purpose |
|---|---|
| `00-client-config.json` | Sub-workflow holding all per-client placeholders. Edit this per deployment. |
| `01-inbound-ivr.json` | Twilio inbound webhook, Press 1/2 menu, routes to reception or Vapi. |
| `02-vapi-tools.json` | Webhook Vapi calls mid-conversation for availability + booking. |
| `03-post-call-actions.json` | Webhook Vapi calls after hangup; sends confirmation + notification emails. |
| `vapi-assistant-config.json` | Reference payload for creating the Vapi assistant (system prompt, tools, analysis schema). Not an n8n file. |

## Current live deployment (keystoneconsultancy.app.n8n.cloud)

All four workflows are deployed and **Active** on this instance.
Webhook URLs and the `vapiSipCredentialId`/config placeholders below are
still generic - this is the reference/stock deployment, not yet a
real client instance.

| Workflow | Live ID | Active |
|---|---|---|
| `[Stock] Phone Booking - Client Config` | `xNwsUFYDgiXVvXPv` | Yes |
| `[Stock] Phone Booking - 1. Inbound IVR` | `P1PTZaUWSSwNOFua` | Yes |
| `[Stock] Phone Booking - 2. Vapi Tools` | `3gyq87AL3ZrOfZ0y` | Yes |
| `[Stock] Phone Booking - 3. Post-Call Actions` | `SoTR9D5CjH1BGs4F` | Yes |

Credential wiring confirmed live (via the n8n API):
- Google Calendar nodes in `2. Vapi Tools` ("Get Day's Events", "Book Slot") -> attached, per user confirmation.
- Resend HTTP nodes in `3. Post-Call Actions` and the new SIP-failure notification node in `1. Inbound IVR` -> attached to `Header Auth account 2`.
- Twilio and Vapi have no node in this build that calls out to their APIs (both call *into* n8n via webhook), so there is nothing to wire for them here - see the architecture diagram above.

Still outstanding:
- `00-client-config` still holds generic placeholder values
  (`REPLACE_WITH_*`) - edit the "Client Config" node directly in the n8n
  UI once you have real values for this deployment. In particular,
  `confirmationFromEmail` must be a real Resend-verified sending domain
  before any of the emails (booking confirmation, business notification,
  or the new SIP-failure alert below) will actually deliver - Resend
  rejects the placeholder domain with a 422.

## One-time setup per client

1. **Import** all four `*.json` workflow files into n8n (Import from File, or
   via the API once you have an API key). Note the workflow ID n8n assigns
   to `00-client-config` and paste it into the `workflowId.value` field of
   every "Get Client Config" node in the other three workflows.
2. **Edit `00-client-config.json`** (or the Set node after import) with the
   client's real business name, reception forwarding number, Google
   Calendar ID, business hours, service menu, and notification emails.
3. **Credentials** - create these directly in n8n's Credential manager
   (never commit real secrets to this repo):
   - Twilio (Account SID + Auth Token, or API Key SID/Secret) - only
     needed if you want n8n to also manage the number's webhook via the
     Twilio API; otherwise just set the webhook URL by hand in the Twilio
     Console.
   - Vapi - Header Auth credential, header `Authorization: Bearer <vapi-private-key>`.
     Use the **Private Key**, not the Public Key.
   - Google Calendar OAuth2 - connect the client's Google account. See
     "Google Calendar OAuth troubleshooting" below if sign-in fails with
     `invalid_client`.
   - Resend - Header Auth credential (same pattern as Vapi), header
     `Authorization: Bearer <resend-api-key>`. **Not SMTP** - the original
     hosting (Railway) blocked outbound SMTP (`ENETUNREACH`), so both email
     nodes were built against Resend's HTTPS API instead. Kept that way
     after migrating off Railway since it's simpler to deploy per client
     regardless of host. Sign up at resend.com, verify a sending domain that matches
     `confirmationFromEmail` in the client config (or use Resend's shared
     test sender while developing, which only delivers to the account
     owner's own address), then create an API key under
     Dashboard -> API Keys.
   Then select each credential in the relevant node (Google Calendar nodes
   in `02-vapi-tools`, HTTP Request email nodes in `03-post-call-actions`).
4. **Twilio Console**: set the client's number's Voice webhook (A call comes
   in) to:
   `https://keystoneconsultancy.app.n8n.cloud/webhook/twilio/inbound-call`
   (HTTP POST).
5. **Vapi dashboard**:
   - Create the assistant using `vapi-assistant-config.json` as a starting
     point (system prompt, voice, tools, analysis schema).
   - Create a **SIP Trunking** phone number resource in Vapi (Phone
     Numbers -> Create -> SIP Trunking), enter the client's Twilio number
     for identification, and assign it to the assistant. Note the
     `credential_id` Vapi shows for the SIP URI
     (`sip:{number}@{credential_id}.sip.vapi.ai`) and put it in
     `vapiSipCredentialId` in the client config.
   - Set the assistant's Server URL to the `03-post-call-actions` webhook,
     with Server Messages limited to `end-of-call-report` only.
   - Add the two custom tools (`check_availability`, `book_appointment`)
     pointing at the `02-vapi-tools` webhook, matching the parameter shapes
     in `vapi-assistant-config.json`.
6. **Activate** all three call-handling workflows in n8n (they must be
   Active for the production webhook URLs to respond).

## Google Calendar OAuth troubleshooting (`Error 401: invalid_client`)

This error means Google's OAuth server doesn't recognize the `client_id`
n8n sent it at all - it happens before the consent screen even loads, so
it's not a scopes/test-user/publishing problem. In rough order of
likelihood:

1. **Propagation delay.** A newly created OAuth Client ID can take
   anywhere from a few minutes to a couple of hours to become live on
   Google's auth servers. If you tested immediately after creating it,
   wait 15-30 minutes and try again before changing anything.
2. **Wrong value pasted into n8n.** The most common mixup is copying the
   Client Secret's *Secret ID* (a short UUID shown in the Google Cloud
   console's secrets table) instead of the actual *Secret value* - or
   pasting a truncated Client ID missing the trailing
   `.apps.googleusercontent.com`. Re-copy both fields directly from Google
   Cloud Console -> APIs & Services -> Credentials -> your OAuth client,
   using the "copy" icon next to each field rather than manual selection.
3. **Client ID belongs to a different project than you think.** If the
   Google account has access to multiple projects/orgs, double check the
   project selector in the top bar matches "My Project 84916" when you're
   viewing the credential.
4. **Google Calendar API not enabled.** Won't cause `invalid_client`
   itself, but you'll hit it right after fixing the above - enable it at
   APIs & Services -> Library -> Google Calendar API -> Enable, in the
   same project.

If none of that resolves it: delete the OAuth client and the redirect URI
entry, wait a minute, then recreate both from scratch (Web application
type, same redirect URI
`https://keystoneconsultancy.app.n8n.cloud/rest/oauth2-credential/callback`),
wait ~15 minutes before testing the new one. Recreating clean rules out
any corrupted/half-propagated state from the first attempt.

Since this is only a stock placeholder (real clients will likely bring
their own calendar system), it's fine to timebox this - if a clean
recreate plus a wait still fails, it's worth a support ticket to Google
rather than more local debugging.

## Known risk to validate first: the SIP handoff

The mid-call `<Dial><Sip>` from Twilio straight into Vapi's SIP trunking
number (Stage 1, digit "2" branch) combines two capabilities that are each
independently documented (Twilio's `<Dial><Sip>` to an arbitrary SIP URI,
and Vapi's SIP trunking phone number format) but I did not find a worked
example of the two chained together after a dynamic IVR digit. **This is
still unverified against a real call** - only an actual test call resolves
it either way. What *has* been added and verified (via simulated Twilio
callbacks, not a real call) is failure handling around that risk, so a
failed handoff is recoverable and visible instead of silently dropping the
caller:

- The `<Dial>` now carries an `action` callback
  (`/webhook/twilio/vapi-dial-status`) that Twilio hits automatically after
  the SIP leg ends, with a `DialCallStatus` (`completed` / `busy` /
  `no-answer` / `failed` / `canceled`).
- Anything other than `completed` -> the caller is still on the line, so
  the workflow returns fresh TwiML forwarding them to reception (with a
  short spoken apology) instead of leaving them with nothing.
- The business also gets an immediate email with the exact
  `DialCallStatus` and `CallSid`, so a handoff failure shows up as a
  specific, searchable error rather than "the call didn't connect" -
  verified this fires even in the failure case using
  `onError: continueRegularOutput`, so a failure in the alert email itself
  can never block the caller's fallback TwiML from being returned.
- Simulated both outcomes directly against the live webhook
  (`DialCallStatus=completed` and `DialCallStatus=failed`) and confirmed
  the correct TwiML each time. This validates the *failure-handling logic*
  end-to-end; it does not validate the SIP dial itself connecting to Vapi,
  which only a real call can do.

If the SIP dial itself doesn't connect cleanly on the first real test call,
the fallback is to have `01-inbound-ivr` call Vapi's REST API (`POST
/call`) directly on digit "2" to originate the assistant leg, using a
`<Dial>` back into a new Twilio number/conference that bridges the caller
to that leg instead of a raw SIP dial. That's more moving parts, so only
build it if the direct SIP dial fails in testing.

## Test call checklist (do in order)

1. Call the Twilio number. Confirm the greeting plays and Gather waits for
   a digit.
2. Press 1. Confirm the call forwards to the reception number with no AI
   involvement.
3. Call again, press 2. Confirm the call connects to the Vapi assistant and
   it speaks naturally (this is the SIP handoff - the step most likely to
   need debugging first).
4. Ask to book a service at a time you know is free. Confirm the assistant
   calls `check_availability`, hears back "available", and proceeds to
   collect your details.
5. Confirm the booking completes and a new Google Calendar event appears
   in the configured calendar.
6. Confirm the customer confirmation email and business notification email
   both arrive.
7. Call again and deliberately request a time that's already booked.
   Confirm the assistant offers alternatives and can complete a booking on
   one of them.
8. Let a call ring through Gather without pressing anything. Confirm it
   fails gracefully (no dead air, no crash).

## Compliance flag

Several jurisdictions (e.g. EU AI Act Article 50 transparency rules, and a
growing number of US state-level rules) require disclosing that a caller is
talking to an AI, at least when directly asked, and sometimes proactively.
The assistant prompt here only discloses if asked. Confirm this is
acceptable for the client's jurisdiction before going live - this is a
legal/business decision, not something I can resolve for you.
