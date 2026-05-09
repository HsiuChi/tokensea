/**
 * Auxiliary API proxy — forwards CC's non-messages API calls to api.anthropic.com.
 *
 * Real CC makes auxiliary calls (bootstrap, grove, MCP, etc.) using different
 * User-Agents than /v1/messages (axios, Bun, claude-code). This module
 * classifies and routes those requests:
 *
 *   - FORWARD: real endpoints CC needs responses from (MCP, bootstrap, etc.)
 *   - ABSORB:  telemetry/logging — return fake 200 to prevent CC errors
 *              without leaking dario runtime info to Anthropic
 *   - Unknown: fall through to the existing 403 handler
 *
 * Auth replacement: CC sends dario's internal API key; we replace it with
 * the real OAuth Bearer token before forwarding to api.anthropic.com.
 */

import { type IncomingMessage, type ServerResponse } from 'node:http';
import type { TlsSidecarClient } from './shim/tls-sidecar-client.js';

const ANTHROPIC_API = 'https://api.anthropic.com';
const TLS_SHIM_URL = process.env.DARIO_TLS_SHIM !== '0' ? 'http://127.0.0.1:3443' : '';

// ---------------------------------------------------------------------------
// Endpoint classification
// ---------------------------------------------------------------------------

interface ForwardPattern {
  prefix: string;
  methods: Set<string>;
}

// No endpoints are silently absorbed — all known CC auxiliary paths
const FORWARD_PATTERNS: ForwardPattern[] = [
  { prefix: '/v1/mcp_servers',      methods: new Set(['GET']) },
  { prefix: '/mcp-registry/',       methods: new Set(['GET']) },
  { prefix: '/api/claude_cli/',     methods: new Set(['GET']) },
  { prefix: '/api/oauth/',          methods: new Set(['GET']) },
  // Matches /api/claude_code_grove, /api/claude_code_penguin_mode,
  // and /api/claude_code/organizations/*
  { prefix: '/api/claude_code',     methods: new Set(['GET']) },
  // Telemetry endpoints — forwarded (not absorbed) so Anthropic sees
  // the same traffic pattern as real CC. CC generates the payloads
  // itself; dario doesn't add anything to them.
  { prefix: '/api/eval/sdk-',       methods: new Set(['POST']) },
  { prefix: '/api/event_logging/',  methods: new Set(['POST']) },
];

// No endpoints are silently absorbed — all known CC auxiliary paths
// are forwarded to maintain traffic pattern consistency with real CC.

export type AuxAction = 'forward' | 'unknown';

export interface AuxResult {
  action: AuxAction;
}

/**
 * Classify an incoming request by URL path and HTTP method.
 * Returns the action to take.
 */
export function classifyAuxRequest(urlPath: string, method: string): AuxResult {
  const m = method.toUpperCase();

  // Check forward patterns
  for (const p of FORWARD_PATTERNS) {
    if (urlPath.startsWith(p.prefix) && p.methods.has(m)) {
      return { action: 'forward' };
    }
  }

  return { action: 'unknown' };
}

// ---------------------------------------------------------------------------
// Request body reading
// ---------------------------------------------------------------------------

function readRequestBody(req: IncomingMessage, maxBytes = 10 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const timeout = setTimeout(() => {
      req.destroy();
      reject(new Error('aux request body read timeout'));
    }, 30_000);

    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        clearTimeout(timeout);
        req.destroy();
        reject(new Error('aux request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      clearTimeout(timeout);
      resolve(Buffer.concat(chunks));
    });
    req.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// ---------------------------------------------------------------------------
// Hop-by-hop headers to strip when proxying
// ---------------------------------------------------------------------------

const HOP_BY_HOP = new Set([
  'host', 'connection', 'transfer-encoding', 'keep-alive',
  'upgrade', 'proxy-connection', 'proxy-authorization',
]);

const AUTH_HEADERS = new Set(['x-api-key', 'authorization']);

// ---------------------------------------------------------------------------
// Forward an auxiliary request to api.anthropic.com
// ---------------------------------------------------------------------------

/**
 * Forward an auxiliary request to api.anthropic.com with auth replacement.
 * Streams the response back to the CC client.
 */
export async function forwardAuxRequest(
  req: IncomingMessage,
  res: ServerResponse,
  accessToken: string,
  securityHeaders: Record<string, string>,
  sidecarClient?: TlsSidecarClient | null,
): Promise<void> {
  // Reconstruct target URL: original path + query string
  const fullUrl = req.url ?? '/';
  const targetUrl = `${ANTHROPIC_API}${fullUrl}`;

  // Build outbound headers: keep CC's originals but replace auth
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value !== 'string') continue;
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower) || AUTH_HEADERS.has(lower) || lower === 'content-length') continue;
    headers[key] = value;
  }
  // Replace auth with real OAuth Bearer token
  headers['Authorization'] = `Bearer ${accessToken}`;

  // Read request body for POST
  let body: Buffer | undefined;
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    try {
      body = await readRequestBody(req);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json', ...securityHeaders });
      res.end(JSON.stringify({ error: 'Bad Request', message: 'Failed to read request body' }));
      return;
    }
  }

  try {
    const shimTargetUrl = TLS_SHIM_URL
      ? targetUrl.replace(/^https:\/\/[^/]+/, TLS_SHIM_URL)
      : targetUrl;
    const upstream = sidecarClient?.ready
      ? await sidecarClient.fetch(shimTargetUrl, {
          method: req.method,
          headers,
          body: body ? new Uint8Array(body) : undefined,
          signal: AbortSignal.timeout(30_000),
        })
      : await fetch(shimTargetUrl, {
          method: req.method,
          headers,
          body: body ? new Uint8Array(body) : undefined,
          signal: AbortSignal.timeout(30_000),
        });

    // Build response headers, stripping hop-by-hop
    const respHeaders: Record<string, string> = { ...securityHeaders };
    for (const [k, v] of upstream.headers.entries()) {
      const lower = k.toLowerCase();
      if (HOP_BY_HOP.has(lower) || lower === 'content-encoding' || lower === 'content-length') continue;
      respHeaders[k] = v;
    }

    res.writeHead(upstream.status, respHeaders);

    // Stream the response body
    if (upstream.body) {
      const reader = upstream.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      } catch {
        // Client may have disconnected — that's fine
      }
    }
    res.end();
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json', ...securityHeaders });
      res.end(JSON.stringify({ error: 'Bad Gateway', message: `Aux proxy error: ${msg}` }));
    } else {
      res.end();
    }
  }
}
