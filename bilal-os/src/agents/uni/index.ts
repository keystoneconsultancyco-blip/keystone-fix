import type { AgentDefinition, SectorDefinition } from "@/lib/agent/types";
import { moodleSync } from "./moodle-sync";
import { timetableSync } from "./timetable-sync";
import { driveOrganiser } from "./drive-organiser";
import { indexer } from "./indexer";
import { moduleGuides } from "./module-guides";

export const sector: SectorDefinition = {
  id: "uni",
  name: "Uni Tutor",
  icon: "🎓",
  description: "Moodle, timetable, deadlines and an organised Google Drive for tutoring in the Claude app.",
  sort: 20,
};

export const agents: AgentDefinition[] = [moodleSync, timetableSync, driveOrganiser, indexer, moduleGuides];
