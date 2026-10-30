import type { AgentDefinition, SectorDefinition } from "@/lib/agent/types";
import { opportunityFinder } from "./finder";
import { opportunityScorer } from "./scorer";
import { applicationDrafter } from "./applications";
import { one } from "@/lib/db";

export const sector: SectorDefinition = {
  id: "workexp",
  name: "Work Experience",
  icon: "💼",
  description: "Spring weeks, insight days and applications in finance.",
  sort: 30,
  async kpis() {
    const r = await one<{ n: number }>("SELECT count(*)::int AS n FROM deadlines WHERE sector_id = 'workexp' AND NOT done AND due_at > now() AND due_at < now() + interval '14 days'");
    return [{ label: "Application deadlines (14 days)", value: r?.n ?? 0, tone: (r?.n ?? 0) > 0 ? "warn" : "neutral" }];
  },
};

export const agents: AgentDefinition[] = [opportunityFinder, opportunityScorer, applicationDrafter];
