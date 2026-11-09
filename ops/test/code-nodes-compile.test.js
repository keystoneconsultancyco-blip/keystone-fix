'use strict';
// Every Code node in every generated workflow must compile (catches template-string escaping mistakes).
const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const { build } = require('../scripts/build-workflows');

test('all Code nodes compile', () => {
  const { workflows } = build({ write: false });
  const bad = [];
  for (const wf of Object.values(workflows)) {
    for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.code')) {
      try { new vm.Script(`(async () => {\n${n.parameters.jsCode}\n})`, { filename: `${wf.name} / ${n.name}` }); }
      catch (e) { bad.push(`${wf.name} / ${n.name}: ${e.message}`); }
    }
  }
  assert.deepStrictEqual(bad, []);
});
