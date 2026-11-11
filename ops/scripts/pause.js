'use strict';
// Full-pause guard. While Keystone Settings > system_status = PAUSED, no script may switch a workflow on.
// GREEN_LIGHT.md sets KS_GREEN_LIGHT=1 for the reactivation steps (after Bilal says "GREEN LIGHT").
const { airtableToken } = require('./secrets');
const AT = require('../config/airtable.json');

async function systemStatus() {
  const r = await fetch(`https://api.airtable.com/v0/${AT.baseId}/${AT.tables.settings}?filterByFormula=${encodeURIComponent("{Setting}='system_status'")}`, { headers: { Authorization: 'Bearer ' + airtableToken() } });
  if (!r.ok) throw new Error('Pause guard: could not read system_status from Airtable (' + r.status + '); refusing to activate anything.');
  const j = await r.json();
  return String(((j.records || [])[0] || { fields: {} }).fields.Value || 'LIVE').trim().toUpperCase();
}

// true = activation allowed.
async function mayActivate() {
  if (process.env.KS_GREEN_LIGHT === '1') return true;
  return (await systemStatus()) !== 'PAUSED';
}

module.exports = { systemStatus, mayActivate };
