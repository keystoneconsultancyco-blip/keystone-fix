import { q, one } from "../db";
import { buildContext, isSoftLlmError } from "./context";
import { recordFailure, recordSuccess, raiseAlert } from "../alerts";
import { logActivity } from "../activity";
import { costStatus } from "../cost";
import type { AgentDefinition } from "./types";
import type { Approval } from "../approvals";

export interface RunOptions {
  trigger: string;
  input?: Record<string, unknown>;
  /** Attempt number from the queue (0 = first try). */
  attempt?: number;
  maxAttempts?: number;
}

/**
 * Runs one agent once, with logging, run records, budget checks and alert-once
 * failure tracking. Throws on failure so the queue can retry with backoff.
 */
export async function runAgent(agent: AgentDefinition, opts: RunOptions): Promise<void> {
  const row = await one<{ enabled: boolean }>("SELECT enabled FROM agents WHERE id = $1", [agent.id]);
  const manual = opts.trigger === "manual";
  if (!row?.enabled && !manual) return; // switched off on the dashboard

  if (agent.permissions.includes("llm") && !agent.essential && (await costStatus()).paused) {
    await finishSkipped(agent, opts.trigger, "Skipped: monthly AI budget reached");
    return;
  }

  const run = await one<{ id: number }>("INSERT INTO agent_runs (agent_id, trigger) VALUES ($1, $2) RETURNING id", [agent.id, opts.trigger]);
  const runId = run!.id;
  await q("UPDATE agents SET last_run_at = now(), last_status = 'running' WHERE id = $1", [agent.id]);
  const ctx = buildContext(agent, runId, opts.trigger, opts.input ?? {});
  try {
    const res = await agent.run(ctx);
    const status = res.skipped ? "skipped" : "success";
    await q("UPDATE agent_runs SET finished_at = now(), status = $2, summary = $3 WHERE id = $1", [runId, status, res.summary]);
    await q("UPDATE agents SET last_status = $2 WHERE id = $1", [agent.id, status]);
    await logActivity({ sectorId: agent.sector, agentId: agent.id, runId, message: res.summary });
    const wasAlerting = await recordSuccess(agent.id);
    if (wasAlerting) await raiseAlert({ sectorId: agent.sector, agentId: agent.id, severity: "info", title: `${agent.name} is working again` });
  } catch (e) {
    const err = e as Error;
    const msg = err?.message ?? String(e);
    if (isSoftLlmError(e)) {
      // Not a bug: no API key yet or budget used up. Don't retry or alert repeatedly.
      await q("UPDATE agent_runs SET finished_at = now(), status = 'skipped', summary = $2 WHERE id = $1", [runId, msg]);
      await q("UPDATE agents SET last_status = 'skipped' WHERE id = $1", [agent.id]);
      await logActivity({ sectorId: agent.sector, agentId: agent.id, runId, level: "warn", message: msg });
      return;
    }
    await q("UPDATE agent_runs SET finished_at = now(), status = 'failed', error = $2 WHERE id = $1", [runId, (err?.stack ?? msg).slice(0, 4000)]);
    await q("UPDATE agents SET last_status = 'failed' WHERE id = $1", [agent.id]);
    await logActivity({ sectorId: agent.sector, agentId: agent.id, runId, level: "error", message: `Run failed: ${msg}` });
    await recordFailure(agent.id, msg, { sectorId: agent.sector, agentId: agent.id, threshold: 3 });
    throw e;
  }
}

async function finishSkipped(agent: AgentDefinition, trigger: string, summary: string) {
  await q("INSERT INTO agent_runs (agent_id, trigger, status, summary, finished_at) VALUES ($1,$2,'skipped',$3, now())", [agent.id, trigger, summary]);
  await q("UPDATE agents SET last_run_at = now(), last_status = 'skipped' WHERE id = $1", [agent.id]);
}

/** Run the agent's onApproval hook after Bilal decides. */
export async function handleApproval(agent: AgentDefinition, approvalId: number): Promise<void> {
  const approval = await one<Approval>("SELECT * FROM approvals WHERE id = $1", [approvalId]);
  if (!approval || !agent.onApproval) return;
  if (approval.status !== "approved" && approval.status !== "rejected") return;
  const run = await one<{ id: number }>("INSERT INTO agent_runs (agent_id, trigger) VALUES ($1, 'approval') RETURNING id", [agent.id]);
  const ctx = buildContext(agent, run!.id, "approval", { approvalId });
  try {
    const out = await agent.onApproval(ctx, approval);
    const summary = out || `Handled ${approval.status} approval #${approval.id}`;
    if (approval.status === "approved") await q("UPDATE approvals SET status = 'done', result = $2 WHERE id = $1", [approval.id, JSON.stringify({ summary })]);
    await q("UPDATE agent_runs SET finished_at = now(), status = 'success', summary = $2 WHERE id = $1", [run!.id, summary]);
    await logActivity({ sectorId: agent.sector, agentId: agent.id, runId: run!.id, message: summary });
  } catch (e) {
    const msg = (e as Error).message;
    await q("UPDATE approvals SET status = 'failed', result = $2 WHERE id = $1", [approval.id, JSON.stringify({ error: msg })]);
    await q("UPDATE agent_runs SET finished_at = now(), status = 'failed', error = $2 WHERE id = $1", [run!.id, msg]);
    await raiseAlert({ sectorId: agent.sector, agentId: agent.id, severity: "important", title: `Approved action failed: ${approval.title}`, body: msg });
  }
}
