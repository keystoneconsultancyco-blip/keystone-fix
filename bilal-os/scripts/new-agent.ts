// Scaffold a new agent and register it in its sector.
//   npm run new-agent -- <sector-id> <agent-slug> "<Agent name>"
//   npm run new-agent -- keystone lead-finder "Lead finder"
// If the sector folder doesn't exist yet (e.g. one created from the dashboard),
// it is created and added to src/agents/index.ts too.
import fs from "node:fs";
import path from "node:path";

const [sector, slug, ...nameParts] = process.argv.slice(2);
const name = nameParts.join(" ");
if (!sector || !slug || !name || !/^[a-z0-9-]+$/.test(sector) || !/^[a-z0-9-]+$/.test(slug)) {
  console.error('Usage: npm run new-agent -- <sector-id> <agent-slug> "<Agent name>"   (ids: lowercase, digits, dashes)');
  process.exit(1);
}
const root = path.resolve(import.meta.dirname, "..");
const dir = path.join(root, "src/agents", sector);
const camel = slug.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const file = path.join(dir, `${slug}.ts`);
if (fs.existsSync(file)) { console.error(`${file} already exists`); process.exit(1); }

if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
  const title = sector.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  fs.writeFileSync(path.join(dir, "index.ts"), `import type { AgentDefinition, SectorDefinition } from "@/lib/agent/types";

export const sector: SectorDefinition = {
  id: "${sector}",
  name: "${title}",
  icon: "◆",
  description: "TODO: one line about this sector.",
  sort: 100,
};

export const agents: AgentDefinition[] = [];
`);
  const reg = path.join(root, "src/agents/index.ts");
  let s = fs.readFileSync(reg, "utf8");
  const ident = sector.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
  s = s.replace(/(import \* as world from "\.\/world";\n)/, `$1import * as ${ident} from "./${sector}";\n`);
  s = s.replace(/(\[pa, uni, workexp, keystone, property, world)([^\]]*)\]/, `$1$2, ${ident}]`);
  fs.writeFileSync(reg, s);
  console.log(`Created sector ${sector} and registered it in src/agents/index.ts`);
}

fs.writeFileSync(file, `import type { AgentDefinition } from "@/lib/agent/types";
import { q } from "@/lib/db";

/**
 * ${name}: TODO describe what this agent does, in one or two sentences.
 * See docs/ADDING_AN_AGENT.md for the full checklist.
 */
export const ${camel}: AgentDefinition = {
  id: "${sector}.${slug}",
  sector: "${sector}",
  name: "${name}",
  description: "TODO: one plain-English line shown on the dashboard.",
  schedule: "0 9 * * 1-5", // UK time. Remove for on-demand only.
  permissions: ["llm", "telegram"], // only what it really needs
  approvals: [], // e.g. [{ kind: "send_email", description: "sending any email" }]
  settings: [], // e.g. [{ key: "maxItems", label: "Max items per run", type: "number", default: 10 }]

  async run(ctx) {
    await ctx.log("Starting");
    // 1. Gather data (ctx.browser, fetch, ctx.calendar(), ctx.drive(), q(...)).
    // 2. Think (ctx.llm({ tier: "fast", ... }) — check ctx.llmAvailable() first if AI is optional).
    // 3. Act or ask: ctx.alert(...), ctx.telegram(...), ctx.requestApproval(...).
    return { summary: "Nothing to do yet", skipped: true };
  },

  // Called after Bilal approves/rejects one of this agent's approvals.
  // async onApproval(ctx, approval) { return "done"; },

  async kpis() {
    void q;
    return [];
  },
};
`);

const idx = path.join(dir, "index.ts");
let s = fs.readFileSync(idx, "utf8");
s = s.replace(/(import type \{ AgentDefinition, SectorDefinition \} from "@\/lib\/agent\/types";\n)/, `$1import { ${camel} } from "./${slug}";\n`);
s = s.replace(/export const agents: AgentDefinition\[\] = \[([^\]]*)\];/, (_, inner) => `export const agents: AgentDefinition[] = [${inner.trim() ? `${inner.trim()}, ` : ""}${camel}];`);
fs.writeFileSync(idx, s);
console.log(`Created src/agents/${sector}/${slug}.ts and registered it in src/agents/${sector}/index.ts`);
console.log("Next: fill in run(), then `npm run typecheck` and `npm test`. It appears on the dashboard after the worker restarts.");
