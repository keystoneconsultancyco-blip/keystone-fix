import type { BrowserContext } from "playwright";
import type { calendar_v3, drive_v3 } from "googleapis";
import type { CompleteOptions, complete } from "../llm";
import type { Severity } from "../alerts";
import type { Approval } from "../approvals";
import type { SecretKey, SettingKey, SettingValue } from "../settings";
import type { InlineButton } from "../telegram";

/**
 * What an agent is allowed to touch. Calling a service you did not declare
 * throws a PermissionError, so a misbehaving agent can't quietly overreach.
 */
export type Permission =
  | "llm"            // Anthropic API (cost-tracked)
  | "telegram"       // message Bilal
  | "calendar"       // Google Calendar read/write
  | "drive"          // Google Drive (only files Bilal OS created)
  | "browser"        // Playwright Chromium
  | "secrets:moodle" // read RHUL username/password
  ;

export interface Kpi {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "good" | "warn" | "bad" | "neutral";
}

export interface ApprovalRule {
  /** Machine name of the action, e.g. "submit_application". */
  kind: string;
  /** Plain-English description shown on the agent's settings page. */
  description: string;
}

export interface AgentSettingDef {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "text";
  default: string | number | boolean;
  help?: string;
}

export interface RunResult {
  /** One-line summary shown in the agents list and activity log. */
  summary: string;
  /** Set when the agent decided there was nothing to do. */
  skipped?: boolean;
}

export interface SectorDefinition {
  id: string;
  name: string;
  icon: string;
  description: string;
  sort?: number;
  /** Sector-level KPI cards (agents can add their own too). */
  kpis?: () => Promise<Kpi[]>;
}

export interface AgentDefinition {
  /** Globally unique, kebab-case, prefixed with the sector: "pa.morning-briefing". */
  id: string;
  sector: string;
  name: string;
  description: string;
  /**
   * Cron expression in UK time ("0 7 * * *" = 07:00 daily), or a function that
   * reads it from settings. Omit for agents that only run on demand / when triggered.
   */
  schedule?: string | (() => Promise<string | null>);
  /** Essential agents keep running when the AI budget is used up (they must cope without AI). */
  essential?: boolean;
  /** Enabled when first registered? Defaults to true. */
  defaultEnabled?: boolean;
  permissions: Permission[];
  /** Actions that need Bilal's OK before they happen. */
  approvals?: ApprovalRule[];
  /** Extra settings shown on the sector's settings tab. Read with ctx.config(key). */
  settings?: AgentSettingDef[];
  /** Retries after a failure (with exponential backoff). Default 2. */
  retries?: number;
  /** Max run time in seconds before the job is killed. Default 900. */
  timeoutSeconds?: number;
  kpis?: () => Promise<Kpi[]>;
  run(ctx: AgentContext): Promise<RunResult>;
  /** Called by the worker after Bilal approves/rejects one of this agent's approvals. */
  onApproval?(ctx: AgentContext, approval: Approval): Promise<string | void>;
}

export interface AgentContext {
  agent: AgentDefinition;
  runId: number;
  trigger: string;
  input: Record<string, unknown>;
  log(message: string, data?: unknown, level?: "debug" | "info" | "warn" | "error"): Promise<void>;
  llm(opts: Omit<CompleteOptions, "agentId" | "essential">): ReturnType<typeof complete>;
  /** True when AI can be used right now (key set, budget not exhausted). */
  llmAvailable(): Promise<boolean>;
  telegram(html: string, opts?: { buttons?: InlineButton[][]; silent?: boolean }): Promise<boolean>;
  alert(severity: Severity, title: string, body?: string, opts?: { url?: string; dedupeKey?: string }): Promise<number | null>;
  requestApproval(kind: string, title: string, summary: string, payload?: unknown): Promise<number>;
  calendar(): Promise<calendar_v3.Calendar>;
  drive(): Promise<drive_v3.Drive>;
  browser<T>(profile: string, fn: (ctx: BrowserContext) => Promise<T>): Promise<T>;
  secret(key: SecretKey): Promise<string | null>;
  setting<K extends SettingKey>(key: K): Promise<SettingValue<K>>;
  /** Per-agent setting declared in `settings`. */
  config<T = unknown>(key: string): Promise<T>;
  state: {
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<void>;
  };
  /** Queue another agent to run (e.g. a scraper triggering the indexer). */
  runAgent(agentId: string, input?: Record<string, unknown>): Promise<void>;
}
