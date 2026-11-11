'use strict';
// GREEN LIGHT: switch Keystone back on in safe order, one stage at a time, testing each stage before the next.
// Only run after Bilal has said "GREEN LIGHT" (see GREEN_LIGHT.md).
//   NODE_USE_ENV_PROXY=1 KS_GREEN_LIGHT=1 node --no-warnings scripts/green-light.js <stage>
// Stages, in order: alerts, core, ops, agents, check.   (status = read-only overview; safe any time)
// Only workflows that were active before the pause are switched on (n8n/backups/2026-11-11-pause/_active_before_pause.json).
const fs = require('fs');
const path = require('path');
const { n8nKey, airtableToken } = require('./secrets');
const AT = require('../config/airtable.json');

const N8N = 'https://keystoneconsultancy.app.n8n.cloud';
const BEFORE = path.join(__dirname, '../../n8n/backups/2026-11-11-pause/_active_before_pause.json');

const STAGES = {
  // 1. Alerts first, so anything that breaks later is reported.
  alerts: ['KS Ops - Notify', 'KS Ops - Failure Alerts'],
  // 2. Client services (sub-workflows before the workflows that call them).
  core: ['[Stock] Invoice Automation - Client Config', '[Stock] Phone Booking - Client Config',
    '[Stock] Invoice Automation', '[Stock] Invoice Automation - Sheet Poller', '[Stock] Monthly Reporting',
    '[Stock] Phone Booking - 1. Inbound IVR', '[Stock] Phone Booking - 2. Vapi Tools', '[Stock] Phone Booking - 3. Post-Call Actions',
    'KS Quote Calculator', 'KS Audit Agent', 'KS Weekly Money + Dashboard'],
  // 3. Keystone's own operations (website backend, tracking, approvals, budget, switch-on, Jarvis feed).
  ops: ['KS Ops Manager', 'KS AI Budget', 'KS Switch-On', 'KS Website Calculator', 'KS Nurture Tracking', 'KS Jarvis Feed', 'KS Agent Switch'],
  // 4. Agents last.
  agents: ['KS Agent - Ops Monitor', 'KS Agent - Chief of Staff', 'KS Agent - Client Hunter', 'KS Agent - Outreach', 'KS Agent - Sales Prep', 'KS Agent - Nurture'],
};

async function n8n(method, p, body) {
  const r = await fetch(N8N + '/api/v1' + p, { method, headers: { 'X-N8N-API-KEY': n8nKey(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function settings() {
  const r = await fetch(`https://api.airtable.com/v0/${AT.baseId}/${AT.tables.settings}?pageSize=100`, { headers: { Authorization: 'Bearer ' + airtableToken() } });
  const S = {}; for (const x of (await r.json()).records || []) S[x.fields.Setting] = String(x.fields.Value || '').trim();
  return S;
}
async function setSetting(k, v) {
  await fetch(`https://api.airtable.com/v0/${AT.baseId}/${AT.tables.settings}`, { method: 'PATCH', headers: { Authorization: 'Bearer ' + airtableToken(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ performUpsert: { fieldsToMergeOn: ['Setting'] }, records: [{ fields: { Setting: k, Value: v } }] }) });
}
async function workflows() {
  let out = [], cursor;
  do { const r = await n8n('GET', '/workflows?limit=250' + (cursor ? '&cursor=' + cursor : '')); out = out.concat(r.body.data || []); cursor = r.body.nextCursor; } while (cursor);
  return out;
}
async function latestExec() { const r = await n8n('GET', '/executions?limit=1'); const e = (r.body.data || [])[0]; return e ? { id: Number(e.id), at: e.startedAt, status: e.status, wf: e.workflowId } : null; }
async function waitExec(afterId, ms = 20000) {
  const t = Date.now();
  while (Date.now() - t < ms) { await new Promise((r) => setTimeout(r, 2500)); const e = await latestExec(); if (e && e.id > afterId) return e; }
  return null;
}
const hook = (p, opts = {}) => fetch(N8N + '/webhook/' + p, { redirect: 'manual', ...opts }).then(async (r) => ({ status: r.status, text: (await r.text()).slice(0, 300) }));

async function activate(names) {
  const before = JSON.parse(fs.readFileSync(BEFORE, 'utf8'));
  const wasOn = new Set(before.filter((w) => w.active).map((w) => w.name));
  const all = await workflows();
  for (const name of names) {
    const w = all.find((x) => x.name === name);
    if (!w) { console.log('  MISSING  ', name); continue; }
    if (!wasOn.has(name)) { console.log('  skipped   ', name, '(was off before the pause)'); continue; }
    const r = await n8n('POST', `/workflows/${w.id}/activate`);
    console.log(r.status < 300 && r.body.active ? '  ON       ' : '  FAILED   ', name, r.status < 300 ? '' : JSON.stringify(r.body).slice(0, 200));
  }
}

const TESTS = {
  // Each test costs 1-3 n8n executions. Expected results are printed next to each one.
  async alerts(S) {
    console.log('Test: the alert path is on. (A forced-failure test would need a temporary workflow; skipped to save executions.)');
    const all = await workflows();
    for (const n of STAGES.alerts) console.log('  ', n, (all.find((w) => w.name === n) || {}).active ? 'active' : 'NOT ACTIVE');
  },
  async core(S) {
    const e0 = (await latestExec()).id;
    const q = await hook('ks-quote-form?c=KS-DEMO-01');
    console.log('Test: demo quote form page ->', q.status, q.status === 200 ? 'OK' : 'PROBLEM');
    const p = await hook('invoice/poll-now', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    console.log('Test: invoice "poll now" ->', p.status, p.status < 300 ? 'OK' : 'PROBLEM');
    const e = await waitExec(e0);
    console.log('  newest execution:', e ? `#${e.id} ${e.status}` : 'none seen (check n8n > Executions)');
  },
  async ops(S) {
    const f = await hook('ks-jarvis-feed', { headers: { 'x-keystone-token': S.jarvis_feed_token || '' } });
    console.log('Test: Jarvis feed ->', f.status, /"ok":true/.test(f.text) ? 'OK' : 'PROBLEM');
    const px = await hook('ks-nurture-open?s=x&t=y');
    console.log('Test: email open pixel ->', px.status, px.status === 200 ? 'OK' : 'PROBLEM');
    const c = await hook('ks-calc-start', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ website: 'honeypot-test' }) });
    console.log('Test: website calculator (bot test: stores and sends nothing) ->', c.status, c.status === 200 ? 'OK' : 'PROBLEM');
    const s = await hook('ks-switch-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: S.agent_run_token }) });
    console.log('Test: Switch-On check ->', s.status, s.status < 300 ? 'OK (it also re-checks the email domain with Resend)' : 'PROBLEM');
  },
  async agents(S) {
    const e0 = (await latestExec()).id;
    const r = await hook('ks-agent-ops-monitor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: S.agent_run_token }) });
    console.log('Test: Ops Monitor run now ->', r.status);
    const e = await waitExec(e0, 40000);
    console.log('  Ops Monitor run:', e ? `#${e.id} ${e.status}` : 'not seen yet', '(its summary in Airtable > Agent Team Log should say "26/26 workflows on")');
    console.log('The other agents run on their own schedules (no forced runs: they cost AI credit and can email).');
  },
};

async function status() {
  const all = await workflows();
  const on = all.filter((w) => w.active);
  const S = await settings();
  const e = await latestExec();
  console.log('system_status =', S.system_status || '(blank)');
  console.log('active workflows:', on.length, on.map((w) => w.name).join(', '));
  console.log('latest execution:', e ? `#${e.id} at ${e.at}` : 'none');
}

(async () => {
  const stage = process.argv[2];
  if (stage === 'status') return status();
  if (process.env.KS_GREEN_LIGHT !== '1') { console.error('Refusing: set KS_GREEN_LIGHT=1, and only after Bilal has said "GREEN LIGHT".'); process.exit(1); }
  const S = await settings();
  if (stage === 'check') {
    const before = JSON.parse(fs.readFileSync(BEFORE, 'utf8')).filter((w) => w.active).map((w) => w.name);
    const on = new Set((await workflows()).filter((w) => w.active).map((w) => w.name));
    const missing = before.filter((n) => !on.has(n));
    console.log(`Active now: ${on.size}. Active before the pause: ${before.length}. Missing: ${missing.length ? missing.join(', ') : 'none'}`);
    if (!missing.length) { await setSetting('system_status', 'LIVE'); console.log('system_status set to LIVE.'); }
    return;
  }
  if (!STAGES[stage]) { console.error('Stage must be one of: alerts, core, ops, agents, check, status'); process.exit(1); }
  console.log(`== GREEN LIGHT stage: ${stage}`);
  await activate(STAGES[stage]);
  await TESTS[stage](S);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
