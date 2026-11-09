'use strict';
// Which Claude model each job uses, what it costs, and the monthly budget rules.
//  - Routine agent work (summaries, drafts, research, explainers) -> Claude Haiku 5.5 (cheap, fast).
//  - Client audits and finance decisions (invoice fixes, proposals and pricing, CFO review) -> Claude Opus 5.5.
//  - Every call is logged to Airtable "AI Usage" with its cost.
//  - At 80% of the monthly credit Bilal is alerted. Over 100%, non-urgent work is queued until there is room.
//    Customer-facing work (phone, quotes, invoices) is never queued: it either runs or uses its non-AI fallback.

const MODELS = { routine: 'claude-haiku-5-5', strong: 'claude-opus-5-5' };

// task -> tier. Anything not listed is routine.
const TASKS = {
  audit_report: 'strong',
  invoice_exception: 'strong',
  proposal: 'strong',
  cfo_review: 'strong',
  quote_estimate: 'routine',
  weekly_explainer: 'routine',
  lead_research: 'routine',
  outreach_draft: 'routine',
  call_brief: 'routine',
  chief_brief: 'routine',
  chief_scorecard: 'routine',
  onboarding_check: 'routine',
  client_success: 'routine',
  content_draft: 'routine',
  compliance_check: 'routine',
  systems_review: 'routine',
};

// Never queued: a customer, client or prospect is waiting (each of these also has a non-AI fallback).
const URGENT = new Set(['invoice_exception', 'quote_estimate', 'audit_report', 'weekly_explainer']);

// US dollars per million tokens (Anthropic first-party list prices). cacheWrite = 5-minute writes.
const PRICES = {
  'claude-haiku-5-5': { input: 0.10, output: 0.50, cacheRead: 0.01, cacheWrite: 0.125, long: { input: 0.50, output: 2.50, cacheRead: 0.05, cacheWrite: 0.625 }, longAbove: 100000 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.20, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.20, cacheWrite: 2.5 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.50, cacheWrite: 6.25 },
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
};
const WEB_SEARCH_USD = 0.01; // $10 per 1,000 searches

function tierOf(task) { return TASKS[task] || 'routine'; }
function modelFor(task) { return MODELS[tierOf(task)]; }
function isUrgent(task) { return URGENT.has(task); }

function priceFor(model) {
  const m = String(model || '');
  if (PRICES[m]) return PRICES[m];
  const key = Object.keys(PRICES).find((k) => m.startsWith(k));
  return key ? PRICES[key] : PRICES['claude-opus-5-5']; // unknown model: price high, never under-count
}

// Cost of one usage block. Haiku switches to its long-prompt card above 100K prompt tokens.
function usageCost(usage, model) {
  const u = usage || {};
  const p0 = priceFor(model);
  const inTok = Number(u.input_tokens) || 0;
  const cr = Number(u.cache_read_input_tokens) || 0;
  const cw = Number(u.cache_creation_input_tokens) || 0;
  const out = Number(u.output_tokens) || 0;
  const p = p0.long && inTok + cr + cw > p0.longAbove ? p0.long : p0;
  const searches = Number(u.server_tool_use && u.server_tool_use.web_search_requests) || 0;
  return (inTok * p.input + cr * p.cacheRead + cw * p.cacheWrite + out * p.output) / 1e6 + searches * WEB_SEARCH_USD;
}

// Cost of a whole response. If a server-side fallback ran, usage.iterations lists each model's share.
function costOf(response) {
  if (!response || typeof response !== 'object' || !response.usage) return 0;
  const its = Array.isArray(response.usage.iterations) ? response.usage.iterations.filter((x) => x && (x.input_tokens || x.output_tokens)) : [];
  if (its.length) {
    const searches = Number(response.usage.server_tool_use && response.usage.server_tool_use.web_search_requests) || 0;
    return its.reduce((s, x) => s + usageCost({ ...x, server_tool_use: null }, x.model || response.model), 0) + searches * WEB_SEARCH_USD;
  }
  return usageCost(response.usage, response.model);
}

function round4(n) { return Math.round((Number(n) || 0) * 10000) / 10000; }

// Airtable "AI Usage" row for one Claude call (also for failed calls: tokens may still be billed).
function usageRecord({ response, task, agent, workflow, clientId, executionId, outcome, now }) {
  const r = response && typeof response === 'object' ? response : {};
  const u = r.usage || {};
  const model = r.model || modelFor(task);
  const ts = (now || new Date()).toISOString();
  return {
    'Run': `${agent || workflow || 'ai'} · ${task} · ${ts.slice(0, 16).replace('T', ' ')}`,
    'Timestamp': ts,
    'Agent': agent || '',
    'Workflow': workflow || '',
    'Client ID': clientId || '',
    'Task': task,
    'Tier': tierOf(task) === 'strong' ? 'Strong (Opus)' : 'Routine (Haiku)',
    'Model': model,
    'Input tokens': (Number(u.input_tokens) || 0) + (Number(u.cache_read_input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0),
    'Output tokens': Number(u.output_tokens) || 0,
    'Web searches': Number(u.server_tool_use && u.server_tool_use.web_search_requests) || 0,
    'Cost USD': round4(costOf(r)),
    'Outcome': outcome || (r.usage ? 'OK' : 'No response'),
    'Execution ID': executionId ? String(executionId) : '',
  };
}

// ---------- monthly budget ----------
function monthKey(d) { return (d || new Date()).toISOString().slice(0, 7); }

function budgetStatus(spentUsd, creditUsd, alertPct) {
  const credit = Number(creditUsd) || 0;
  if (!credit) return { status: 'ok', pct: 0 };
  const pct = (Number(spentUsd) || 0) / credit * 100;
  const warnAt = Number(alertPct) || 80;
  return { status: pct >= 100 ? 'over' : pct >= warnAt ? 'warning' : 'ok', pct: Math.round(pct * 10) / 10 };
}

// Should this task call Claude now? S = Keystone Settings map.
function gate(S, task) {
  const status = String((S && S.ai_status) || 'ok').toLowerCase();
  const sameMonth = !S || !S.ai_spend_month || S.ai_spend_month === monthKey();
  if (status === 'over' && sameMonth && !isUrgent(task)) return { allow: false, reason: 'Monthly AI credit used up: queued until there is room.' };
  return { allow: true };
}

// Alert decisions for the budget workflow. Returns which alerts to send now (each once per month).
function budgetAlerts(S, status, pct, month) {
  const out = [];
  if (pct >= (Number(S.ai_alert_pct) || 80) && S.ai_alert_80_sent !== month) out.push({ level: 80, key: 'ai_alert_80_sent' });
  if (pct >= 100 && S.ai_alert_100_sent !== month) out.push({ level: 100, key: 'ai_alert_100_sent' });
  return out;
}

module.exports = { MODELS, TASKS, PRICES, WEB_SEARCH_USD, tierOf, modelFor, isUrgent, priceFor, usageCost, costOf, usageRecord, monthKey, budgetStatus, gate, budgetAlerts, round4 };
