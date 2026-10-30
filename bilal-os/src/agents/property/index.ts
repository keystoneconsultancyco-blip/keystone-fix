import type { AgentDefinition, SectorDefinition } from "@/lib/agent/types";

// Empty shell, ready for agents. See docs/ADDING_AN_AGENT.md.
export const sector: SectorDefinition = {
  id: "property",
  name: "Property Sourcing",
  icon: "🏠",
  description: "Deal sourcing, investor pipeline and comparables.",
  sort: 50,
};

export const agents: AgentDefinition[] = [];
