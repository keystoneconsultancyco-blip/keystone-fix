import type { AgentDefinition, SectorDefinition } from "@/lib/agent/types";

// Empty shell, ready for agents. See docs/ADDING_AN_AGENT.md.
export const sector: SectorDefinition = {
  id: "keystone",
  name: "Keystone",
  icon: "🏛️",
  description: "Finance-ops consultancy: leads, clients and delivery.",
  sort: 40,
};

export const agents: AgentDefinition[] = [];
