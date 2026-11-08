'use strict';
// CHANGE_LIST #8: [Stock] Monthly Reporting
//  - client list from Airtable My Clients (Active + Reporting on), not the separate clients sheet
//  - each client's own Xero organisation (falls back to the single connection)
//  - value report from the Agent Log: invoices drafted, bookings, quotes, issues fixed, hours saved
//  - collections removed (out of scope); report email can't fail the run; demo reports go to the test inbox
const n = require('../scripts/n8n');
const { H } = require('../scripts/stock');
const AT = require('../config/airtable.json');
const L = ['requests', 'log', 'registry'];

module.exports = async function modify(w) {
  const reg = H.node(w, 'Get Clients Registry');
  reg.parameters = { ...n.http('x', 'airtable', { method: 'GET', sendBody: false }).parameters, url: `=https://api.airtable.com/v0/${AT.baseId}/${AT.tables.clients}?maxRecords=100&filterByFormula=${encodeURIComponent("AND({Status}='Active',{Reporting on})")}` };
  reg.credentials = { airtableTokenApi: { id: '', name: 'Keystone Airtable' } };

  H.node(w, 'Parse Active Clients').parameters.jsCode = `const resp = $input.item.json;
const prior = $('Extract Tenant ID + Reporting Config').item.json;
const recs = (resp.body || resp).records || [];
if (resp.statusCode && resp.statusCode >= 300) throw new Error('Monthly Reporting: could not read Airtable My Clients (' + resp.statusCode + ')');
const list = (s) => String(s || '').split(/[,;\\n]/).map((x) => x.trim()).filter(Boolean);
return recs.map((r) => { const f = r.fields; return { json: {
  clientId: f['Client ID'], clientName: f['Client name'],
  contactEmail: f['Is demo/test'] ? 'khan.bilalbk408@gmail.com' : (list(f['Report recipients'])[0] || f['Contact email'] || ''),
  usesPhoneBooking: !!f['Phone on'], usesInvoiceAutomation: !!f['Invoicing on'], usesCollections: false, usesQuoting: !!f['Quotes on'],
  jobsSheetId: f['Jobs sheet ID'] || '', jobsSheetTabName: f['Jobs sheet tab'] || 'Jobs',
  reportingSheetId: f['Call log sheet ID'] || '', callLogTabName: 'CallLog',
  xeroTenantId: f['Xero organisation ID'] && !/^DEMO-/.test(f['Xero organisation ID']) ? f['Xero organisation ID'] : prior.xeroTenantId,
  driveRootFolderId: prior.driveRootFolderId, reportsFromEmail: f['From email'] || prior.reportsFromEmail,
  monthLabel: prior.monthLabel, reportPeriodStart: prior.reportPeriodStart, reportPeriodEnd: prior.reportPeriodEnd, testMode: false,
} }; }).filter((x) => x.json.clientId);`;

  // value stats from the Agent Log, per client, inserted before the existing stats steps
  const p = H.node(w, 'Parse Active Clients').position;
  H.add(w, n.code('Agent Log query', `
const c = $input.item.json;
const f = 'AND({Client ID} = ' + KS.log.formulaString(c.clientId) + ", IS_AFTER({Timestamp}, '" + c.reportPeriodStart + "T00:00:00Z'), IS_BEFORE({Timestamp}, DATEADD('" + c.reportPeriodEnd + "T00:00:00Z', 1, 'days')))";
return { json: { ...c, req: KS.requests.airtableList(AIRTABLE.baseId, AIRTABLE.tables.agentLog, { formula: f, maxRecords: 100 }) } };`, { libs: L, mode: 'runOnceForEachItem' }), [p[0] + 120, p[1] + 220]);
  H.add(w, Object.assign(n.airtableHttp('Get Agent Log', 'GET'), { onError: 'continueRegularOutput' }), [p[0] + 340, p[1] + 220]);
  H.add(w, n.code('Value stats', `
const c = $('Agent Log query').item.json;
const rows = (($json.body || {}).records || []).map((r) => r.fields);
const out = (r) => (r.Outcome && r.Outcome.name) || r.Outcome;
const ev = (r) => String(r.Event || '');
const v = {
  aiInvoicesDrafted: rows.filter((r) => ev(r).startsWith('invoice_') && out(r) === 'Draft created').length,
  invoicesCaughtForReview: rows.filter((r) => ev(r).startsWith('invoice_') && out(r) === 'Sent to review').length,
  aiCallsHandled: rows.filter((r) => ev(r) === 'call_handled').length,
  aiBookings: rows.filter((r) => ev(r) === 'booking_made' || ev(r) === 'reschedule').length,
  urgentEscalated: rows.filter((r) => ev(r) === 'urgent_escalated').length,
  quotesDrafted: rows.filter((r) => ev(r) === 'quote_drafted').length,
  issuesAutoFixed: rows.filter((r) => out(r) === 'Auto-fixed').length,
  minutesSaved: rows.reduce((s, r) => s + (Number(r['Minutes saved']) || 0), 0),
};
v.hoursSaved = Math.round(v.minutesSaved / 6) / 10;
const { req, ...client } = c;
return { json: { ...client, valueStats: v } };`, { mode: 'runOnceForEachItem' }), [p[0] + 560, p[1] + 220]);
  H.setOut(w, 'Parse Active Clients', 0, ['Agent Log query']);
  H.setOut(w, 'Agent Log query', 0, ['Get Agent Log']);
  H.setOut(w, 'Get Agent Log', 0, ['Value stats']);
  H.setOut(w, 'Value stats', 0, ['Compile Phone/Invoice Sheet Stats']);

  // Sheet stats must not break the report if a sheet is missing; quotes come from the log
  const cs = H.node(w, 'Compile Phone/Invoice Sheet Stats');
  cs.parameters.jsCode = cs.parameters.jsCode
    .replace(/const resp = await this\.helpers\.httpRequestWithAuthentication\.call\(this, 'googleSheetsOAuth2Api', \{/g, "const resp = await this.helpers.httpRequestWithAuthentication.call(this, 'googleSheetsOAuth2Api', {")
    .replace('quotesGiven: 0,', 'quotesGiven: (client.valueStats && client.valueStats.quotesDrafted) || 0,');
  cs.onError = 'continueRegularOutput';

  const fr = H.node(w, 'Format Client Report');
  fr.parameters.jsCode = fr.parameters.jsCode.replace("const bodyIntro =", `const v = c.valueStats || {};
const valueLines = [];
if (v.aiInvoicesDrafted) valueLines.push('- ' + v.aiInvoicesDrafted + ' draft ' + plural(v.aiInvoicesDrafted, 'invoice') + ' prepared in Xero for your approval');
if (v.invoicesCaughtForReview) valueLines.push('- ' + v.invoicesCaughtForReview + ' ' + plural(v.invoicesCaughtForReview, 'job') + ' with messy data caught and checked before invoicing');
if (v.aiCallsHandled) valueLines.push('- ' + v.aiCallsHandled + ' ' + plural(v.aiCallsHandled, 'call') + ' handled by your AI assistant, ' + (v.aiBookings || 0) + ' booked or moved');
if (v.urgentEscalated) valueLines.push('- ' + v.urgentEscalated + ' urgent ' + plural(v.urgentEscalated, 'call') + ' escalated to you straight away');
if (v.quotesDrafted) valueLines.push('- ' + v.quotesDrafted + ' ' + plural(v.quotesDrafted, 'quote') + ' drafted');
if (v.issuesAutoFixed) valueLines.push('- ' + v.issuesAutoFixed + ' ' + plural(v.issuesAutoFixed, 'issue') + ' fixed automatically');
if (valueLines.length) parts.push('\\n\\nWhat Keystone did for you:\\n' + valueLines.join('\\n') + (v.hoursSaved ? '\\n\\nThat is about ' + v.hoursSaved + ' hours of admin time saved (roughly £' + Math.round(v.hoursSaved * 28) + ' at £28/hour).' : ''));
const bodyIntro =`);
  if (!fr.parameters.jsCode.includes('What Keystone did for you')) throw new Error('report format not rewritten');
  H.node(w, 'Send Report Email (Resend)').onError = 'continueRegularOutput';
};
