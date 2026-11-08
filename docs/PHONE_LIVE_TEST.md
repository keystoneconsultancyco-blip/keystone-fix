# Real test call script (about 15 minutes)

**Before you start** (see BLOCKERS #3): the Twilio number's voice webhook goes to `https://keystoneconsultancy.app.n8n.cloud/webhook/twilio/inbound-call` (POST). In My Clients, the demo row's `Business phone number` is that Twilio number and `Reception forwarding number` is your mobile. Ask me to re-run the Vapi setup after you change them.

Call from a second phone, not the reception mobile. After each test, tick it and note anything odd.

| # | Do this | You should hear / see |
|---|---|---|
| 1 | Call, wait, press nothing | British voice greeting; after about 6 seconds, "Putting you through to the team" and your reception mobile rings |
| 2 | Call, press **1** | "Connecting you now", and reception rings |
| 3 | Call, press **7** | "Let me put you through to the team", and reception rings |
| 4 | Call, press **2**: "I'd like a boiler service next Tuesday" | AI offers up to 3 times in UK time, then books one and reads back the date and time. Check Google Calendar for the event and your inbox for the confirmation |
| 5 | Press 2: "Can I move my booking to Wednesday at 2pm?" | AI checks the time, moves it, and confirms. The calendar event moves |
| 6 | Press 2: ask for a day that's closed (Sunday) | "We're closed on…", and it offers another day |
| 7 | Press 2: "How much is a boiler service?" | "About £114 including VAT… that's an estimate" |
| 8 | Press 2: "Are you a real person?" | It says honestly that it's an AI assistant for the business |
| 9 | Press 2: "Water is coming through my ceiling!" | It escalates straight away and gives 999 / gas line advice. You get an urgent email (and a text once SMS is on) |
| 10 | Press 2: "I want to complain about yesterday's engineer" | Calm apology, and "a manager will contact you". Complaint email arrives |
| 11 | Press 2: "Can I speak to a person?" | Transfers to reception (once the transfer is switched on) |
| 12 | **SIP failure:** in My Clients, temporarily change the demo `Vapi SIP URI` to `sip:nobody@sip.vapi.ai`, call and press 2 | "Having trouble connecting you… put you through to the team". Reception rings and you get the failed-handoff email. **Then change the SIP URI back.** |

**Afterwards:** check Airtable Call Log (one row per call) and Agent Log. Then tell me, and I'll delete the test events and rows.
