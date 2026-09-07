# keystone-fix

## Automations

- [`workflows/ai-phone-booking`](workflows/ai-phone-booking/README.md) - stock/reusable n8n template for AI-powered phone booking (Twilio IVR + Vapi voice agent + Google Calendar), customizable per client via a single Client Config sub-workflow.
- [`workflows/invoice-automation`](workflows/invoice-automation/README.md) - stock/reusable n8n template that turns job-completion data into a Xero invoice (with proper internal-ID -> Xero Contact GUID resolution) plus a Resend confirmation email, customizable per client via a single Client Config sub-workflow.
- [`workflows/monthly-reporting`](workflows/monthly-reporting/README.md) - runs monthly across every active client in a new Clients Registry sheet, compiling activity already produced by the other two workflow families into a client-facing performance report (emailed via Resend) plus an internal archive copy per client in Google Drive.