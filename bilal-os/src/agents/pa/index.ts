import type { AgentDefinition, SectorDefinition } from "@/lib/agent/types";
import { calendarSync } from "./calendar-sync";
import { morningBriefing, eveningWrapup } from "./briefings";
import { reminders } from "./reminders";
import { costStatus } from "@/lib/cost";

export const sector: SectorDefinition = {
  id: "pa",
  name: "Personal Assistant",
  icon: "🧭",
  description: "Your hub: timetable, tasks, reminders, briefings and Telegram.",
  sort: 10,
  async kpis() {
    const c = await costStatus();
    return [{ label: "AI spend this month", value: `£${c.spent.toFixed(2)}`, hint: `of £${c.cap.toFixed(2)} cap`, tone: c.paused ? "bad" : c.warning ? "warn" : "good" }];
  },
};

export const agents: AgentDefinition[] = [morningBriefing, eveningWrapup, reminders, calendarSync];
