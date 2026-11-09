'use strict';
// Builds an agent workflow from a short description, so every Keystone agent works the same way:
//
//   triggers (schedule + token-protected "run now" webhook)
//     -> [optional n8n API reads] -> Airtable reads (settings + Agents + whatever the agent needs)
//     -> Plan: is the agent Live? is there AI budget? -> jobs (each job = one Claude call, or none)
//     -> Claude (model chosen by task: Haiku routine / Opus audits & finance)
//     -> Handle each job (agent code) -> AI Usage row + writes + approvals/notices
//     -> Finish: Agent Team Log row, Agents "Last run", notices to Bilal via KS Ops - Notify
//
// Agent code is plain JS strings run inside n8n Code nodes with the shared library (KS.*) available.
const n = require('./n8n');

const BASE = 'https://keystoneconsultancy.app.n8n.cloud/webhook';
const LIBS = ['agentteam', 'ai', 'agent', 'requests', 'log', 'opsmanager', 'registry', 'time'];

function makeAgent(def) {
  const { name, slug, crons = [], libs = [], inactive = false } = def;
  const L = [...new Set(LIBS.concat(libs))];
  const runPath = 'ks-agent-' + slug;
  const nodes = [];
  const edges = [];
  const triggers = crons.map((c, i) => n.schedule(c.label || `Schedule ${i + 1}`, c.cron));
  nodes.push(...triggers, n.webhook('Run now', runPath, { respond: 'onReceived' }));

  // ---- reads ----
  const readsStart = def.n8nReads ? 'Plan n8n reads' : 'Plan reads';
  if (def.n8nReads) {
    nodes.push(
      n.code('Plan n8n reads', `
const input = ($input.first().json.body || {});
const isWebhook = !!$input.first().json.headers;
const out = (() => { ${def.n8nReads} })();
return out.map(([key, path]) => ({ json: { key, input, isWebhook, req: { url: 'https://keystoneconsultancy.app.n8n.cloud/api/v1' + path, method: 'GET' } } }));`),
      Object.assign(n.http('Read n8n API', 'n8n', { method: 'GET', sendBody: false }), { onError: 'continueRegularOutput' }),
      n.code('Collect n8n reads', `
const plan = $('Plan n8n reads').all();
const N = {};
$input.all().forEach((it, i) => { N[plan[i].json.key] = it.json.statusCode < 300 ? it.json.body : { error: it.json.statusCode }; });
return [{ json: { body: plan[0] ? plan[0].json.input : {}, isWebhook: plan[0] ? plan[0].json.isWebhook : false, n8n: N } }];`),
    );
    edges.push(['Plan n8n reads', 'Read n8n API'], ['Read n8n API', 'Collect n8n reads'], ['Collect n8n reads', 'Plan reads']);
  }
  nodes.push(
    n.code('Plan reads', `
const { requests: R, log: Lg } = KS;
const first = $input.first().json;
const input = first.body || {};
const isWebhook = first.isWebhook !== undefined ? !!first.isWebhook : !!first.headers;
const N = first.n8n || {};
const list = (table, opts) => R.airtableList(AIRTABLE.baseId, AIRTABLE.tables[table], opts || {});
const extra = (() => { ${def.reads || 'return [];'} })();
const reads = [['settings', list('settings', { maxRecords: 100 })], ['agents', list('agents', { maxRecords: 50 })]].concat(extra);
return reads.map(([key, req]) => ({ json: { key, input, isWebhook, n8n: N, req } }));`, { libs: L }),
    Object.assign(n.airtableHttp('Read Airtable', 'GET'), { onError: 'continueRegularOutput' }),
    n.code('Plan', `
const { agentteam: T, ai: AI, agent: A, requests: R, opsmanager: O, log: Lg, registry: Rg, time: Tm } = KS;
const plan = $('Plan reads').all();
const D = {}; const readErrors = [];
$input.all().forEach((it, i) => { const k = plan[i].json.key; if (it.json.statusCode >= 300 || !it.json.body) readErrors.push(k + ' ' + it.json.statusCode); D[k] = ((it.json.body || {}).records) || []; });
const input = plan[0].json.input || {};
const N = plan[0].json.n8n || {};
const S = O.settingsMap(D.settings);
const rows = T.agentRows(D.agents);
const SLUG = ${JSON.stringify(slug)};
const me = T.bySlug(SLUG);
const now = new Date();
const RUN_URL = '${BASE}/${runPath}';
const fromWebhook = !!plan[0].json.isWebhook;
// Run-now calls must carry the agent token (stops strangers spending AI credit).
if (fromWebhook && (!S.agent_run_token || input.token !== S.agent_run_token)) return [{ json: { route: 0, skip: 'refused', reason: 'Run-now call without a valid token.' } }];
if (!T.isLive(rows, SLUG) && !(input.force && input.token === S.agent_run_token)) return [{ json: { route: 0, skip: 'off', reason: me.name + ' is ' + ((rows[SLUG] || {}).status || 'not in the Agents table') + '.' } }];
if (readErrors.includes('settings 0') || readErrors.some((x) => /^agents/.test(x))) throw new Error('${name}: could not read Airtable (' + readErrors.join(', ') + ')');
const jobs = (() => { ${def.plan} })() || [];
const needsAI = jobs.filter((j) => j.req);
const tasks = [...new Set(needsAI.map((j) => j.task))];
const blocked = tasks.find((t) => !AI.gate(S, t).allow);
if (blocked) return [{ json: { route: 0, skip: 'budget', reason: AI.gate(S, blocked).reason, queue: { task: blocked, payload: { ...input, token: undefined } } } }];
if (!jobs.length) return [{ json: { route: 0, skip: 'nothing', reason: ${JSON.stringify(def.nothingToDo || 'Nothing to do this run.')} } }];
return jobs.map((j) => ({ json: { route: j.req ? 1 : 2, token: S.agent_run_token, job: j, ctx: j.ctx || {}, task: j.task || null, req: j.req ? { url: A.API_URL, method: 'POST', body: j.req.body } : null } }));`, { libs: L }),
    n.route('Work or skip?', 3),
    Object.assign(n.claudeHttp('Claude'), { onError: 'continueRegularOutput' }),
    n.code('Handle job', `
const { agentteam: T, ai: AI, agent: A, requests: R, opsmanager: O, log: Lg, registry: Rg, time: Tm } = KS;
const viaAI = !$json.job;
const g = viaAI ? $('Plan').item.json : $json;
const job = g.job, ctx = g.ctx || {};
const res = viaAI ? $json : null;
const body = res && res.body;
const parsed = viaAI ? (R.ok(res) ? A.parseClaudeJson(body) : { ok: false, error: 'http_' + (res && res.statusCode), detail: body && body.error && body.error.message }) : null;
const SLUG = ${JSON.stringify(slug)};
const now = new Date();
const out = (() => { ${def.handle} })() || {};
// Calls to our own agent webhooks carry the agent token.
const W = (out.writes || []).map((w) => (w.kind === 'webhook' && w.req && w.req.body && w.req.body.token === '__TOKEN__') ? { ...w, req: { ...w.req, body: { ...w.req.body, token: g.token } } } : w);
if (viaAI) W.push(R.write.airtable(R.airtableCreate(AIRTABLE.baseId, AIRTABLE.tables.aiUsage, [AI.usageRecord({ response: body, task: job.task, agent: SLUG, workflow: ${JSON.stringify(name)}, clientId: job.clientId || '', executionId: $execution.id, outcome: parsed && parsed.ok ? 'OK' : 'Failed: ' + (parsed && parsed.error) })])));
return { json: { writes: W, notices: out.notices || [], log: out.log || [], done: out.done || 0, summary: out.summary || '', error: out.error || (parsed && !parsed.ok ? (parsed.error + (parsed.detail ? ': ' + String(parsed.detail).slice(0, 200) : '')) : null), cost: viaAI ? AI.costOf(body) : 0, result: out.result || null } };`, { libs: L, mode: 'runOnceForEachItem' }),
    n.code('Finish', `
const { agentteam: T, ai: AI, requests: R, opsmanager: O, log: Lg, time: Tm } = KS;
const SLUG = ${JSON.stringify(slug)};
const me = T.bySlug(SLUG);
const results = $input.all().map((i) => i.json);
const now = new Date();
const extra = (() => { ${def.finish || 'return {};'} })() || {};
const done = results.reduce((s, r) => s + (r.done || 0), 0) + (extra.done || 0);
const errs = results.filter((r) => r.error).map((r) => r.error);
const cost = results.reduce((s, r) => s + (r.cost || 0), 0);
const own = results.map((r) => r.summary).filter(Boolean);
const summary = extra.summary || (own.length === 1 ? own[0] : own.length ? own.slice(0, 3).join(' | ') + (own.length > 3 ? ' (+' + (own.length - 3) + ' more)' : '') : (me.name + ': ' + done + ' done' + (errs.length ? ', ' + errs.length + ' problem(s)' : '') + '.'));
const logRows = [].concat(...results.map((r) => r.log || []), extra.log || []).map((l) => T.logRow({ agent: SLUG, executionId: $execution.id, ...l }));
logRows.push(T.logRow({ agent: SLUG, kind: done ? 'Completed' : 'Run', summary, items: done, metric: me.metric, cost, executionId: $execution.id, details: errs.length ? 'Problems: ' + errs.join(' | ') : undefined }));
if (errs.length) logRows.push(T.logRow({ agent: SLUG, kind: 'Error', summary: me.name + ': ' + errs[0], details: errs.join('\\n'), executionId: $execution.id }));
const tok = $('Plan').first().json.token;
const W = (extra.writes || []).map((w) => (w.kind === 'webhook' && w.req && w.req.body && w.req.body.token === '__TOKEN__') ? { ...w, req: { ...w.req, body: { ...w.req.body, token: tok } } } : w);
for (let i = 0; i < logRows.length; i += 10) W.push(R.write.airtable(R.airtableCreate(AIRTABLE.baseId, AIRTABLE.tables.teamLog, logRows.slice(i, i + 10))));
const agentRec = ($('Plan reads').all().length && $('Read Airtable').all()[1]) ? (((($('Read Airtable').all()[1].json.body) || {}).records) || []).find((r) => r.fields && r.fields.Slug === SLUG) : null;
if (agentRec) W.push(R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.agents, [{ id: agentRec.id, fields: { 'Last run': now.toISOString(), 'Last result': summary.slice(0, 1000), 'Counters JSON': JSON.stringify(T.bumpCounters(agentRec.fields['Counters JSON'], done, cost, now)), ...(extra.agentFields || {}) } }])));
const notices = [].concat(...results.map((r) => r.notices || []), extra.notices || []);
return [{ json: { writes: W, summary, done, errors: errs, notices } }];`, { libs: L }),
    n.code('Notices', `
const out = [];
for (const it of $input.all()) for (const x of (it.json.notices || [])) out.push({ json: x });
return out;`),
    n.notify('Tell Bilal'),
    n.code('Skipped', `
const { agentteam: T, requests: R } = KS;
const x = $json;
const SLUG = ${JSON.stringify(slug)};
const W = [];
if (x.skip === 'budget') {
  W.push(R.write.airtable(R.airtableCreate(AIRTABLE.baseId, AIRTABLE.tables.aiQueue, [{ 'Task': x.queue.task, 'Agent': SLUG, 'Status': 'Waiting', 'Retry webhook': '${BASE}/${runPath}', 'Payload JSON': JSON.stringify(x.queue.payload || {}), 'Created': new Date().toISOString(), 'Notes': x.reason }])));
}
if (x.skip === 'budget' || x.skip === 'refused') W.push(R.write.airtable(R.airtableCreate(AIRTABLE.baseId, AIRTABLE.tables.teamLog, [T.logRow({ agent: SLUG, kind: 'Skipped', summary: x.reason, executionId: $execution.id })])));
return [{ json: { skipped: x.skip, reason: x.reason, writes: W } }];`, { libs: L }),
  );
  for (const t of triggers) edges.push([t.name, readsStart]);
  edges.push(['Run now', readsStart], ['Plan reads', 'Read Airtable'], ['Read Airtable', 'Plan'], ['Plan', 'Work or skip?'],
    ['Work or skip?', 'Skipped', 0], ['Work or skip?', 'Claude', 1], ['Work or skip?', 'Handle job', 2], ['Claude', 'Handle job'],
    ['Handle job', 'Finish'], ['Handle job', 'Fan out writes'], ['Finish', 'Fan out writes'], ['Finish', 'Notices'], ['Notices', 'Tell Bilal'], ['Skipped', 'Fan out writes']);
  const tail = n.writesTail();
  nodes.push(...tail.nodes);
  edges.push(...tail.edges);
  return n.workflow(name, nodes, edges, { tags: ['keystone', 'agent'], inactive });
}

module.exports = { makeAgent, BASE };
