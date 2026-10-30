import { q } from "../db";
import { AGENTS, SECTORS } from "@/agents";
import type { AgentDefinition } from "./types";

export async function resolveSchedule(a: AgentDefinition): Promise<string | null> {
  if (!a.schedule) return null;
  return typeof a.schedule === "string" ? a.schedule : a.schedule();
}

/** Make the database match the code: new agents appear on the dashboard automatically. */
export async function syncRegistry(): Promise<void> {
  for (const s of SECTORS) {
    await q(
      `INSERT INTO sectors (id, name, icon, description, builtin, sort) VALUES ($1,$2,$3,$4,true,$5)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, icon = EXCLUDED.icon, description = EXCLUDED.description, builtin = true, sort = EXCLUDED.sort`,
      [s.id, s.name, s.icon, s.description, s.sort ?? 100],
    );
  }
  const ids: string[] = [];
  for (const a of AGENTS) {
    ids.push(a.id);
    await q(
      `INSERT INTO agents (id, sector_id, name, description, enabled, schedule, essential, registered)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true)
       ON CONFLICT (id) DO UPDATE SET sector_id = EXCLUDED.sector_id, name = EXCLUDED.name, description = EXCLUDED.description,
         schedule = EXCLUDED.schedule, essential = EXCLUDED.essential, registered = true, updated_at = now()`,
      [a.id, a.sector, a.name, a.description, a.defaultEnabled ?? true, await resolveSchedule(a), a.essential ?? false],
    );
  }
  await q("UPDATE agents SET registered = false, next_run_at = NULL WHERE NOT (id = ANY($1::text[]))", [ids]);
}
