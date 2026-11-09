# Where Keystone's keys live

| Key | Where it lives now | Used by |
|---|---|---|
| n8n API key | Claude cloud environment > Network secrets (host `keystoneconsultancy.app.n8n.cloud`) | Deploy and test scripts (`ops/scripts`) |
| Airtable token | Claude cloud environment > Network secrets (host `api.airtable.com`) | Test clean-up and the Vapi setup script; n8n uses its own credential "Keystone Airtable" |
| Claude (Anthropic) API key | n8n credential "Keystone Anthropic" | Every AI step in n8n |
| Resend, Xero, Google, Vapi, Twilio | n8n credentials | n8n workflows |

Network secrets are added to requests by the environment's proxy, so no script or log ever holds the real value.
Node scripts must run with `NODE_USE_ENV_PROXY=1` (see `ops/scripts/secrets.js`).

**You can delete:** the `N8N_API_KEY` environment variable (it held all three keys in plain text). Nothing reads it any more.
