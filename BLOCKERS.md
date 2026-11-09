# Blockers: things only Bilal can do

**The up-to-date ordered list with links is in `GO_LIVE.md`.** Details below.

1. **Verify a sending domain in Resend.** Resend > Domains: add your domain and its DNS records. Then put the new from-address in Airtable > Keystone Settings > `email_from` and in each client's `From email`. *Until then, emails only reach khan.bilalbk408@gmail.com, so real customers get nothing. This also stops alerts and approval emails landing in Spam.*
2. **Buy a Twilio number** (console.twilio.com > Phone Numbers; paid, so your call). Put it in Keystone Settings > `twilio_from`, and your mobile in `alert_sms_to`. SMS alerts, summaries and YES/NO replies then switch on by themselves. Also set the number's "A message comes in" webhook to `https://keystoneconsultancy.app.n8n.cloud/webhook/ks-ops-sms`.
3. **Make the real test call** using `docs/PHONE_LIVE_TEST.md`. First set the Twilio number's "A call comes in" webhook to `.../webhook/twilio/inbound-call` (POST). In My Clients, put that Twilio number in the demo client's `Business phone number` and your mobile in `Reception forwarding number`. Then I re-run `vapi-setup.js` to switch on the transfer to a person.
4. **Check Gmail Spam** for "[Keystone] Quote to approve ... (#8072)" and mark it Not spam.
5. **Rotate the Resend key** (it was exposed in a chat earlier). You said you've updated "Header Auth account 2"; if that was a new key, this is done.
6. **Delete the old `N8N_API_KEY` environment variable** (cloud environment menu > Edit > Environment variables). Its three keys are no longer needed there: the n8n and Airtable keys are now network secrets, and the Claude key already lives in the n8n credential "Keystone Anthropic". See `docs/SECURITY.md`.
7. **Pricing approved** (`docs/PRICING.md`, 9 Nov). Website is live.
8. **Xero for real clients:** each client adds Keystone as a user in their Xero; then you reconnect the "Xero account" credential in n8n including their org, and put the org ID in My Clients > `Xero organisation ID`.
9. **Client diagnosis/meeting document:** not found in Drive or Gmail. Send the link if it exists; otherwise the audit report template in `ops/lib/audit.js` replaces it.
10. **Reconnect the Xero credential with report access.** n8n > Credentials > "Xero account" > reconnect, and make sure the `accounting.reports.read` scope is ticked. *Until then the weekly money email can't read profit and loss or bank balances (Xero returns 401). It still sends using invoices and Airtable data; income, costs and bank balance are left blank, and the Agent Log records why.*
