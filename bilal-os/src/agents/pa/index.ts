import type { AgentDefinition, SectorDefinition } from "@/lib/agent/types";

export const sector: SectorDefinition = {
  id: "pa",
  name: "Personal Assistant",
  icon: "🧭",
  description: "Your hub: timetable, tasks, reminders, briefings and Telegram.",
  sort: 10,
};

export const agents: AgentDefinition[] = [];
