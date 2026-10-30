// The single list of sectors and agents compiled into Bilal OS.
// To add a sector: create src/agents/<id>/index.ts exporting `sector` and `agents`,
// then add one import line below. Agents inside a sector are listed in that sector's index.
import type { AgentDefinition, SectorDefinition } from "@/lib/agent/types";
import * as pa from "./pa";
import * as uni from "./uni";
import * as workexp from "./workexp";
import * as keystone from "./keystone";
import * as property from "./property";
import * as world from "./world";

const modules: { sector: SectorDefinition; agents: AgentDefinition[] }[] = [pa, uni, workexp, keystone, property, world];

export const SECTORS: SectorDefinition[] = modules.map((m) => m.sector);
export const AGENTS: AgentDefinition[] = modules.flatMap((m) => m.agents);

export function getAgent(id: string): AgentDefinition | undefined {
  return AGENTS.find((a) => a.id === id);
}

export function getSectorDef(id: string): SectorDefinition | undefined {
  return SECTORS.find((s) => s.id === id);
}

// Fail fast on registry mistakes (duplicate ids, unknown sectors).
const seen = new Set<string>();
for (const a of AGENTS) {
  if (seen.has(a.id)) throw new Error(`Duplicate agent id: ${a.id}`);
  seen.add(a.id);
  if (!SECTORS.some((s) => s.id === a.sector)) throw new Error(`Agent ${a.id} has unknown sector ${a.sector}`);
}
