import type { AgentDefinition, SectorDefinition } from "@/lib/agent/types";

// Empty shell, ready for agents. See docs/ADDING_AN_AGENT.md.
export const sector: SectorDefinition = {
  id: "world",
  name: "World Briefing",
  icon: "🌍",
  description: "Markets, economics and news that matter for finance interviews.",
  sort: 60,
};

export const agents: AgentDefinition[] = [];
