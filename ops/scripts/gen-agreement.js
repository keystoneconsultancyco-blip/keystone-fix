'use strict';
// Copies docs/CLIENT_AGREEMENT.md into lib/agreementdoc.js so n8n Code nodes can render it (Won -> agreement PDF).
// Run after editing the agreement:  node scripts/gen-agreement.js
const fs = require('fs');
const path = require('path');
const md = fs.readFileSync(path.join(__dirname, '../../docs/CLIENT_AGREEMENT.md'), 'utf8');
fs.writeFileSync(path.join(__dirname, '../lib/agreementdoc.js'), "'use strict';\n// GENERATED from docs/CLIENT_AGREEMENT.md by scripts/gen-agreement.js. Do not edit here.\nmodule.exports = { MD: " + JSON.stringify(md) + ' };\n');
console.log('lib/agreementdoc.js written (' + md.length + ' chars)');
