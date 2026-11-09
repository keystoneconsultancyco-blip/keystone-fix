'use strict';
// KS Agent - Lead Researcher (replaces the old "Keystone client finder" Claude task; same Prospects table and Agent Settings rules).
// Stage 1 (daily 20:35): Claude Haiku + web search researches new UK SMEs -> stage 2 (calls itself) checks each
// against Prospects (no duplicates) and the halal screen, then saves them, logs Daily Progress, and wakes Outreach.
const { makeAgent, BASE } = require('../scripts/agentkit');

module.exports = makeAgent({
  name: 'KS Agent - Lead Researcher',
  slug: 'lead-researcher',
  crons: [{ label: 'Daily 20:35', cron: '35 20 * * *' }],
  libs: ['agentprompts', 'audit'],
  nothingToDo: 'No new candidates to save.',
  reads: `
if (input.stage === 'save') {
  const doms = (input.candidates || []).map((c) => c.dedup).filter(Boolean);
  const f = doms.length ? 'OR(' + doms.map((d) => '{Dedup ID} = ' + Lg.formulaString(d)).join(',') + ')' : "{Dedup ID} = 'none'";
  return [['existing', list('prospects', { formula: f, fields: ['Dedup ID', 'Company'], maxRecords: 100 })], ['agentSettings', list('agentSettings', { maxRecords: 50 })],
          ['highTotal', list('prospects', { formula: "{Potential} = 'High potential'", fields: ['Company'], maxRecords: 100 })]];
}
return [['agentSettings', list('agentSettings', { maxRecords: 50 })], ['recent', list('prospects', { fields: ['Company'], maxRecords: 100, sort: [{ field: 'Found on', direction: 'desc' }] })]];`,
  plan: `
const P = KS.agentprompts;
if (input.stage === 'save') {
  // No AI here: dedupe + halal screen + save.
  const dom = (u) => String(u || '').trim().toLowerCase().replace('https://', '').replace('http://', '').replace('www.', '').split('/')[0].split('?')[0].split('#')[0];
  const skipRow = D.agentSettings.find((r) => /halal skip list/i.test(r.fields.Setting || ''));
  return [{ ctx: { stage: 'save', candidates: input.candidates || [], report: input.report || '', test: !!input.test,
    have: D.existing.map((r) => String(r.fields['Dedup ID'] || '').toLowerCase()),
    skipDomains: String(skipRow ? skipRow.fields.Value : '').split(/\s+/).map(dom).filter((x) => x.includes('.')),
    highTotal: D.highTotal.length } }];
}
const req = A.buildClaudeRequest({ task: 'lead_research', system: P.LEAD_SYSTEM, prompt: P.leadPrompt({ agentSettings: D.agentSettings, recentCompanies: D.recent.map((r) => r.fields.Company), count: Number(input.count) || 8, focus: input.focus }), schema: P.LEAD_SCHEMA, effort: 'medium', maxTokens: 16000,
  tools: [A.webSearchTool(AI.modelFor('lead_research'), Number(input.maxSearches) || 10)] });
return [{ task: 'lead_research', req, ctx: { stage: 'research', test: !!input.test } }];`,
  handle: `
const dom = (u) => String(u || '').trim().toLowerCase().replace('https://', '').replace('http://', '').replace('www.', '').split('/')[0].split('?')[0].split('#')[0];
if (ctx.stage === 'research') {
  if (!parsed.ok) return { error: 'research failed: ' + parsed.error + (parsed.detail ? ' ' + String(parsed.detail).slice(0, 200) : '') };
  const cands = (parsed.data.prospects || []).map((p) => ({ ...p, dedup: dom(p.website) })).filter((p) => p.company && p.dedup);
  // Hand over to stage 2 (dedupe + save) by calling ourselves with the agent token.
  return { writes: [R.write.webhook('${BASE}/ks-agent-lead-researcher', { stage: 'save', candidates: cands, report: parsed.data.report, growthIdea: parsed.data.growth_idea, test: !!ctx.test, token: '__TOKEN__' })], summary: 'Researched ' + cands.length + ' candidates', log: [{ kind: 'Run', summary: 'Researched ' + cands.length + ' candidates; saving next.' }] };
}
// ---- save ----
const have = new Set(ctx.have || []);
const skipDomains = new Set(ctx.skipDomains || []);
const today = new Date().toISOString().slice(0, 10);
const recs = [], skipped = [];
for (const c of ctx.candidates || []) {
  if (have.has(c.dedup)) { skipped.push(c.company + ' (already in Prospects)'); continue; }
  if (skipDomains.has(c.dedup)) { skipped.push(c.company + ' (halal skip list)'); continue; }
  const screen = KS.audit.halalScreen(c.industry, c.what_they_do, c.company);
  const potential = !screen.pass ? 'Rejected' : c.potential;
  have.add(c.dedup);
  const high = potential === 'High potential';
  recs.push({ 'Company': c.company, 'Website': c.website, 'Dedup ID': c.dedup, 'Industry': c.industry, 'Location': c.location, 'Potential': potential, 'Status': 'New - review',
    'Fit score': Math.max(1, Math.min(5, Number(c.fit_score) || 1)), 'Found on': today,
    ...(high ? { 'Price band': c.price_band === 'Unknown' ? undefined : c.price_band, 'Why this price band': c.why_price_band, 'Employees': Number(String(c.employees).replace(/[^0-9.]/g, '')) || undefined, 'Est. annual revenue': c.est_annual_revenue, 'Size evidence': c.size_evidence,
      'Decision-maker': c.decision_maker, 'Email': /@/.test(c.email || '') ? c.email : undefined, 'Phone': c.phone && !/unknown/i.test(c.phone) ? c.phone : undefined, 'Best outreach': c.best_outreach,
      'What they do': c.what_they_do, 'Weak points found': c.weak_points, 'How Keystone fixes it': c.how_keystone_fixes_it, 'Starting service': c.starting_service, 'Est. value to them': c.est_value_to_them,
      'Next step': c.best_outreach === 'Call' ? 'Bilal: call ' + (c.decision_maker || 'the owner') + (c.phone ? ' on ' + c.phone : '') : 'Outreach agent drafts the email' } : { 'What they do': c.what_they_do }),
    'Sources': (c.sources || []).map((s, i) => (i + 1) + '. ' + s).join('\\n'),
    'Your notes': (!screen.pass ? 'Halal screen: ' + screen.hits.join(', ') + '. ' : '') + (ctx.test ? '[TEST] ' : '') + (c.reason || '') });
}
const W = [];
for (let i = 0; i < recs.length; i += 10) W.push(R.write.airtable(R.airtableCreate(AIRTABLE.baseId, AIRTABLE.tables.prospects, recs.slice(i, i + 10))));
const highs = recs.filter((r) => r.Potential === 'High potential');
if (!ctx.test) W.push(R.write.airtable(R.airtableCreate(AIRTABLE.baseId, AIRTABLE.tables.dailyProgress, [{ 'Date': today, 'Companies screened': (ctx.candidates || []).length, 'High potential added': highs.length, 'Rejected': recs.filter((r) => ['Low', 'Rejected'].includes(r.Potential)).length, 'Total high potential': (ctx.highTotal || 0) + highs.length, 'Growth ideas added': 0, 'Report': (ctx.report || '') + (skipped.length ? '\\nSkipped: ' + skipped.join('; ') : '') }])));
if (highs.length) W.push(R.write.webhook('${BASE}/ks-agent-outreach', { token: '__TOKEN__' }));
return { writes: W, done: highs.length, summary: 'Saved ' + recs.length + ' prospects (' + highs.length + ' high potential)' + (skipped.length ? ', skipped ' + skipped.length : ''),
  log: highs.map((h) => ({ kind: 'Completed', summary: 'High potential: ' + h.Company + ' (' + (h.Location || '') + ')', items: 0, ref: h['Dedup ID'] })) };`,
});
