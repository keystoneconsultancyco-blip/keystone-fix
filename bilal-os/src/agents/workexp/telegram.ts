// Telegram buttons and commands for the Work Experience sector.
import { registerCallback, registerCommand } from "../pa/bot";
import { q } from "@/lib/db";
import { esc } from "@/lib/telegram";
import { sendCommand } from "@/lib/commands";
import { fmtDate } from "@/lib/time";

registerCallback("wx:", async (data) => {
  const [idStr, action] = data.split(":");
  const id = Number(idStr);
  if (action === "draft") {
    await q("UPDATE opportunities SET status = 'drafting', updated_at = now() WHERE id = $1", [id]);
    await sendCommand("agent.run", { agentId: "workexp.application-drafter", input: { opportunityId: id }, trigger: "telegram" });
    return "Drafting — I'll send it for approval";
  }
  if (action === "short") {
    await q("UPDATE opportunities SET status = 'shortlisted', updated_at = now() WHERE id = $1", [id]);
    return "Shortlisted ⭐";
  }
  await q("UPDATE opportunities SET status = 'ignored', updated_at = now() WHERE id = $1", [id]);
  return "Ignored";
});

registerCommand("jobs", "Best open work-experience opportunities", async () => {
  const rows = await q<{ id: number; title: string; company: string | null; score: number | null; deadline: Date | null; status: string }>(
    `SELECT id, title, company, score, deadline, status FROM opportunities
     WHERE status IN ('new','shortlisted','draft_ready') AND (deadline IS NULL OR deadline > now()) AND coalesce(score, 50) >= 50
     ORDER BY score DESC NULLS LAST, deadline NULLS LAST LIMIT 10`,
  );
  if (!rows.length) return "No open opportunities right now.";
  return `<b>Top opportunities</b>\n${rows.map((r) => `• ${r.score ?? "?"}/100 ${esc(r.title)}${r.company ? ` — ${esc(r.company)}` : ""}${r.deadline ? ` (closes ${fmtDate(r.deadline)})` : ""}${r.status !== "new" ? ` [${r.status}]` : ""}`).join("\n")}`;
});
