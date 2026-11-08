'use strict';
// node changes/run.js <workflowId> <changeModule> <label>
const { patch } = require('../scripts/stock');
const [id, mod, label] = process.argv.slice(2);
patch(id, require('./' + mod), label).then((r) => console.log(JSON.stringify(r))).catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
