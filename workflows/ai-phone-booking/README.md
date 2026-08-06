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
   - Twilio (Account SID + API Key SID/Secret) - only needed if you want
     n8n to also manage the number's webhook via the Twilio API; otherwise
     just set the webhook URL by hand in the Twilio Console.
   - Google Calendar OAuth2 - connect the client's Google account.
   - SMTP - the mailbox that should send confirmations/notifications.
   Then select each credential in the relevant node (Google Calendar nodes
   in `02-vapi-tools`, Send Email nodes in `03-post-call-actions`).
4. **Twilio Console**: set the client's number's Voice webhook (A call comes
   in) to:
   `https://n8n-production-f071.up.railway.app/webhook/twilio/inbound-call`
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

## Known risk to validate first: the SIP handoff

The mid-call `<Dial><Sip>` from Twilio straight into Vapi's SIP trunking
number (Stage 1, digit "2" branch) combines two capabilities that are each
independently documented (Twilio's `<Dial><Sip>` to an arbitrary SIP URI,
and Vapi's SIP trunking phone number format) but I did not find a worked
example of the two chained together after a dynamic IVR digit. **Test this
first**, before anything else, using the checklist below.

If it doesn't connect cleanly, the fallback is to have `01-inbound-ivr`
call Vapi's REST API (`POST /call`) directly on digit "2" to originate the
assistant leg, using a `<Dial>` back into a new Twilio number/conference
that bridges the caller to that leg instead of a raw SIP dial. That's more
moving parts, so only build it if the direct SIP dial fails in testing.

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
