'use strict';
// KS Nurture Tracking: opens and clicks for Nurture emails, written to Airtable (no outside tracking service).
//  GET /webhook/ks-nurture-open?s=<Send ID>&t=<template record id>  -> 1x1 GIF; Nurture Sends: Opens +1 (First opened);
//      first open of a real (not Test) email adds 1 to the template's Opened.
//  GET /webhook/ks-nurture-click?s=&t=  -> a page that forwards to Keystone Settings > audit_booking_url (or, until that is set,
//      an email to Bilal titled "Book my Finance Ops Audit"); Clicks +1 (First clicked); first click adds 1 to Clicked.
// The Send ID is random (24 characters) and must match the template id stored on the send, so guessed links count nothing.
const n = require('../scripts/n8n');
const L = ['requests', 'log', 'opsmanager'];
const GIF = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function plan(name, withSettings) {
  return n.code(name, `
const { requests: R, log: Lg } = KS;
const q = $input.first().json.query || {};
const s = /^[a-z0-9]{24}$/.test(String(q.s || '')) ? String(q.s) : '';
const t = /^rec[A-Za-z0-9]{14}$/.test(String(q.t || '')) ? String(q.t) : '';
const reads = [
  ['send', R.airtableList(AIRTABLE.baseId, AIRTABLE.tables.nurtureSends, { formula: s ? '{Send ID} = ' + Lg.formulaString(s) : 'FALSE()', maxRecords: 1 })],
  ['tpl', R.airtableList(AIRTABLE.baseId, AIRTABLE.tables.nurtureTemplates, { formula: t ? 'RECORD_ID() = ' + Lg.formulaString(t) : 'FALSE()', fields: ['Name', 'Opened', 'Clicked'], maxRecords: 1 })],
];
${withSettings ? "reads.push(['settings', R.airtableList(AIRTABLE.baseId, AIRTABLE.tables.settings, { maxRecords: 100 })]);" : ''}
return reads.map(([key, req]) => ({ json: { key, s, t, req } }));`, { libs: L });
}

// kind: 'open' | 'click'
function apply(name, readsNode, kind) {
  const [count, first, total] = kind === 'open' ? ['Opens', 'First opened', 'Opened'] : ['Clicks', 'First clicked', 'Clicked'];
  return n.code(name, `
const { requests: R, opsmanager: O } = KS;
const plan = $('${readsNode}').all();
const got = {};
$input.all().forEach((it, i) => { got[plan[i].json.key] = (((it.json || {}).body || {}).records) || []; });
const t = plan[0].json.t;
const send = got.send[0];
const tpl = got.tpl[0];
const writes = [];
if (send && t && send.fields['Template ID'] === t) {
  const f = send.fields;
  const firstTime = !f['${first}'];
  writes.push(R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.nurtureSends, [{ id: send.id, fields: { '${count}': (Number(f['${count}']) || 0) + 1, ...(firstTime ? { '${first}': new Date().toISOString() } : {}) } }])));
  if (firstTime && !f.Test && tpl) writes.push(R.write.airtable(R.airtableUpdate(AIRTABLE.baseId, AIRTABLE.tables.nurtureTemplates, [{ id: tpl.id, fields: { '${total}': (Number(tpl.fields['${total}']) || 0) + 1 } }])));
}
${kind === 'open'
    ? `return [{ json: { writes }, binary: { data: { data: '${GIF}', mimeType: 'image/gif', fileName: 'p.gif', fileExtension: 'gif' } } }];`
    : `const S = O.settingsMap((got.settings || []));
const company = send ? send.fields.Company || '' : '';
const to = String(S.alert_email || 'keystoneconsultancy.co@gmail.com').split(',')[0].trim();
const url = /^https:\\/\\//.test(String(S.audit_booking_url || '')) ? S.audit_booking_url
  : 'mailto:' + to + '?subject=' + encodeURIComponent('Book my Finance Ops Audit' + (company ? ' - ' + company : '')) + '&body=' + encodeURIComponent('Hi Bilal, I would like to book my Finance Ops Audit. Some times that suit me: ');
const safe = url.split('&').join('&amp;').split('"').join('&quot;');
const html = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=' + safe + '"><title>Book my audit</title>'
  + '<div style="font-family:Arial,sans-serif;max-width:520px;margin:60px auto;padding:20px"><h2>Keystone</h2><p style="font-size:17px">Taking you to book your Finance Ops Audit…</p>'
  + '<p><a href="' + safe + '" style="display:inline-block;background:#C9A961;color:#0B0D0F;padding:13px 22px;text-decoration:none;font-weight:bold;border-radius:4px">Book my audit</a></p>'
  + '<p style="font-size:13px;color:#555">If nothing happens, tap the button, or email ' + to + '.</p></div>';
return [{ json: { writes, url, html } }];`}`, { libs: L });
}

const pixelRespond = Object.assign(n.respond('Open: send pixel'), { parameters: { respondWith: 'binary', responseDataSource: 'automatically', options: { responseHeaders: { entries: [{ name: 'Cache-Control', value: 'no-store, max-age=0' }] } } } });
// A small page (not an HTTP redirect): n8n's redirect mangles mailto: links. It forwards straight on.
const clickRespond = Object.assign(n.respond('Click: redirect', 'html'), {});

const nodes = [
  n.webhook('Open', 'ks-nurture-open', { method: 'GET' }),
  plan('Open: reads', false),
  Object.assign(n.airtableHttp('Open: read Airtable', 'GET'), { onError: 'continueRegularOutput' }),
  apply('Open: count', 'Open: reads', 'open'),
  pixelRespond,
  n.webhook('Click', 'ks-nurture-click', { method: 'GET' }),
  plan('Click: reads', true),
  Object.assign(n.airtableHttp('Click: read Airtable', 'GET'), { onError: 'continueRegularOutput' }),
  apply('Click: count', 'Click: reads', 'click'),
  clickRespond,
];
const tail = n.writesTail();
nodes.push(...tail.nodes);
const edges = [
  ['Open', 'Open: reads'], ['Open: reads', 'Open: read Airtable'], ['Open: read Airtable', 'Open: count'], ['Open: count', 'Open: send pixel'], ['Open: send pixel', 'Fan out writes'],
  ['Click', 'Click: reads'], ['Click: reads', 'Click: read Airtable'], ['Click: read Airtable', 'Click: count'], ['Click: count', 'Click: redirect'], ['Click: redirect', 'Fan out writes'],
  ...tail.edges,
];
module.exports = n.workflow('KS Nurture Tracking', nodes, edges, { tags: ['keystone', 'nurture'] });
