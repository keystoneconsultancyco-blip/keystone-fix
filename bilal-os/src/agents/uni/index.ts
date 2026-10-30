import type { AgentDefinition, SectorDefinition } from "@/lib/agent/types";

export const sector: SectorDefinition = {
  id: "uni",
  name: "Uni Tutor",
  icon: "🎓",
  description: "Moodle, timetable, deadlines and an organised Google Drive for tutoring in the Claude app.",
  sort: 20,
};

export const agents: AgentDefinition[] = [];
