import { q, one } from "./db";
import { sendTelegram, esc } from "./telegram";
import { env } from "./env";
import { sendCommand } from "./commands";

export interface Approval {
  id: number; created_at: Date; sector_id: string; agent_id: string; kind: string; title: string;
  summary: string | null; payload: any; status: string; decided_at: Date | null; decision_note: string | null; result: any;
}

/** Ask Bilal to approve something. Shows on the dashboard and pings Telegram with Approve/Reject buttons. */
export async function requestApproval(a: {
  sectorId: string; agentId: string; kind: string; title: string; summary?: string; payload?: unknown; notify?: boolean;
}): Promise<number> {
  const row = await one<{ id: number }>(
    `INSERT INTO approvals (sector_id, agent_id, kind, title, summary, payload) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [a.sectorId, a.agentId, a.kind, a.title, a.summary ?? null, JSON.stringify(a.payload ?? {})],
  );
  const id = row!.id;
  if (a.notify !== false) {
    await sendTelegram(
      `🟡 <b>Approval needed</b>\n${esc(a.title)}${a.summary ? `\n\n${esc(a.summary.slice(0, 1500))}` : ""}`,
      { buttons: [[{ text: "✅ Approve", data: `appr:${id}:approve` }, { text: "❌ Reject", data: `appr:${id}:reject` }], [{ text: "Open dashboard", url: `${env.appUrl}/approvals` }]] },
    ).catch(() => false);
  }
  return id;
}

/** Record a decision. The worker picks up the 'approval.decided' command and runs the agent's onApproval hook. */
export async function decideApproval(id: number, decision: "approve" | "reject", note?: string): Promise<Approval | null> {
  const row = await one<Approval>(
    `UPDATE approvals SET status = $2, decided_at = now(), decision_note = $3 WHERE id = $1 AND status = 'pending' RETURNING *`,
    [id, decision === "approve" ? "approved" : "rejected", note ?? null],
  );
  if (row) await sendCommand("approval.decided", { id });
  return row;
}

export async function pendingApprovals(sectorId?: string): Promise<Approval[]> {
  return q<Approval>(
    `SELECT * FROM approvals WHERE status = 'pending' ${sectorId ? "AND sector_id = $1" : ""} ORDER BY created_at DESC LIMIT 100`,
    sectorId ? [sectorId] : [],
  );
}
