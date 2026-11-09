# AI phone booking: go-live checklist (after you add Vapi credits)

Everything is built and tested without a real call: the phone menu (IVR), the Vapi assistant and its tools (availability, booking, rescheduling, quotes, urgent escalation, messages), the post-call safety net and the Call Log. These steps put it on a real line.

| # | Step | Where | Done when |
|---|---|---|---|
| 1 | Add credits to Vapi (pay-as-you-go; a few pounds covers testing) | dashboard.vapi.ai > Billing | Balance shows above zero |
| 2 | Buy a UK Twilio number (Voice + SMS) | console.twilio.com > Phone Numbers > Buy a number | You have a +44 number |
| 3 | In Airtable > Keystone Settings, fill `twilio_from` (the number), `twilio_account_sid` (starts AC, on the Twilio console home page) and `alert_sms_to` (your mobile) | Airtable | Within 15 minutes you get "Twilio number … is connected". KS Switch-On points the number's calls at the phone menu and its texts at the Ops Manager, and gives the demo client the number |
| 4 | In My Clients > the demo row, put your mobile in `Reception forwarding number` | Airtable | – |
| 5 | Tell me "re-run the Vapi setup" (or run `KS_VAPI_HELPER_TOKEN=… node ops/scripts/vapi-setup.js KS-DEMO-01`). This switches on "transfer to a person", which Vapi refuses for the placeholder number | Me | The SIP address in My Clients is unchanged and transfer is listed in the assistant's tools |
| 6 | Make the 12 test calls in `docs/PHONE_LIVE_TEST.md` from a second phone | Your phone | Every row ticked; Call Log has one row per call |
| 7 | For a real client: tick `AI disclosure check passed` (UK is fine; never EU or US states that require proactive AI disclosure), fill their phone fields, re-run step 5 for their Client ID, and set `Phone on` | Airtable | Their first real call appears in the Call Log |
| 8 | On the client's own line, set call forwarding (busy / no answer / out of hours) to their Twilio number | Their phone provider | A test call from outside reaches the menu |

**If anything fails on a live call**, callers are never dropped: the menu falls back to the reception number, a failed hand-over to the AI is put through to reception, and you get an email (and a text once SMS is on).

**Costs to expect**: Vapi charges per minute (check your plan on the Vapi dashboard); Twilio charges for the number (around £1/month) plus per-minute call charges. The pricing proposal passes call costs above 500 minutes a month on to the client.
