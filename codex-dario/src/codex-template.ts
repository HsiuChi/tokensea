/**
 * Codex CLI request template.
 *
 * Tool definitions, system prompt, and request structure are loaded from
 * the live fingerprint cache (captured from the user's own Codex CLI at
 * startup) or from the bundled codex-template-data.json snapshot.
 *
 * Unlike dario (which matches Claude Code's Anthropic Messages API),
 * codex-dario targets the OpenAI Responses API (chatgpt.com backend)
 * which uses a different wire format.
 */

import { loadTemplate, type TemplateData } from './live-fingerprint.js';

// Load template at module init — prefer live cache, fall back to bundled.
const TEMPLATE: TemplateData = loadTemplate({ silent: true });

/** The loaded template — source, version, capture age, all fields. */
export let CODEX_TEMPLATE: TemplateData = TEMPLATE;

/**
 * [TokenSea] Reload the template from disk (live cache or bundled).
 */
export function reloadTemplate(): void {
  const fresh = loadTemplate({ silent: true });
  CODEX_TEMPLATE = fresh;
  console.log(`[codex-dario] Template reloaded: v${fresh._version} (${fresh._source || 'unknown'} source, captured ${fresh._captured})`);
}

/**
 * Build an outbound request that matches Codex CLI's wire shape.
 *
 * Takes a client request (OpenAI Chat Completions format) and
 * transforms it into a Codex CLI-shaped request for the
 * OpenAI Responses API.
 */
export function buildCodexRequest(opts: {
  clientBody: Record<string, unknown>;
  model: string;
  accessToken: string;
  chatgptAccountId: string;
  sessionId: string;
  userAgent: string;
  template: TemplateData;
  verbose?: boolean;
}): {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
} {
  const {
    clientBody,
    model,
    accessToken,
    chatgptAccountId,
    sessionId,
    userAgent,
    template,
  } = opts;

  // Build the Codex Responses API request body
  const messages = extractMessages(clientBody);

  // Codex CLI sends to chatgpt.com backend
  const url = 'https://chatgpt.com/backend-api/codex/responses';

  // Build headers matching Codex CLI's wire shape
  const headers: Record<string, string> = {};

  // Apply captured header order if available
  const headerOrder = template.header_order;
  if (headerOrder && headerOrder.length > 0) {
    // First, build the full set of headers we want to send
    const allHeaders: Record<string, string> = {
      'Authorization': `Bearer ${accessToken}`,
      'User-Agent': userAgent,
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      'Originator': template.cc_entrypoint || 'codex_cli_rs',
    };

    if (chatgptAccountId) {
      allHeaders['ChatGPT-Account-Id'] = chatgptAccountId;
    }

    if (template.anthropic_beta) {
      // Not applicable for Codex, but keep for compatibility
    }

    // Order headers according to the captured order
    const ordered = orderHeadersForOutbound(allHeaders, headerOrder);
    Object.assign(headers, Object.fromEntries(
      Array.isArray(ordered) ? ordered : Object.entries(ordered)
    ));
  } else {
    // No captured order — use the known Codex CLI header order
    headers['Authorization'] = `Bearer ${accessToken}`;
    headers['User-Agent'] = userAgent;
    headers['Content-Type'] = 'application/json';
    headers['Accept'] = 'text/event-stream';
    headers['Originator'] = template.cc_entrypoint || 'codex_cli_rs';
    if (chatgptAccountId) {
      headers['ChatGPT-Account-Id'] = chatgptAccountId;
    }
  }

  // Build the Responses API body
  const body: Record<string, unknown> = {
    model,
    input: messages,
    stream: true,
    session_id: sessionId,
    store: false,  // ChatGPT accounts require store=false
  };

  // Add tools from template if available
  if (template.tools && template.tools.length > 0) {
    body.tools = template.tools;
  }

  // Add instructions (system prompt) from template if available,
  // or use a minimal default — OpenAI Responses API requires this field.
  if (template.system_prompt) {
    body.instructions = template.system_prompt;
  } else {
    body.instructions = 'You are a helpful assistant.';
  }

  // Reorder body fields to match captured order
  const bodyFieldOrder = template.body_field_order;
  if (bodyFieldOrder && bodyFieldOrder.length > 0) {
    return {
      url,
      method: 'POST',
      headers,
      body: orderBodyForOutbound(body, bodyFieldOrder),
    };
  }

  return { url, method: 'POST', headers, body };
}

/**
 * Extract messages from various input formats and convert to
 * Codex Responses API input format.
 */
function extractMessages(clientBody: Record<string, unknown>): unknown[] {
  const messages = clientBody.messages as Array<{ role: string; content: unknown }> | undefined;
  if (!messages) {
    // If there's a direct 'input' field, pass through
    if (clientBody.input) return clientBody.input as unknown[];
    return [];
  }

  // Convert OpenAI Chat Completions messages to Responses API input
  return messages.map(msg => {
    if (msg.role === 'system') {
      return { type: 'instructions', text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) };
    }
    return {
      type: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content,
    };
  });
}

/**
 * Apply captured header order to outbound headers.
 * Returns ordered header pairs as an array to preserve insertion order.
 */
export function orderHeadersForOutbound(
  headers: Record<string, string>,
  overrideHeaderOrder?: string[],
): Record<string, string> | Array<[string, string]> {
  const order = overrideHeaderOrder;
  if (!order || order.length === 0) {
    return headers;
  }

  const lowerToValue = new Map<string, string>();
  const lowerToOriginalKey = new Map<string, string>();
  for (const [k, v] of Object.entries(headers)) {
    const lk = k.toLowerCase();
    lowerToValue.set(lk, v);
    lowerToOriginalKey.set(lk, k);
  }

  const ordered: Array<[string, string]> = [];
  const seen = new Set<string>();

  for (const name of order) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    const value = lowerToValue.get(key);
    if (value !== undefined) {
      ordered.push([name, value]);
      seen.add(key);
    }
  }

  // Append any headers not in the captured order
  for (const [k, v] of Object.entries(headers)) {
    const lk = k.toLowerCase();
    if (!seen.has(lk)) {
      ordered.push([k, v]);
    }
  }

  return ordered;
}

/**
 * Reorder a JSON body's keys to match captured Codex CLI wire order.
 */
export function orderBodyForOutbound(
  body: Record<string, unknown>,
  overrideOrder?: string[],
): Record<string, unknown> {
  const order = overrideOrder;
  if (!order || order.length === 0) {
    return body;
  }

  const ordered: Record<string, unknown> = {};
  const seen = new Set<string>();

  for (const name of order) {
    if (seen.has(name)) continue;
    if (Object.prototype.hasOwnProperty.call(body, name)) {
      ordered[name] = body[name];
      seen.add(name);
    }
  }

  for (const k of Object.keys(body)) {
    if (!seen.has(k)) {
      ordered[k] = body[k];
    }
  }

  return ordered;
}
