'use strict';
// Safe patching of EXISTING [Stock] workflows (JS twin of stock_patch.py).
// Always: download live -> save backup -> modify -> PUT -> confirm still active.
// Restore with: node scripts/stock.js restore <backup-file>
const fs = require('fs');
const path = require('path');
const { api } = require('./deploy');

const BACKUP_DIR = path.join(__dirname, '..', '..', 'n8n', 'backups', 'patches');
const ALERT_WF = 'GKF6X82UvFFth43w';
const ALLOWED_SETTINGS = ['executionOrder', 'timezone', 'saveManualExecutions', 'saveDataErrorExecution', 'saveDataSuccessExecution', 'saveExecutionProgress', 'executionTimeout', 'errorWorkflow', 'callerPolicy'];

async function credIds() {
  const r = await api('GET', '/credentials?limit=100');
  return Object.fromEntries(r.body.data.map((c) => [`${c.type}|${c.name}`, c.id]));
}

function bodyOf(w) {
  const settings = Object.fromEntries(Object.entries(w.settings || {}).filter(([k]) => ALLOWED_SETTINGS.includes(k)));
  return { name: w.name, nodes: w.nodes, connections: w.connections, settings };
}

async function patch(id, modify, label) {
  const live = (await api('GET', '/workflows/' + id)).body;
  if (!/^\[Stock\]/.test(live.name)) throw new Error('stock.patch only handles [Stock] workflows');
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  const file = path.join(BACKUP_DIR, `${stamp}__${id}__before-${label}.json`);
  fs.writeFileSync(file, JSON.stringify(live, null, 2).replace(/ksops_[A-Za-z0-9_-]{16,}/g, '<REDACTED ops token>'));
  const w = JSON.parse(JSON.stringify(live));
  const creds = await credIds();
  await modify(w, { creds });
  // fill credential ids by name for any node we added
  for (const n of w.nodes) for (const [t, c] of Object.entries(n.credentials || {})) if (!c.id) c.id = creds[`${t}|${c.name}`] || '';
  w.settings = { ...(w.settings || {}), errorWorkflow: ALERT_WF };
  const r = await api('PUT', '/workflows/' + id, bodyOf(w));
  if (r.status >= 300) throw new Error(`PUT failed ${r.status}: ${JSON.stringify(r.body).slice(0, 500)}`);
  let after = (await api('GET', '/workflows/' + id)).body;
  if (live.active && !after.active) {
    const a = await api('POST', `/workflows/${id}/activate`);
    after = (await api('GET', '/workflows/' + id)).body;
    if (!after.active) {
      await api('PUT', '/workflows/' + id, bodyOf(live)); await api('POST', `/workflows/${id}/activate`);
      throw new Error(`Could not re-activate (${JSON.stringify(a.body).slice(0, 300)}); restored the backup.`);
    }
  }
  return { name: after.name, active: after.active, nodes: after.nodes.length, errorWorkflow: (after.settings || {}).errorWorkflow, backup: path.basename(file) };
}

async function restore(file) {
  const w = JSON.parse(fs.readFileSync(file, 'utf8'));
  const r = await api('PUT', '/workflows/' + w.id, bodyOf(w));
  if (w.active) await api('POST', `/workflows/${w.id}/activate`);
  return r.status;
}

// helpers for editing
const H = {
  node: (w, name) => { const n = w.nodes.find((x) => x.name === name); if (!n) throw new Error('missing node ' + name); return n; },
  has: (w, name) => w.nodes.some((x) => x.name === name),
  add: (w, node, position) => {
    w.nodes = w.nodes.filter((x) => x.name !== node.name);
    node.id = node.id || require('crypto').randomUUID();
    node.position = position || [0, 0];
    w.nodes.push(node);
    return node;
  },
  remove: (w, name) => {
    w.nodes = w.nodes.filter((x) => x.name !== name);
    delete w.connections[name];
    for (const k of Object.keys(w.connections)) w.connections[k].main = (w.connections[k].main || []).map((o) => (o || []).filter((c) => c.node !== name));
  },
  setOut: (w, from, out, targets) => {
    const c = (w.connections[from] = w.connections[from] || { main: [] });
    while (c.main.length <= out) c.main.push([]);
    c.main[out] = targets.map((t) => ({ node: t, type: 'main', index: 0 }));
  },
  targets: (w, from, out = 0) => (((w.connections[from] || {}).main || [])[out] || []).map((c) => c.node),
  pos: (w, name, dx = 0, dy = 0) => { const n = H.node(w, name); return [n.position[0] + dx, n.position[1] + dy]; },
};

if (require.main === module && process.argv[2] === 'restore') restore(process.argv[3]).then((s) => console.log('restore status', s));
module.exports = { patch, restore, H, ALERT_WF, credIds };
