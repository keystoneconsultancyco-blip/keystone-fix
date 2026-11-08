'use strict';
// Change 2: both Client Config sub-workflows read the Airtable registry (same output field names).
const n = require('../scripts/n8n');
const { patch, H } = require('../scripts/stock');
const L = ['clientconfig', 'registry', 'requests', 'log'];

function rebuild(service, mapFn) {
  return async (w) => {
    const trig = w.nodes.find((x) => x.type.includes('executeWorkflowTrigger'));
    const p = trig.position;
    H.remove(w, 'Client Config');
    H.add(w, n.code('Find client in registry', `
const hint = KS.clientconfig.hintFrom($input.first().json, '${service}');
return [{ json: { hint, req: KS.requests.airtableList(AIRTABLE.baseId, AIRTABLE.tables.clients, { maxRecords: 100 }) } }];`, { libs: L }), [p[0] + 240, p[1]]);
    H.add(w, n.airtableHttp('Get clients from Airtable', 'GET'), [p[0] + 480, p[1]]);
    H.add(w, n.code('Client Config', `
const { clientconfig: CC, requests: R } = KS;
const res = $input.first().json;
if (!R.ok(res)) throw new Error('CLIENT CONFIG: could not read the Airtable registry (' + res.statusCode + ')');
const hint = $('Find client in registry').first().json.hint;
const out = CC.chooseClient(res.body.records || [], hint);
if (out.error) throw new Error('CLIENT CONFIG (${service}): ' + out.error);
return [{ json: CC.${mapFn}(out.client, out.record) }];`, { libs: L }), [p[0] + 720, p[1]]);
    H.setOut(w, trig.name, 0, ['Find client in registry']);
    H.setOut(w, 'Find client in registry', 0, ['Get clients from Airtable']);
    H.setOut(w, 'Get clients from Airtable', 0, ['Client Config']);
    const note = w.nodes.find((x) => x.type.includes('stickyNote'));
    if (note) note.parameters.content = `## Client Config (Keystone)\nReads the client's row from **Airtable > My Clients** (Keystone Client Finder base). Edit settings there, not here.\nMatches by clientId, then called phone number, then "the only active client with ${service} on". If no client matches, or it is paused/stopped, this fails safely and the Failure Alert fires.`;
  };
}

(async () => {
  console.log(await patch('s2riyS1tZ0jtVuSR', rebuild('invoicing', 'toInvoiceConfig'), 'registry'));
  console.log(await patch('xNwsUFYDgiXVvXPv', rebuild('phone', 'toPhoneConfig'), 'registry'));
})().catch((e) => { console.error(e.message); process.exit(1); });
