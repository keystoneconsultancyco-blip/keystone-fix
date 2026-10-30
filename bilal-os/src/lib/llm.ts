import Anthropic from "@anthropic-ai/sdk";
import { getSecret, getSetting } from "./settings";
import { costStatus, recordUsage } from "./cost";

export class BudgetExceededError extends Error {
  constructor() { super("Monthly AI budget reached — non-essential AI is paused."); this.name = "BudgetExceededError"; }
}
export class LlmNotConfiguredError extends Error {
  constructor() { super("No Anthropic API key yet. Add it on the Setup page."); this.name = "LlmNotConfiguredError"; }
}
export class LlmRefusalError extends Error {
  constructor(public category: string | null) { super(`The model declined this request${category ? ` (${category})` : ""}.`); this.name = "LlmRefusalError"; }
}

export type Tier = "fast" | "strong";

export interface CompleteOptions {
  tier: Tier;
  system?: string;
  prompt: string | Anthropic.MessageParam["content"];
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
  /** JSON schema for structured output. The parsed object is returned in `json`. */
  schema?: Record<string, unknown>;
  agentId?: string | null;
  purpose?: string;
  /** Essential calls still run at 100% of the budget? No — they must use a non-AI fallback. */
  essential?: boolean;
}

let cached: { key: string; client: Anthropic } | null = null;
async function client(): Promise<Anthropic> {
  const key = await getSecret("anthropic_api_key");
  if (!key) throw new LlmNotConfiguredError();
  if (!cached || cached.key !== key) cached = { key, client: new Anthropic({ apiKey: key, maxRetries: 3 }) };
  return cached.client;
}

export async function modelFor(tier: Tier): Promise<string> {
  return tier === "fast" ? getSetting("llm.fastModel") : getSetting("llm.strongModel");
}

/**
 * The single entry point for AI calls. Checks the monthly budget first, records
 * token cost afterwards. Agents call this through ctx.llm so usage is attributed.
 */
export async function complete(opts: CompleteOptions): Promise<{ text: string; json: any; model: string; costGbp: number }> {
  const status = await costStatus();
  if (status.paused) throw new BudgetExceededError();
  const c = await client();
  const model = await modelFor(opts.tier);
  const content = typeof opts.prompt === "string" ? opts.prompt : opts.prompt;
  const outputConfig: Anthropic.OutputConfig = { effort: opts.effort ?? (opts.tier === "fast" ? "low" : "medium") };
  if (opts.schema) outputConfig.format = { type: "json_schema", schema: opts.schema };

  const params = {
    model,
    max_tokens: opts.maxTokens ?? (opts.tier === "fast" ? 4000 : 16000),
    system: opts.system,
    messages: [{ role: "user" as const, content }],
    output_config: outputConfig,
  };

  // Strong-tier drafting uses server-side fallbacks so a false-positive refusal
  // is retried on another model automatically.
  const res: Anthropic.Message =
    opts.tier === "strong"
      ? ((await c.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } as any)) as unknown as Anthropic.Message)
      : await c.messages.create(params);

  const u = res.usage;
  const costGbp = await recordUsage({
    agentId: opts.agentId, model: res.model ?? model, purpose: opts.purpose,
    input: u.input_tokens ?? 0, output: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0,
  });

  if (res.stop_reason === "refusal") throw new LlmRefusalError((res as any).stop_details?.category ?? null);
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
  let json: any = null;
  if (opts.schema) {
    if (res.stop_reason === "max_tokens") throw new Error("AI response was cut off (max_tokens). Try again with a larger limit.");
    json = JSON.parse(text);
  }
  return { text, json, model, costGbp };
}

/** Quick connectivity check for the Setup page. Uses the fast model with a tiny prompt. */
export async function testAnthropic(): Promise<string> {
  const r = await complete({ tier: "fast", prompt: "Reply with exactly: ok", maxTokens: 50, purpose: "setup-test" });
  return r.text;
}
