'use strict';
// Sets up (or refreshes) a client's Vapi assistant, tools and SIP address from the Airtable registry.
// Usage: KS_VAPI_HELPER_TOKEN=... node scripts/vapi-setup.js KS-DEMO-01
// Prints the SIP URI to put in My Clients > "Vapi SIP URI" (it also writes it for you).
const { toolBodies, assistantBody } = require('../lib/vapiconfig');
const CC = require('../lib/clientconfig');
const AT = require('../config/airtable.json');

const HELPER = 'https://keystoneconsultancy.app.n8n.cloud/webhook/ks-util-vapi-helper';
async function vapi(method, path, body) {
  const r = await fetch(HELPER, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: process.env.KS_VAPI_HELPER_TOKEN, method, path, body }) });
  const j = await r.json();
  if (!j.ok) throw new Error(`${method} ${path} -> ${j.statusCode}: ${String(JSON.stringify(j)).slice(0, 400)}`);
  return j.body;
}
function airtableToken() {
  for (const p of (process.env.N8N_API_KEY || '').split(/[\s,;]+/)) { const v = p.replace(/^[A-Za-z_]+\s*[=:]\s*/, ''); if (v.startsWith('pat')) return v; }
  throw new Error('Airtable token not found');
}
async function airtable(method, path, body) {
  const r = await fetch(`https://api.airtable.com/v0/${AT.baseId}/${path}`, { method, headers: { Authorization: 'Bearer ' + airtableToken(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}

(async () => {
  const clientId = process.argv[2];
  const recs = (await airtable('GET', `${AT.tables.clients}?maxRecords=100`)).records;
  const out = CC.chooseClient(recs, { clientId, service: 'phone' });
  if (out.error) throw new Error(out.error);
  const cfg = CC.toPhoneConfig(out.client, out.record);
  const existingTools = await vapi('GET', 'tool');
  const toolIds = [];
  for (const t of toolBodies()) {
    const found = existingTools.find((x) => x.function && x.function.name === t.function.name && x.server && x.server.url === t.server.url);
    const saved = found ? await vapi('PATCH', 'tool/' + found.id, { function: t.function, server: t.server }) : await vapi('POST', 'tool', t);
    toolIds.push(saved.id);
  }
  const body = assistantBody(cfg, toolIds);
  const assistants = await vapi('GET', 'assistant');
  const mine = assistants.find((a) => (a.metadata || {}).clientId === cfg.clientId);
  const asst = mine ? await vapi('PATCH', 'assistant/' + mine.id, body) : await vapi('POST', 'assistant', body);
  const sipUri = `sip:keystone-${cfg.clientId.toLowerCase()}@sip.vapi.ai`;
  const numbers = await vapi('GET', 'phone-number');
  const num = numbers.find((x) => x.sipUri === sipUri);
  const phone = num ? await vapi('PATCH', 'phone-number/' + num.id, { assistantId: asst.id }) : await vapi('POST', 'phone-number', { provider: 'vapi', sipUri, assistantId: asst.id, name: `Keystone ${cfg.clientId}` });
  await airtable('PATCH', AT.tables.clients, { records: [{ id: out.record.id, fields: { 'Vapi SIP URI': sipUri, 'Vapi assistant ID': asst.id } }] });
  console.log(JSON.stringify({ client: cfg.clientId, assistantId: asst.id, tools: toolIds.length, sipUri, phoneNumberId: phone.id }, null, 1));
})().catch((e) => { console.error('vapi-setup failed:', e.message); process.exit(1); });
