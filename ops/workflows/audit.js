'use strict';
// KS Audit Agent (Finance Ops Audit).
//   GET  /webhook/ks-audit-form            questionnaire (add &x=XERO_ORG_ID to include a read-only Xero snapshot)
//   POST /webhook/ks-audit-intake          answers -> halal screen -> Xero snapshot -> 5-pillar diagnosis -> Claude narrative
//   Result: Audit Intakes row with the DRAFT report for Bilal to review; Bilal is notified. The prospect only gets a thank-you.
const n = require('../scripts/n8n');
const L = ['audit', 'auditform', 'pricing', 'reporting', 'requests', 'log', 'agent'];
const BASE = 'https://keystoneconsultancy.app.n8n.cloud/webhook';

const nodes = [
  n.webhook('Audit form page', 'ks-audit-form', { method: 'GET' }),
  n.code('Render audit form', `return [{ json: { statusCode: 200, html: KS.auditform.auditFormPage('${BASE}/ks-audit-intake', ($json.query || {}).x || '') } }];`, { libs: L }),
  n.respond('Return audit form', 'html'),

  n.webhook('Audit intake', 'ks-audit-intake'),
  n.code('Read intake', `
const { audit: Au, requests: R } = KS;
let b = $json.body || {};
if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
const missing = ['businessName', 'contactEmail', 'industry'].filter((k) => !b[k]);
if (missing.length) return [{ json: { route: 3, response: { ok: false, message: 'Please fill in: ' + missing.join(', ') } } }];
const screen = Au.halalScreen(b.industry, b.sells, b.businessName);
const fields = { 'Business name': String(b.businessName).slice(0, 200), 'Status': screen.pass ? 'New intake' : 'Rejected - halal screen', 'Contact name': b.contactName || '', 'Contact email': b.contactEmail,
  'Industry': b.industry, 'What the business sells': b.sells || '', 'Revenue band': b.revenueBand || undefined, 'Staff band': b.staffBand || undefined,
  'Answers JSON': JSON.stringify(b.answers || {}), 'Xero read-only connected': !!b.xeroTenantId, 'Created': new Date().toISOString() };
return [{ json: { intake: b, screen, route: !screen.pass ? 0 : b.xeroTenantId ? 1 : 2, req: R.airtableCreate(AIRTABLE.baseId, AIRTABLE.tables.auditIntakes, [fields]) } }];`, { libs: L }),
  n.route('Valid?', 4),
  n.airtableHttp('Save intake', 'POST'),
  n.code('Which path', `
const x = $('Read intake').first().json;
const rec = (($json.body || {}).records || [])[0];
if (!rec) throw new Error('Audit: could not save intake to Airtable (' + $json.statusCode + ')');
return [{ json: { ...x, recordId: rec.id } }];`),
  n.route('Halal / Xero?', 3),
  // halal rejection: polite reply, Bilal told
  n.code('Rejected reply', `
const x = $json;
return [{ json: { response: { ok: true, message: 'Thank you. Keystone is not able to work with this type of business, so we will not be taking this further.' }, notice: { kind: 'info', audience: 'bilal', text: 'Audit intake from ' + x.intake.businessName + ' was auto-rejected by the halal screen (' + x.screen.hits.join(', ') + '). No report drafted. Check Airtable > Audit Intakes if this looks wrong.' } } }];`),
  // Xero snapshot (read-only)
  n.code('Xero snapshot request', `
const x = $json;
return [{ json: { ...x, req: { method: 'GET', url: 'https://api.xero.com/api.xro/2.0/Invoices?Statuses=AUTHORISED,PAID&where=' + encodeURIComponent('Type=="ACCREC" && Date >= DateTime(' + new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10).replace(/-/g, ',') + ')'), tenantId: x.intake.xeroTenantId } } }];`),
  Object.assign(n.xeroHttp('Xero invoices (read-only)', 'GET'), { onError: 'continueRegularOutput' }),
  n.code('Xero snapshot', `
const { reporting: Rp, requests: R } = KS;
const x = $('Xero snapshot request').first().json;
if (!R.ok($json)) return [{ json: { ...x, req: undefined, xero: null, xeroNote: 'Xero snapshot unavailable (' + $json.statusCode + ')' } }];
const inv = $json.body.Invoices || [];
const rc = Rp.parseReceivables(inv.filter((i) => i.Status === 'AUTHORISED'));
const paid = inv.filter((i) => i.Status === 'PAID' && i.FullyPaidOnDate && i.Date);
const days = paid.map((i) => (Date.parse(Rp.xeroDate(i.FullyPaidOnDate)) - Date.parse(Rp.xeroDate(i.Date))) / 86400000).filter((d) => d >= 0);
const avgDaysToPay = days.length ? Math.round(days.reduce((s, d) => s + d, 0) / days.length) : null;
const avgValue = inv.length ? Math.round(inv.reduce((s, i) => s + (Number(i.Total) || 0), 0) / inv.length) : null;
const perMonth = inv.length ? Math.round(inv.length / 6) : null;
return [{ json: { ...x, req: undefined, xero: { receivables: rc.receivables, overdueCount: rc.overdueCount, overdueValue: rc.overdueValue, avgDaysToPay, avgInvoiceValue: avgValue, invoicesPerMonth: perMonth, sample: inv.length } } }];`, { libs: L }),
  n.code('No Xero', `return [{ json: { ...$json, xero: null } }];`),
  n.code('Diagnose', `
const { audit: Au, agent: A } = KS;
const x = $input.first().json;
const answers = { ...(x.intake.answers || {}) };
if (x.xero) { // real figures beat estimates
  if (x.xero.avgDaysToPay !== null) answers.avg_days_to_pay = x.xero.avgDaysToPay;
  if (x.xero.avgInvoiceValue && !answers.avg_job_value) answers.avg_job_value = x.xero.avgInvoiceValue;
  if (x.xero.invoicesPerMonth && !answers.invoices_per_month) answers.invoices_per_month = x.xero.invoicesPerMonth;
}
const core = Au.runAuditCore({ ...x.intake, answers, xero: x.xero });
const req = A.buildClaudeRequest({ system: Au.AUDIT_SYSTEM, prompt: Au.auditPrompt({ ...x.intake, answers }, core.diagnosis) + (x.xero ? '\\nXero snapshot (last 6 months): ' + JSON.stringify(x.xero) : '\\nNo Xero data; figures are from the questionnaire.'), schema: Au.AUDIT_REPORT_SCHEMA, effort: 'medium', maxTokens: 8000 });
return [{ json: { ...x, answers, core, req: { url: req.url, method: 'POST', body: req.body } } }];`, { libs: L }),
  Object.assign(n.claudeHttp('Audit writer (Claude)'), { onError: 'continueRegularOutput' }),
  n.aiUsageLogger('Log AI usage', 'audit_report', 'KS Audit Agent'),
  n.code('Build report', `
const { audit: Au, agent: A, requests: R } = KS;
const x = $('Diagnose').first().json;
const parsed = R.ok($json) ? A.parseClaudeJson($json.body) : { ok: false, error: 'http_' + $json.statusCode };
const md = Au.buildAuditReportMarkdown(x.intake, x.core.diagnosis, parsed.ok ? parsed.data : null, x.core.proposal)
  + (x.xero ? '\\n\\n_Xero snapshot used: ' + x.xero.sample + ' invoices from the last 6 months._' : '') + (parsed.ok ? '' : '\\n\\n_AI narrative unavailable (' + parsed.error + '); figures above are complete._');
const p = x.core.proposal;
const fee = p.package.name + ' £' + p.package.price + '/month | Setup £' + p.setup.total + (p.setup.discountPct ? ' (' + p.setup.discountPct + '% off)' : '') + (p.senseCheck.ok === false ? ' | CHECK: fee above 1/3 of monthly loss (£' + p.senseCheck.limit + ')' : '');
const update = R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.auditIntakes, [{ id: x.recordId, fields: { 'Status': 'Draft ready for review', 'Report draft': md, 'Findings JSON': JSON.stringify(x.core.diagnosis).slice(0, 90000), 'Xero snapshot JSON': x.xero ? JSON.stringify(x.xero) : '', 'Estimated annual loss': x.core.diagnosis.totalAnnualCost, 'Recommended fee summary': fee } }]);
return [{ json: { req: update, x, fee, aiOk: parsed.ok } }];`, { libs: L }),
  n.airtableHttp('Save report draft', 'PATCH'),
  n.code('Report done', `
const { x, fee, aiOk } = $('Build report').first().json;
if (!KS.requests.ok($json)) throw new Error('Audit: report drafted but could not be saved to Airtable (' + $json.statusCode + ')');
return [{ json: { response: { ok: true, message: 'Thank you, ' + (x.intake.contactName || '') + '. We have your answers and will be in touch within 2 working days to go through your audit.' }, notice: { kind: 'info', audience: 'bilal', text: 'Audit report DRAFT ready for ' + x.intake.businessName + ' (' + (x.intake.industry || '') + '). Estimated annual cost of weaknesses: £' + x.core.diagnosis.totalAnnualCost.toLocaleString('en-GB') + '. ' + fee + '.' + (aiOk ? '' : ' (AI narrative failed; numbers are complete.)') + ' Review it in Airtable > Audit Intakes before presenting.' } } }];`, { libs: L }),
  // Thank the prospect straight away; the report (Claude Opus, ~30s) is written after we have replied.
  n.code('Thank prospect (Xero)', `return [{ json: { ...$json, response: { ok: true, message: 'Thank you, ' + (($json.intake && $json.intake.contactName) || '') + '. We have your answers and will be in touch within 2 working days to go through your audit.' } } }];`),
  n.respond('Reply now (Xero)'),
  n.code('Thank prospect', `return [{ json: { ...$json, response: { ok: true, message: 'Thank you, ' + (($json.intake && $json.intake.contactName) || '') + '. We have your answers and will be in touch within 2 working days to go through your audit.' } } }];`),
  n.respond('Reply now'),
  n.respond('Reply rejected'),
  n.respond('Reply invalid'),
  n.code('Pick notice', `return $input.all().filter((i) => i.json.notice).map((i) => ({ json: i.json.notice }));`),
  n.notify('Tell Bilal'),
];
const tail = n.writesTail();
nodes.push(...tail.nodes);
const edges = [
  ['Audit form page', 'Render audit form'], ['Render audit form', 'Return audit form'],
  ['Audit intake', 'Read intake'], ['Read intake', 'Valid?'], ['Valid?', 'Save intake', 0], ['Valid?', 'Save intake', 1], ['Valid?', 'Save intake', 2], ['Valid?', 'Reply invalid', 3],
  ['Save intake', 'Which path'], ['Which path', 'Halal / Xero?'],
  ['Halal / Xero?', 'Rejected reply', 0], ['Halal / Xero?', 'Thank prospect (Xero)', 1], ['Thank prospect (Xero)', 'Reply now (Xero)'], ['Reply now (Xero)', 'Xero snapshot request'], ['Halal / Xero?', 'Thank prospect', 2], ['Thank prospect', 'Reply now'], ['Reply now', 'No Xero'],
  ['Rejected reply', 'Reply rejected'], ['Reply rejected', 'Pick notice'],
  ['Xero snapshot request', 'Xero invoices (read-only)'], ['Xero invoices (read-only)', 'Xero snapshot'], ['Xero snapshot', 'Diagnose'], ['No Xero', 'Diagnose'],
  ['Diagnose', 'Audit writer (Claude)'], ['Audit writer (Claude)', 'Build report'], ['Build report', 'Save report draft'], ['Save report draft', 'Report done'],
  ['Report done', 'Pick notice'], ['Pick notice', 'Tell Bilal'],
  ['Audit writer (Claude)', 'Log AI usage'], ['Log AI usage', 'Fan out writes'], ...tail.edges,
];
module.exports = n.workflow('KS Audit Agent', nodes, edges, { tags: ['keystone', 'audit'] });
