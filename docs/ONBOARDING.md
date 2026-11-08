# System Setup: onboarding a new client

1. **Halal screen.** Confirm no pork, alcohol, gambling, interest-based lending or other haram activity. Tick `Halal screen passed` and add notes. (The automatic screen in `ops/lib/audit.js` flags keywords; you make the final call.)
2. **AI-disclosure check.** Set `Jurisdiction`. If it's EU, or a US state that requires proactive AI disclosure, **do not** switch Phone on. Otherwise tick `AI disclosure check passed`.
3. **Create the registry row.** Copy the demo row in My Clients: new `Client ID` (KS-0001…), `Status = Onboarding`, contact, business email, timezone, brand.
4. **Xero.** The client invites Keystone as a Xero user. Reconnect the n8n "Xero account" credential, including their org, and paste the org ID into `Xero organisation ID`. Set the VAT type, account code and payment terms.
5. **Jobs feed.** Copy the Jobs sheet template, share it with the Google account behind "Google Sheets account", and paste its ID into `Jobs sheet ID`.
6. **Discounts.** Add rows to the Discounts table if needed.
7. **Quotes.** Add their services to **Quote Services** and their pricing factors to **Quote Factors**. Set the VAT settings, minimum margin and approver email.
8. **Phone.** Fill in the Twilio number, reception number, calendar ID, services with durations, opening hours, greeting, tone, urgent words and escalation SMS. Then run `node ops/scripts/vapi-setup.js <Client ID>`. On the client's line, forward calls to the Twilio number.
9. **Email.** Set `From email` to an address on a domain verified in Resend.
10. **Test runs.** One job row set to Complete → check the Xero DRAFT, then delete it. One quote through the form link `…/webhook/ks-quote-form?c=<Client ID>`. One test call using `docs/PHONE_LIVE_TEST.md`.
11. **Go live.** Set `Status = Active` and the service toggles. The next morning's summary should show the client.
12. **Stopping a client:** set `Status = Stopped`. Every service stops on its next run.
