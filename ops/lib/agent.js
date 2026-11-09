'use strict';
// Claude API helpers for n8n HTTP Request nodes (raw HTTP: n8n has no SDK).
// The request asks for JSON matching a schema (structured outputs). The response
// parser checks for refusals and bad JSON and never throws, so every caller can
// fail safe: send the case to human review instead of guessing.

const AI = require('./ai');
const DEFAULT_MODEL = 'claude-opus-5-5';
const API_URL = 'https://api.anthropic.com/v1/messages';
const HEADERS = {
  'anthropic-version': '2026-10-21',
  'anthropic-beta': 'server-side-fallback-2026-07-01',
  'content-type': 'application/json',
};

// task picks the model (see ai.js): Haiku for routine work, Opus for audits and finance decisions.
// tools: optional server tools, e.g. web search for research agents.
function buildClaudeRequest({ system, prompt, schema, effort = 'medium', maxTokens = 8000, model, task, tools }) {
  const m = model || (task ? AI.modelFor(task) : DEFAULT_MODEL);
  const body = {
    model: m,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: prompt }],
    output_config: { effort },
  };
  // Server-side refusal fallback exists for Opus/Sonnet/Fable, not Haiku.
  if (!/haiku/.test(m)) body.fallbacks = 'default';
  if (schema) body.output_config.format = { type: 'json_schema', schema };
  if (tools && tools.length) body.tools = tools;
  return { url: API_URL, headers: HEADERS, body };
}

// Web search server tool. Haiku uses the basic version; Opus/Sonnet the newer one with filtering.
function webSearchTool(model, maxUses = 6, extra = {}) {
  const basic = /haiku/.test(String(model));
  return { type: basic ? 'web_search_20250305' : 'web_search_20260209', name: 'web_search', max_uses: maxUses, ...extra };
}

function parseClaudeJson(response) {
  if (!response || typeof response !== 'object') return { ok: false, error: 'no_response' };
  if (response.type === 'error' || response.error) {
    return { ok: false, error: 'api_error', detail: (response.error && response.error.message) || JSON.stringify(response.error) };
  }
  if (response.stop_reason === 'refusal') return { ok: false, error: 'refusal' };
  if (response.stop_reason === 'max_tokens') return { ok: false, error: 'truncated' };
  if (response.stop_reason === 'pause_turn') return { ok: false, error: 'paused' };
  // With web search the answer can come after several tool blocks: the JSON is in the last text run.
  const blocks = response.content || [];
  let lastTool = -1;
  blocks.forEach((b, i) => { if (b.type !== 'text') lastTool = i; });
  const text = blocks.slice(lastTool + 1).filter((b) => b.type === 'text').map((b) => b.text).join('') || blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (!text) return { ok: false, error: 'empty' };
  try {
    return { ok: true, data: JSON.parse(text), model: response.model };
  } catch (e) {
    const a = text.indexOf('{'), b = text.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return { ok: true, data: JSON.parse(text.slice(a, b + 1)), model: response.model }; } catch (e2) { /* fall through */ } }
    return { ok: false, error: 'invalid_json', detail: text.slice(0, 500) };
  }
}

// Helper for strict JSON schemas: every property required, no extras.
function obj(properties, required) {
  return { type: 'object', properties, required: required || Object.keys(properties), additionalProperties: false };
}

module.exports = { DEFAULT_MODEL, API_URL, HEADERS, buildClaudeRequest, webSearchTool, parseClaudeJson, obj };
