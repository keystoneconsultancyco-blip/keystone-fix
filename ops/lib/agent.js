'use strict';
// Claude API helpers for n8n HTTP Request nodes (raw HTTP: n8n has no SDK).
// The request asks for JSON matching a schema (structured outputs). The response
// parser checks for refusals and bad JSON and never throws, so every caller can
// fail safe: send the case to human review instead of guessing.

const DEFAULT_MODEL = 'claude-opus-5-5';
const API_URL = 'https://api.anthropic.com/v1/messages';
const HEADERS = {
  'anthropic-version': '2026-10-21',
  'anthropic-beta': 'server-side-fallback-2026-07-01',
  'content-type': 'application/json',
};

function buildClaudeRequest({ system, prompt, schema, effort = 'medium', maxTokens = 8000, model = DEFAULT_MODEL }) {
  const body = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: prompt }],
    output_config: { effort },
    fallbacks: 'default',
  };
  if (schema) body.output_config.format = { type: 'json_schema', schema };
  return { url: API_URL, headers: HEADERS, body };
}

function parseClaudeJson(response) {
  if (!response || typeof response !== 'object') return { ok: false, error: 'no_response' };
  if (response.type === 'error' || response.error) {
    return { ok: false, error: 'api_error', detail: (response.error && response.error.message) || JSON.stringify(response.error) };
  }
  if (response.stop_reason === 'refusal') return { ok: false, error: 'refusal' };
  if (response.stop_reason === 'max_tokens') return { ok: false, error: 'truncated' };
  const text = (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (!text) return { ok: false, error: 'empty' };
  try {
    return { ok: true, data: JSON.parse(text), model: response.model };
  } catch (e) {
    return { ok: false, error: 'invalid_json', detail: text.slice(0, 500) };
  }
}

// Helper for strict JSON schemas: every property required, no extras.
function obj(properties, required) {
  return { type: 'object', properties, required: required || Object.keys(properties), additionalProperties: false };
}

module.exports = { DEFAULT_MODEL, API_URL, HEADERS, buildClaudeRequest, parseClaudeJson, obj };
