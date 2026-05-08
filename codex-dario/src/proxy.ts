/**
 * Codex-Dario — Wire-fidelity proxy for OpenAI Codex subscriptions.
 *
 * Accepts OpenAI Chat Completions API requests and forwards them
 * through a TLS stack that matches the real Codex CLI's fingerprint,
 * making the outbound requests indistinguishable from genuine Codex.
 *
 * Core architecture:
 *   Client → [codex-dario proxy] → (Unix Socket) → [tls-shim Rust] → chatgpt.com
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { readFileSync, createWriteStream, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { arch, platform } from 'node:process';
import { getAccessToken, getStatus, isAccountInvalidated } from './oauth.js';
import { buildCodexRequest, CODEX_TEMPLATE, reloadTemplate } from './codex-template.js';
import { describeTemplate, detectDrift, captureLiveFingerprint } from './live-fingerprint.js';
import { AccountPool, computeStickyKey, type PoolAccount } from './pool.js';
import { Analytics } from './analytics.js';
import { loadAllAccounts, loadAccount, refreshAccountToken } from './accounts.js';
import { RequestQueue, QueueFullError, QueueTimeoutError, DEFAULT_MAX_CONCURRENT, DEFAULT_MAX_QUEUED, DEFAULT_QUEUE_TIMEOUT_MS } from './request-queue.js';
import { redactSecrets } from './redact.js';
import { TlsShimClient } from './tls-shim-client.js';
import { SessionRegistry, resolveSessionRotationConfig } from './session-rotation.js';
import { resolvePacingConfig, computePacingDelay } from './pacing.js';
import { resolveDrainOnClose, decideOnClientClose } from './stream-drain.js';
import { resolveModel, MODEL_ALIASES } from './models.js';

const CHATGPT_API = 'https://chatgpt.com';
const DEFAULT_PORT = 3457;
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 300_000;
const DEFAULT_HOST = '127.0.0.1';

function isLoopbackHost(host: string): boolean {
  if (host === '127.0.0.1' || host === '::1' || host === 'localhost') return true;
  return host.startsWith('127.');
}

const OS_NAME = platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'MacOS' : 'Linux';

// Build Codex CLI User-Agent string
function buildUserAgent(version: string): string {
  const termVer = '1.0'; // Terminal version — would be detected in production
  return `codex_cli_rs/${version} (${OS_NAME} ${detectOsVersion()}; ${arch}) terminal/${termVer}`;
}

function detectOsVersion(): string {
  try {
    const os = require('node:os') as typeof import('node:os');
    return os.release();
  } catch {
    return 'unknown';
  }
}

// Detect installed Codex CLI version
function detectCodexVersion(): string {
  try {
    const out = execSync('codex --version 2>/dev/null', { timeout: 5000, stdio: 'pipe' }).toString().trim();
    const match = out.match(/^([\d]+\.[\d]+\.[\d]+)/);
    if (match) return match[1];
  } catch { /* not installed */ }
  if (process.env.CODEX_DARIO_CODEX_VERSION) {
    return process.env.CODEX_DARIO_CODEX_VERSION;
  }
  if (CODEX_TEMPLATE._version && CODEX_TEMPLATE._version !== 'unknown' && CODEX_TEMPLATE._version !== '0.0.0') {
    const m = CODEX_TEMPLATE._version.match(/^([\d]+\.[\d]+\.[\d]+)/);
    if (m) return m[1];
  }
  return '0.128.0';
}

interface ProxyOptions {
  port?: number;
  host?: string;
  verbose?: boolean;
  verboseBodies?: boolean;
  model?: string;
  passthrough?: boolean;
  pacingMinMs?: number;
  pacingJitterMs?: number;
  drainOnClose?: boolean;
  sessionIdleRotateMs?: number;
  sessionRotateJitterMs?: number;
  sessionMaxAgeMs?: number;
  sessionPerClient?: boolean;
  noLiveCapture?: boolean;
  maxConcurrent?: number;
  maxQueued?: number;
  queueTimeoutMs?: number;
  logFile?: string;
  shimSocketPath?: string;
  shimBinaryPath?: string;
}

export async function startProxy(opts: ProxyOptions = {}): Promise<void> {
  const port = opts.port ?? (parseInt(process.env.CODEX_DARIO_LISTEN_PORT || '', 10) || DEFAULT_PORT);
  const host = opts.host ?? process.env.CODEX_DARIO_HOST ?? DEFAULT_HOST;
  const verbose = opts.verbose ?? false;
  const passthrough = opts.passthrough ?? false;
  const verboseBodies = Boolean(opts.verboseBodies) || process.env.CODEX_DARIO_LOG_BODIES === '1';

  // ── Start the TLS shim ──────────────────────────────────────────
  const shimClient = new TlsShimClient({
    socketPath: opts.shimSocketPath || process.env.CODEX_DARIO_TLS_SHIM_SOCKET,
    shimBinaryPath: opts.shimBinaryPath || process.env.CODEX_DARIO_TLS_SHIM_BINARY,
  });

  try {
    await shimClient.start();
    console.log('[codex-dario] TLS shim started');
  } catch (err) {
    console.warn(`[codex-dario] TLS shim failed to start: ${err instanceof Error ? err.message : err}`);
    console.warn('[codex-dario] Will fall back to direct fetch (OpenSSL fingerprint — NOT wire-fidelity)');
  }

  // ── Live fingerprint capture ────────────────────────────────────
  if (!opts.noLiveCapture && process.env.CODEX_DARIO_NO_LIVE_CAPTURE !== '1') {
    captureLiveFingerprint().then(template => {
      if (template) {
        reloadTemplate();
        console.log(`[codex-dario] Live capture complete: v${template._version}`);
      }
    }).catch(err => {
      console.warn(`[codex-dario] Live capture failed: ${err instanceof Error ? err.message : err}`);
    });
  }

  // ── Auth check ──────────────────────────────────────────────────
  let status = await getStatus();
  if (!status.authenticated) {
    console.warn('[codex-dario] Not authenticated. Health endpoints available; proxy requests will return 503.');
    console.warn('[codex-dario] Run `codex-dario login` or set CODEX_DARIO_OAUTH_* environment variables.');
  }

  const codexVersion = detectCodexVersion();
  const modelOverride = opts.model ? (MODEL_ALIASES[opts.model] ?? opts.model) : null;

  // ── Account pool ────────────────────────────────────────────────
  const accountsList = await loadAllAccounts();
  const pool = accountsList.length >= 2 ? new AccountPool() : null;
  const analytics = pool ? new Analytics() : null;

  if (pool) {
    for (const acc of accountsList) {
      pool.add(acc.alias, {
        accessToken: acc.accessToken,
        refreshToken: acc.refreshToken,
        expiresAt: acc.expiresAt,
        deviceId: acc.deviceId || randomUUID(),
        accountUuid: acc.accountUuid || '',
      });
    }
    console.log(`[codex-dario] Pool mode: ${accountsList.length} accounts loaded`);

    // Background token refresh patrol — every 5 minutes
    const patrolInterval = setInterval(async () => {
      const { patrolRefresh } = await import('./oauth.js');
      await patrolRefresh();
    }, 5 * 60 * 1000);
    patrolInterval.unref();

    // Per-account background refresh
    const refreshInterval = setInterval(async () => {
      for (const acc of pool.all()) {
        if (acc.expiresAt < Date.now() + 10 * 60 * 1000) {
          try {
            const saved = await loadAccount(acc.alias);
            if (!saved) continue;
            const refreshed = await refreshAccountToken(saved);
            pool.updateTokens(acc.alias, refreshed.accessToken, refreshed.refreshToken, refreshed.expiresAt);
          } catch (err) {
            console.error(`[codex-dario] Background refresh failed for ${acc.alias}: ${err instanceof Error ? err.message : err}`);
          }
        }
      }
    }, 5 * 60 * 1000);
    refreshInterval.unref();
  }

  // ── Proxy state ─────────────────────────────────────────────────
  let requestCount = 0;
  let failedRequestCount = 0;
  let activeConcurrent = 0;
  const proxyStartTime = Date.now();

  const queue = new RequestQueue({
    maxConcurrent: opts.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
    maxQueued: opts.maxQueued ?? DEFAULT_MAX_QUEUED,
    queueTimeoutMs: opts.queueTimeoutMs ?? DEFAULT_QUEUE_TIMEOUT_MS,
  });

  // Pacing
  const lastRequestTimeRef = { value: 0 };
  const pacingCfg = resolvePacingConfig(
    { minGapMs: opts.pacingMinMs, jitterMs: opts.pacingJitterMs },
    { ...process.env, DARIO_PACE_MIN_MS: process.env.CODEX_DARIO_PACE_MIN_MS, DARIO_PACE_JITTER_MS: process.env.CODEX_DARIO_PACE_JITTER_MS },
  );

  // Session rotation
  const sessionCfg = resolveSessionRotationConfig(
    { idleRotateMs: opts.sessionIdleRotateMs, jitterMs: opts.sessionRotateJitterMs, maxAgeMs: opts.sessionMaxAgeMs, perClient: opts.sessionPerClient },
    { ...process.env, DARIO_SESSION_IDLE_ROTATE_MS: process.env.CODEX_DARIO_SESSION_IDLE_ROTATE_MS, DARIO_SESSION_JITTER_MS: process.env.CODEX_DARIO_SESSION_JITTER_MS, DARIO_SESSION_MAX_AGE_MS: process.env.CODEX_DARIO_SESSION_MAX_AGE_MS, DARIO_SESSION_PER_CLIENT: process.env.CODEX_DARIO_SESSION_PER_CLIENT },
  );
  const sessionRegistry = new SessionRegistry(sessionCfg, () => randomUUID());

  // Drain on close
  const drainOnClose = resolveDrainOnClose(opts.drainOnClose);

  // API key auth
  const apiKey = process.env.CODEX_DARIO_API_KEY;
  const apiKeyBuf = apiKey ? Buffer.from(apiKey) : null;

  const userAgent = buildUserAgent(codexVersion);

  // ── Request log ─────────────────────────────────────────────────
  const logFilePath = opts.logFile || process.env.CODEX_DARIO_LOG_FILE || null;
  let logFileStream: WriteStream | null = null;
  if (logFilePath) {
    try {
      logFileStream = createWriteStream(logFilePath, { flags: 'a' });
    } catch { /* ignore */ }
  }

  // ── Static headers from template ────────────────────────────────
  const staticHeaders: Record<string, string> = {
    'Originator': 'codex_cli_rs',
    'User-Agent': userAgent,
    'Accept': 'text/event-stream',
  };

  // Apply captured header_values
  const hv = CODEX_TEMPLATE.header_values || {};
  if (hv['user-agent']) staticHeaders['User-Agent'] = hv['user-agent'];
  if (hv['originator']) staticHeaders['Originator'] = hv['originator'];

  // ── CORS & security ─────────────────────────────────────────────
  const corsOrigin = process.env.CODEX_DARIO_CORS_ORIGIN || `http://localhost:${port}`;
  const SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Cache-Control': 'no-store',
  };
  const CORS_HEADERS = {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
    'Access-Control-Max-Age': '86400',
    ...SECURITY_HEADERS,
  };
  const JSON_HEADERS = { 'Content-Type': 'application/json', ...SECURITY_HEADERS };

  // ── HTTP Server ─────────────────────────────────────────────────
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS_HEADERS); res.end(); return; }

    const urlPath = req.url?.split('?')[0] ?? '';

    // Health endpoints
    if (urlPath === '/healthz' || urlPath === '/health') {
      const s = await getStatus();
      const uptimeSeconds = Math.floor((Date.now() - proxyStartTime) / 1000);
      const oauthStatus = s.status === 'healthy' ? 'valid'
        : s.status === 'expiring' ? 'valid'
        : s.status === 'expired' ? 'expired'
        : 'none';
      const overallStatus = oauthStatus === 'valid' ? 'healthy'
        : oauthStatus === 'expired' ? 'degraded'
        : 'down';
      res.writeHead(200, JSON_HEADERS);
      res.end(JSON.stringify({
        status: overallStatus,
        account_id: process.env.CODEX_DARIO_ACCOUNT_ID || '',
        oauth_status: oauthStatus,
        oauth_expires_at: s.expiresAt ? new Date(s.expiresAt).toISOString() : null,
        template_version: CODEX_TEMPLATE._version || '',
        tls_shim: shimClient.isConnected ? 'connected' : 'disconnected',
        concurrent_requests: activeConcurrent,
        uptime_seconds: uptimeSeconds,
      }));
      return;
    }

    // Models endpoint (OpenAI compatible)
    if (urlPath === '/v1/models' && req.method === 'GET') {
      if (apiKeyBuf && !authenticateRequest(req.headers, apiKeyBuf)) {
        res.writeHead(401, JSON_HEADERS);
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
      res.writeHead(200, JSON_HEADERS);
      res.end(JSON.stringify({
        object: 'list',
        data: Object.entries(MODEL_ALIASES).map(([id, modelId]) => ({
          id: modelId,
          object: 'model',
          created: 1700000000,
          owned_by: 'openai',
        })),
      }));
      return;
    }

    // Main API endpoint: POST /v1/chat/completions
    if (urlPath === '/v1/chat/completions' || urlPath === '/v1/responses') {
      await handleApiRequest(req, res, {
        urlPath,
        verbose,
        verboseBodies,
        passthrough,
        modelOverride,
        shimClient,
        pool,
        analytics,
        queue,
        pacingCfg,
        lastRequestTimeRef,
        sessionRegistry,
        sessionCfg,
        drainOnClose,
        staticHeaders,
        userAgent,
        apiKeyBuf,
        logFileStream,
        requestCount: () => requestCount,
        incrementRequestCount: () => { requestCount++; },
        incrementFailedCount: () => { failedRequestCount++; },
        incrementConcurrent: () => { activeConcurrent++; },
        decrementConcurrent: () => { activeConcurrent--; },
      });
      return;
    }

    // Unknown path
    res.writeHead(404, JSON_HEADERS);
    res.end(JSON.stringify({ error: 'Not found', message: 'Supported: POST /v1/chat/completions, GET /v1/models, GET /healthz' }));
  });

  server.listen(port, host, () => {
    console.log(`[codex-dario] Proxy listening on ${host}:${port}`);
    console.log(`[codex-dario] Codex version: ${codexVersion}`);
    console.log(`[codex-dario] User-Agent: ${userAgent}`);
    console.log(`[codex-dario] TLS shim: ${shimClient.isConnected ? 'connected' : 'disconnected'}`);
    console.log(`[codex-dario] Template: ${describeTemplate(CODEX_TEMPLATE)}`);
    if (pool) {
      const ps = pool.status();
      console.log(`[codex-dario] Pool: ${ps.healthy}/${ps.accounts} healthy`);
    }
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[codex-dario] Shutting down...');
    await shimClient.stop();
    server.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// ── Request handler ────────────────────────────────────────────────

interface RequestContext {
  urlPath: string;
  verbose: boolean;
  verboseBodies: boolean;
  passthrough: boolean;
  modelOverride: string | null;
  shimClient: TlsShimClient;
  pool: AccountPool | null;
  analytics: Analytics | null;
  queue: RequestQueue;
  pacingCfg: { minGapMs: number; jitterMs: number };
  lastRequestTimeRef: { value: number };
  sessionRegistry: SessionRegistry;
  sessionCfg: { idleRotateMs: number; jitterMs: number; maxAgeMs?: number; perClient: boolean };
  drainOnClose: boolean;
  staticHeaders: Record<string, string>;
  userAgent: string;
  apiKeyBuf: Buffer | null;
  logFileStream: WriteStream | null;
  requestCount: () => number;
  incrementRequestCount: () => void;
  incrementFailedCount: () => void;
  incrementConcurrent: () => void;
  decrementConcurrent: () => void;
}

async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RequestContext,
): Promise<void> {
  const startTime = Date.now();

  // Auth check
  if (ctx.apiKeyBuf && !authenticateRequest(req.headers, ctx.apiKeyBuf)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized', message: 'Invalid or missing API key' }));
    return;
  }

  // Read request body
  let bodyStr: string;
  try {
    bodyStr = await readBody(req, MAX_BODY_BYTES);
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Bad request', message: err instanceof Error ? err.message : 'Failed to read body' }));
    return;
  }

  let clientBody: Record<string, unknown>;
  try {
    clientBody = JSON.parse(bodyStr);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Bad request', message: 'Invalid JSON body' }));
    return;
  }

  // Queue admission
  try {
    await ctx.queue.acquire();
  } catch (err) {
    ctx.incrementFailedCount();
    const status = err instanceof QueueFullError ? 429 : 504;
    const reason = err instanceof QueueFullError ? 'queue-full' : 'queue-timeout';
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: reason, message: err instanceof Error ? err.message : String(err) }));
    return;
  }

  ctx.incrementConcurrent();
  ctx.incrementRequestCount();

  try {
    // Resolve model
    const model = resolveModel(ctx.modelOverride || String(clientBody.model || 'o3'));
    const isStream = Boolean(clientBody.stream);

    // Get access token
    const alias = ctx.pool ? undefined : undefined; // TODO: pool account selection
    let accessToken: string;
    try {
      accessToken = await getAccessToken(alias);
    } catch (err) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Service unavailable', message: 'OAuth token not available' }));
      return;
    }

    // Resolve session
    const clientSessionId = req.headers['x-session-id'] as string | undefined
      || req.headers['x-client-session-id'] as string | undefined;
    const now = Date.now();
    const sessionResult = ctx.sessionRegistry.getOrCreate(
      ctx.sessionCfg.perClient ? clientSessionId : undefined,
      now,
    );

    // Pacing delay
    const pacingDelay = computePacingDelay(now, ctx.lastRequestTimeRef.value, ctx.pacingCfg);
    if (pacingDelay > 0) {
      await new Promise(r => setTimeout(r, pacingDelay));
    }
    ctx.lastRequestTimeRef.value = Date.now();

    // Build the outbound request
    const chatgptAccountId = process.env.CODEX_DARIO_CHATGPT_ACCOUNT_ID || '';

    let outboundUrl: string;
    let outboundMethod: string;
    let outboundHeaders: Record<string, string>;
    let outboundBody: Record<string, unknown>;

    if (ctx.passthrough) {
      // Passthrough mode: minimal transformation
      outboundUrl = 'https://chatgpt.com/backend-api/codex/responses';
      outboundMethod = 'POST';
      outboundHeaders = {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': isStream ? 'text/event-stream' : 'application/json',
      };
      if (chatgptAccountId) {
        outboundHeaders['ChatGPT-Account-Id'] = chatgptAccountId;
      }
      outboundBody = clientBody;
    } else {
      // Wire-fidelity mode: full template replay
      const built = buildCodexRequest({
        clientBody,
        model,
        accessToken,
        chatgptAccountId,
        sessionId: sessionResult.sessionId,
        userAgent: ctx.userAgent,
        template: CODEX_TEMPLATE,
        verbose: ctx.verbose,
      });
      outboundUrl = built.url;
      outboundMethod = built.method;
      outboundHeaders = built.headers;
      outboundBody = built.body;
    }

    if (ctx.verboseBodies) {
      console.error(`[codex-dario] → ${outboundMethod} ${outboundUrl}`);
      console.error(`[codex-dario] → headers: ${JSON.stringify(Object.keys(outboundHeaders))}`);
      console.error(`[codex-dario] → body keys: ${Object.keys(outboundBody).join(', ')}`);
    }

    // Execute the request through the TLS shim or fallback to direct fetch
    let upstreamResponse: { status: number; headers: Record<string, string>; body: string };

    if (ctx.shimClient.isConnected) {
      // Use the Rust tls-shim for wire-fidelity TLS fingerprint
      const shimResp = await ctx.shimClient.request({
        method: outboundMethod,
        url: outboundUrl,
        headers: outboundHeaders,
        body: JSON.stringify(outboundBody),
        timeoutMs: UPSTREAM_TIMEOUT_MS,
      });

      if (shimResp.error) {
        throw new Error(`tls-shim error: ${shimResp.error}`);
      }

      upstreamResponse = {
        status: shimResp.status,
        headers: shimResp.headers,
        body: shimResp.body || '',
      };
    } else {
      // Fallback: direct fetch (not wire-fidelity — OpenSSL fingerprint)
      const fetchResp = await fetch(outboundUrl, {
        method: outboundMethod,
        headers: outboundHeaders,
        body: JSON.stringify(outboundBody),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });

      const respBody = await fetchResp.text();
      const respHeaders: Record<string, string> = {};
      fetchResp.headers.forEach((v, k) => { respHeaders[k] = v; });

      upstreamResponse = {
        status: fetchResp.status,
        headers: respHeaders,
        body: respBody,
      };
    }

    // Handle upstream errors
    if (upstreamResponse.status >= 400) {
      ctx.incrementFailedCount();

      if (upstreamResponse.status === 401) {
        // Token might be invalidated
        const errBody = upstreamResponse.body;
        if (errBody.includes('token_revoked') || errBody.includes('invalid_api_key')) {
          console.error('[codex-dario] Token appears to be invalidated by OpenAI');
        }
      }

      res.writeHead(upstreamResponse.status, { 'Content-Type': 'application/json' });
      res.end(upstreamResponse.body);
      return;
    }

    // Handle streaming vs non-streaming response
    if (isStream && upstreamResponse.headers['content-type']?.includes('text/event-stream')) {
      // Stream the SSE response to the client
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        ...CORS_HEADERS,
      });

      // For shim responses, the body contains the full SSE stream
      // For direct fetch, we need to stream the response
      // In the shim case, we forward the captured SSE data
      const sseBody = upstreamResponse.body;

      // Parse and forward SSE events
      const lines = sseBody.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ') || line.startsWith('event: ') || line === '') {
          res.write(line + '\n');
        }
      }
      res.end();
    } else {
      // Non-streaming response
      res.writeHead(upstreamResponse.status, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(upstreamResponse.body);
    }

    const latency = Date.now() - startTime;
    if (ctx.verbose) {
      console.log(`[codex-dario] ${req.method} ${ctx.urlPath} → ${upstreamResponse.status} (${latency}ms) model=${model} session=${sessionResult.sessionId.slice(0, 8)}`);
    }

  } catch (err) {
    ctx.incrementFailedCount();
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[codex-dario] Request error: ${redactSecrets(msg)}`);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Bad gateway', message: redactSecrets(msg) }));
  } finally {
    ctx.queue.release();
    ctx.decrementConcurrent();
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function authenticateRequest(headers: IncomingMessage['headers'], apiKeyBuf: Buffer | null): boolean {
  if (!apiKeyBuf) return true;
  const provided = (headers['x-api-key'] as string)
    || (headers.authorization as string)?.replace(/^Bearer\s+/i, '');
  if (provided) {
    const providedBuf = Buffer.from(provided);
    if (providedBuf.length === apiKeyBuf.length && timingSafeEqual(providedBuf, apiKeyBuf)) return true;
  }
  return false;
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;

    const timeout = setTimeout(() => {
      reject(new Error('Body read timeout'));
    }, 30_000);

    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > maxBytes) {
        clearTimeout(timeout);
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      clearTimeout(timeout);
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });

    req.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
};
