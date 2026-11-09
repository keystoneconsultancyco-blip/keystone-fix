'use strict';
// Change 4: Sheet Poller loops every Active client with invoicing on and a jobs sheet; emails on row errors.
const n = require('../scripts/n8n');
const { H } = require('../scripts/stock');
const L = ['registry', 'requests', 'log'];

module.exports = async function modify(w) {
  const cfg = H.node(w, 'Get Client Config');
  cfg.parameters.mode = 'each'; // one Client Config lookup per client
  const p = cfg.position;
  H.add(w, n.code('List invoicing clients', `
return [{ json: { req: KS.requests.airtableList(AIRTABLE.baseId, AIRTABLE.tables.clients, { formula: "AND({Status}='Active', {Invoicing on}, {Jobs sheet ID} != '')", maxRecords: 100 }) } }];`, { libs: L }), [p[0] - 720, p[1] + 200]);
  H.add(w, n.airtableHttp('Get clients (Airtable)', 'GET'), [p[0] - 480, p[1] + 200]);
  H.add(w, n.code('One item per client', `
const r = $input.first().json;
if (!KS.requests.ok(r)) throw new Error('Sheet Poller: could not read client registry (' + r.statusCode + ')');
return (r.body.records || []).map((rec) => ({ json: { clientId: rec.fields['Client ID'] } })).filter((x) => x.json.clientId);`, { libs: L }), [p[0] - 240, p[1] + 200]);
  for (const t of [H.has(w, 'Schedule Trigger (every 5 min)') ? 'Schedule Trigger (every 5 min)' : 'Schedule Trigger (every 30 min, 07:00-20:30)', 'Manual Trigger', 'Poll Trigger (Webhook)']) H.setOut(w, t, 0, ['List invoicing clients']);
  H.setOut(w, 'List invoicing clients', 0, ['Get clients (Airtable)']);
  H.setOut(w, 'Get clients (Airtable)', 0, ['One item per client']);
  H.setOut(w, 'One item per client', 0, ['Get Client Config']);

  // Process rows for every client (configs and sheet responses line up 1:1), and pass clientId to the main workflow.
  const proc = H.node(w, 'Process Complete Rows');
  proc.parameters.mode = 'runOnceForAllItems';
  proc.parameters.jsCode = `const configs = $('Get Client Config').all().map((i) => i.json);
const sheets = $input.all().map((i) => i.json);
const results = [];
for (let ci = 0; ci < sheets.length; ci++) {
  const config = configs[ci];
  const resp = sheets[ci];
  const values = resp.values || [];
  const headers = values[0] || [];
  const rows = values.slice(1).map((row, idx) => {
    const obj = { row_number: idx + 2 };
    headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });
    return obj;
  });
  const completed = rows.filter(r => String(r.status || '').trim() === 'Complete');
  for (const r of completed) {
    let lineItems;
    if (r.lineItems) { try { lineItems = JSON.parse(r.lineItems); } catch (e) { lineItems = r.lineItems; } }
    const payload = {
      clientId: config.clientId,
      jobId: r.jobId, customerId: r.customerId, customerName: r.customerName,
      customerEmail: r.customerEmail || undefined, customerPhone: r.customerPhone || undefined,
      jobDescription: r.jobDescription, jobValue: Number(r.jobValue), paymentMethod: r.paymentMethod || undefined,
      milestoneNumber: r.milestoneNumber || null, milestoneLabel: r.milestoneLabel || null, lineItems,
    };
    let status, invoiceReference, invoiceNumber, errorMessage;
    try {
      const body = await this.helpers.httpRequest({ method: 'POST', url: 'https://keystoneconsultancy.app.n8n.cloud/webhook/invoice/job-completed', body: payload, json: true });
      if (body.status === 'success') { status = 'Invoiced'; invoiceReference = body.invoiceReference || ''; invoiceNumber = body.invoiceNumber || ''; errorMessage = ''; }
      else if (body.status === 'skipped') { status = 'Skipped - Duplicate'; invoiceReference = body.invoiceReference || ''; invoiceNumber = ''; errorMessage = ''; }
      else if (body.status === 'needs_review') { status = 'Needs Review'; invoiceReference = ''; invoiceNumber = ''; errorMessage = body.reason || 'Sent to Keystone Needs Review'; }
      else if (body.status === 'queued') { status = 'Complete'; invoiceReference = ''; invoiceNumber = ''; errorMessage = 'Queued until send window ' + (body.queuedUntil || ''); }
      else if (body.status === 'rejected') { status = 'Error - Rejected'; invoiceReference = ''; invoiceNumber = ''; errorMessage = (body.errors || []).join(', '); }
      else { status = 'Error - Unexpected Response'; invoiceReference = ''; invoiceNumber = ''; errorMessage = JSON.stringify(body).slice(0, 500); }
    } catch (err) {
      status = 'Error - Request Failed'; invoiceReference = ''; invoiceNumber = ''; errorMessage = String((err && err.message) || err).slice(0, 500);
    }
    results.push({ json: { clientId: config.clientId, clientName: config.clientName, jobId: r.jobId, jobsSheetId: config.jobsSheetId,
      updateRange: config.jobsSheetTabName + '!I' + r.row_number + ':M' + r.row_number, status, invoiceReference, invoiceNumber, processedAt: new Date().toISOString(), errorMessage } });
  }
}
return results;`;

  H.node(w, 'Build Poll Summary').parameters.jsCode = `const processed = $('Process Complete Rows').all().map(i => i.json).filter(r => r.updateRange);
const errors = processed.filter(r => /^Error|^Needs Review/.test(r.status));
return [{ json: { rowsProcessed: processed.length, results: processed, errors, hasErrors: errors.length > 0 } }];`;
  const s = H.node(w, 'Build Poll Summary').position;
  H.add(w, n.iff('Any row errors?', 'hasErrors'), [s[0] + 240, s[1]]);
  H.add(w, n.code('Build error email', `
const { requests: R, log: Lg } = KS;
const e = $json.errors;
const text = 'The Sheet Poller could not invoice ' + e.length + ' job(s). The rows are marked in the jobs sheet and nothing was sent to customers.\\n\\n' + e.map((x) => '- ' + x.clientName + ' (' + x.clientId + ') job ' + x.jobId + ': ' + x.status + ' ' + x.errorMessage).join('\\n');
return [{ json: { req: R.email({ to: [Lg.OPS_EMAIL], subject: '[Keystone] ' + e.length + ' job(s) need attention in the jobs sheet', text }) } }];`, { libs: L }), [s[0] + 480, s[1]]);
  H.add(w, Object.assign(n.resendHttp('Email Bilal'), { onError: 'continueRegularOutput' }), [s[0] + 720, s[1]]);
  H.setOut(w, 'Build Poll Summary', 0, ['Any row errors?']);
  H.setOut(w, 'Any row errors?', 0, ['Build error email']);
  H.setOut(w, 'Build error email', 0, ['Email Bilal']);
  const note = H.node(w, 'Sticky Note');
  note.parameters.content = '## Sheet Poller (Keystone)\nEvery 5 minutes: reads Airtable My Clients for every Active client with Invoicing on and a Jobs sheet ID, reads each client\'s Jobs tab, and sends rows with status = "Complete" (with the clientId) to the main Invoice Automation webhook. Rows that error or need review are written back to the sheet AND emailed to Bilal.';
};
