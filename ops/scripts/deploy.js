'use strict';
// Deploys NEW Keystone workflows (names starting "KS ") to n8n Cloud.
// Safety: refuses to create, update or delete any workflow whose name starts with "[Stock]".
// Usage: node scripts/deploy.js "KS Ops - Failure Alerts" ["KS ..."]   (no args = all KS workflows)
// Reads the n8n key from the environment; never prints it.
const { build } = require('./build-workflows');

function keys() {
  const raw = (process.env.N8N_API_KEY || '').trim();
  const out = {};
  for (const p of raw.split(/[\s,;]+/).filter(Boolean)) {
    const v = p.replace(/^[A-Za-z_][A-Za-z0-9_]*\s*[=:]\s*/, '').replace(/^["']|["']$/g, '');
    if (v.startsWith('eyJ')) out.n8n = v;
  }
  if (!out.n8n) throw new Error('n8n API key not found in N8N_API_KEY');
  return out;
}

const BASE = 'https://keystoneconsultancy.app.n8n.cloud/api/v1';
async function api(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { 'X-N8N-API-KEY': keys().n8n, 'Content-Type': 'application/json', Accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let j; try { j = t ? JSON.parse(t) : null; } catch (e) { j = t; }
  return { status: r.status, body: j };
}

async function listAll(path) {
  let out = [], cursor = null;
  do { const r = await api('GET', path + (path.includes('?') ? '&' : '?') + 'limit=100' + (cursor ? '&cursor=' + cursor : '')); out = out.concat(r.body.data || []); cursor = r.body.nextCursor; } while (cursor);
  return out;
}

async function deploy(names) {
  const { workflows } = build({ write: true });
  const creds = await listAll('/credentials');
  const credId = (type, name) => (creds.find((c) => c.type === type && c.name === name) || {}).id;
  const live = await listAll('/workflows');
  const alertWf = live.find((w) => w.name === 'KS Ops - Failure Alerts');
  const targets = Object.values(workflows).filter((w) => !names.length || names.includes(w.name));
  const results = [];
  for (const wf of targets) {
    if (!/^KS /.test(wf.name) || /^\[Stock\]/.test(wf.name)) { results.push({ name: wf.name, skipped: 'not a KS workflow' }); continue; }
    const wants = true;
    const missingSoft = [];
    const nodes = wf.nodes.map((nd) => {
      const c = { ...nd };
      if (c.credentials) {
        const mapped = Object.entries(c.credentials).map(([t, v]) => [t, { id: credId(t, v.name) || '', name: v.name }]);
        // Credentials not created yet (e.g. Twilio) are left off; that node fails softly until added.
        mapped.filter(([, v]) => !v.id).forEach(([, v]) => missingSoft.push(`${c.name}: ${v.name}`));
        c.credentials = Object.fromEntries(mapped.filter(([, v]) => v.id));
        if (!Object.keys(c.credentials).length) delete c.credentials;
      }
      return c;
    });
    // Drop nodes whose required credential doesn't exist yet (n8n refuses to publish them).
    const dropped = wf.nodes.filter((nd) => nd.credentials && !nodes.find((x) => x.name === nd.name).credentials).map((nd) => nd.name);
    const keptNodes = nodes.filter((nd) => !dropped.includes(nd.name));
    const connections = JSON.parse(JSON.stringify(wf.connections));
    for (const k of dropped) delete connections[k];
    for (const k of Object.keys(connections)) connections[k].main = connections[k].main.map((outs) => (outs || []).filter((c) => !dropped.includes(c.node)));
    const missing = keptNodes.flatMap((nd) => Object.values(nd.credentials || {}).filter((c) => !c.id).map((c) => `${nd.name}: ${c.name}`));
    const settings = { executionOrder: 'v1', timezone: 'Europe/London', saveManualExecutions: true, saveDataErrorExecution: 'all', saveDataSuccessExecution: 'all' };
    const errorTarget = live.find((w) => w.name === 'KS Ops - Failure Alerts') || alertWf;
    if (wf.name !== 'KS Ops - Failure Alerts' && errorTarget) settings.errorWorkflow = errorTarget.id;
    const body = { name: wf.name, nodes: keptNodes, connections, settings };
    const existing = live.find((w) => w.name === wf.name);
    const r = existing ? await api('PUT', '/workflows/' + existing.id, body) : await api('POST', '/workflows', body);
    if (r.status >= 300) { results.push({ name: wf.name, error: r.status, detail: JSON.stringify(r.body).slice(0, 400) }); continue; }
    const id = r.body.id;
    if (!existing) live.push({ id, name: wf.name });
    const hasTrigger = wf.nodes.some((x) => /webhook|scheduleTrigger|formTrigger|errorTrigger|executeWorkflowTrigger/.test(x.type));
    let active = null;
    if (hasTrigger && !missing.length) {
      const a = await api('POST', `/workflows/${id}/activate`);
      active = a.status < 300 ? a.body.active : `activate failed ${a.status}: ${JSON.stringify(a.body).slice(0, 200)}`;
    }
    const check = await api('GET', '/workflows/' + id);
    results.push({ name: wf.name, id, created: !existing, activeNow: check.body.active, activation: active, errorWorkflow: (check.body.settings || {}).errorWorkflow || null, missingCredentials: missing, notYetConnected: [...new Set(missingSoft)], droppedUntilConnected: dropped });
  }
  return results;
}

if (require.main === module) deploy(process.argv.slice(2)).then((r) => console.log(JSON.stringify(r, null, 1))).catch((e) => { console.error('deploy failed:', e.message); process.exit(1); });
module.exports = { deploy, api, listAll };
