# n8n execution budget (9 Nov 2026)

n8n Cloud counts every workflow run. Keystone's plan looks like **Starter: 2,500 a month**. From 1 to 9 November the Sheet Poller alone (every 5 minutes) made about 2,530 runs, which is when n8n stopped running workflows. Set the real limit in Keystone Settings > `n8n_monthly_executions` and the day it resets in `n8n_reset_day`.

## Scheduled runs per month (30 days)

| Workflow | Before | After | New schedule |
|---|---:|---:|---|
| [Stock] Invoice Automation - Sheet Poller | 8,640 | 840 | every 30 min, 07:00-20:30 ("poll now" link still instant) |
| KS Switch-On | 2,880 | 120 | 07:07, 11:07, 15:07, 19:07 |
| KS AI Budget | 1,440 | 60 | 09:40, 17:40 |
| KS Agent - Sales Prep | 1,440 | 90 | 08:05, 13:05, 18:05 |
| KS Agent - Ops Monitor | 720 | 60 | 08:17, 18:17 (now also checks n8n usage) |
| KS Ops Manager | 60 | 60 | 07:30, 18:00 (unchanged) |
| KS Agent - Chief of Staff | 34 | 34 | 07:05 daily + Sunday 18:10 (unchanged) |
| Client Hunter, Outreach, Nurture | 90 | 90 | once a day each (unchanged) |
| KS Website Calculator clean-up | 30 | 4 | Sunday 03:10 (was daily) |
| Weekly Money, Monthly Reporting | 5 | 5 | unchanged |
| **Total scheduled** | **15,339** | **1,363** | **-91%** |

Also counted, depending on how n8n bills them:
- **Client Config sub-workflow** (called by the Sheet Poller once per invoicing client): before 8,640, after 840 per client. Several sources say n8n does not bill sub-workflow runs; the November numbers suggest that is true for this account.
- **Event runs** (website calculator, email opens/clicks, phone calls, invoices, quotes, audits, approvals): about 200-600 a month at launch, rising with clients. One phone call is about 4-6 runs.

**Estimate after:** about 1,560-1,960 a month (63-78% of 2,500) at launch.

Switched-off agents add little when they switch on: about 35 a month at 5 clients, and 9 more at 20 clients.

## Usage alert
Ops Monitor reads n8n's newest execution number twice a day. n8n numbers every run in order, so nothing is missed, and test or sub-workflow runs make the count read slightly high. It emails Bilal once at 80% and once at 100% of the plan, with a forecast for the month. Current figures: Keystone Settings > `n8n_exec_used`.
