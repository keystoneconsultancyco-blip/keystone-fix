import { complete, BudgetExceededError, LlmNotConfiguredError } from "../llm";
import { costStatus } from "../cost";
import { sendTelegram } from "../telegram";
import { raiseAlert } from "../alerts";
import { requestApproval } from "../approvals";
import { calendarApi, driveApi } from "../google";
import { withBrowser } from "../browser";
import { getSecret, getSetting } from "../settings";
import { logActivity } from "../activity";
import { q, one } from "../db";
import { sendCommand } from "../commands";
import type { AgentContext, AgentDefinition, Permission } from "./types";

export class PermissionError extends Error {
  constructor(agent: string, perm: string) {
    super(`Agent ${agent} tried to use "${perm}" without declaring it in permissions.`);
    this.name = "PermissionError";
  }
}

export function buildContext(agent: AgentDefinition, runId: number, trigger: string, input: Record<string, unknown> = {}): AgentContext {
  const need = (p: Permission) => {
    if (!agent.permissions.includes(p)) throw new PermissionError(agent.id, p);
  };
  const ctx: AgentContext = {
    agent, runId, trigger, input,
    log: (message, data, level = "info") => logActivity({ sectorId: agent.sector, agentId: agent.id, runId, level, message, data }),
    llm: async (opts) => {
      need("llm");
      return complete({ ...opts, agentId: agent.id, essential: agent.essential });
    },
    llmAvailable: async () => {
      if (!agent.permissions.includes("llm")) return false;
      if (!(await getSecret("anthropic_api_key"))) return false;
      return !(await costStatus()).paused;
    },
    telegram: async (html, opts) => {
      need("telegram");
      return sendTelegram(html, opts);
    },
    alert: (severity, title, body, opts) => raiseAlert({ sectorId: agent.sector, agentId: agent.id, severity, title, body, ...opts }),
    requestApproval: async (kind, title, summary, payload) => {
      if (!agent.approvals?.some((a) => a.kind === kind)) throw new PermissionError(agent.id, `approval:${kind}`);
      return requestApproval({ sectorId: agent.sector, agentId: agent.id, kind, title, summary, payload });
    },
    calendar: async () => { need("calendar"); return calendarApi(); },
    drive: async () => { need("drive"); return driveApi(); },
    browser: async (profile, fn) => { need("browser"); return withBrowser(profile, fn); },
    secret: async (key) => {
      if (key === "moodle_username" || key === "moodle_password") need("secrets:moodle");
      else if (key !== "telegram_chat_id") throw new PermissionError(agent.id, `secret:${key}`);
      return getSecret(key);
    },
    setting: (key) => getSetting(key),
    config: async <T,>(key: string) => {
      const row = await one<{ config: Record<string, unknown> }>("SELECT config FROM agents WHERE id = $1", [agent.id]);
      const def = agent.settings?.find((s) => s.key === key);
      return (row?.config?.[key] ?? def?.default) as T;
    },
    state: {
      get: async <T,>(key: string) => (await one<{ value: T }>("SELECT value FROM agent_state WHERE agent_id = $1 AND key = $2", [agent.id, key]))?.value ?? null,
      set: async (key, value) => {
        await q(
          `INSERT INTO agent_state (agent_id, key, value) VALUES ($1,$2,$3)
           ON CONFLICT (agent_id, key) DO UPDATE SET value = EXCLUDED.value`,
          [agent.id, key, JSON.stringify(value)],
        );
      },
    },
    runAgent: (agentId, inp) => sendCommand("agent.run", { agentId, input: inp ?? {}, trigger: `agent:${agent.id}` }),
  };
  return ctx;
}

export function isSoftLlmError(e: unknown) {
  return e instanceof BudgetExceededError || e instanceof LlmNotConfiguredError;
}
