'use strict';
// Generates importable n8n JSON into keystone-fix/n8n/workflows/ from ops/workflows/*.js.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'workflows');
const OUT = path.join(__dirname, '..', '..', 'n8n', 'workflows');

function slug(name) { return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

function load(file) {
  const p = path.join(SRC, file);
  delete require.cache[require.resolve(p)];
  return require(p);
}

function build({ write = true } = {}) {
  const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).sort();
  const manifest = [];
  const out = {};
  for (const f of files) {
    const wf = JSON.parse(JSON.stringify(load(f)));
    const wantsError = wf.__wantsErrorWorkflow;
    delete wf.__wantsErrorWorkflow;
    const fileName = slug(wf.name) + '.json';
    out[wf.name] = wf;
    manifest.push({ name: wf.name, file: `n8n/workflows/${fileName}`, nodes: wf.nodes.length, attachErrorWorkflow: !!wantsError,
      webhooks: wf.nodes.filter((x) => x.type === 'n8n-nodes-base.webhook').map((x) => ({ node: x.name, method: x.parameters.httpMethod, path: x.parameters.path })),
      credentials: [...new Set(wf.nodes.flatMap((x) => Object.values(x.credentials || {}).map((c) => c.name)))] });
    if (write) {
      fs.mkdirSync(OUT, { recursive: true });
      fs.writeFileSync(path.join(OUT, fileName), JSON.stringify(wf, null, 2) + '\n');
    }
  }
  if (write) fs.writeFileSync(path.join(OUT, '..', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { workflows: out, manifest };
}

if (require.main === module) {
  const { manifest } = build();
  for (const m of manifest) console.log(`${m.file}  (${m.nodes} nodes)`);
}

module.exports = { build, slug };
