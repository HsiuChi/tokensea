/**
 * TLS sidecar — a Node.js child process that handles outbound HTTPS
 * connections to api.anthropic.com using Node.js's default TLS (OpenSSL).
 *
 * When dario runs on Bun, its outbound TLS fingerprint is BoringSSL-shaped,
 * which differs from real Claude Code's OpenSSL fingerprint. This sidecar
 * bridges the gap: since it runs on Node.js, the TLS ClientHello matches CC.
 *
 * Protocol: Unix Domain Socket + NDJSON (one JSON object per line).
 *
 * Main → Sidecar messages:
 *   - {"type":"request","id":"uuid","method":"POST","url":"https://...","headers":{...},"body":"<base64>","timeout":300000}
 *   - {"type":"abort","id":"uuid"}
 *   - {"type":"shutdown"}
 *
 * Sidecar → Main messages:
 *   - {"type":"ready"}
 *   - {"type":"headers","id":"uuid","status":200,"headers":{...}}
 *   - {"type":"chunk","id":"uuid","data":"<base64>"}
 *   - {"type":"end","id":"uuid"}
 *   - {"type":"error","id":"uuid","message":"..."}
 *
 * Key design decisions:
 *   - HTTP/1.1 only (https.request, NOT http2) — CC uses HTTP/1.1 via undici.
 *   - No manual TLS config (no ciphers/sigalgs/ecdhCurve) — Node.js defaults
 *     already match CC. Manual config could introduce errors.
 *   - keep-alive Agent for connection reuse (matches CC behavior).
 *   - SSE streaming: chunks are forwarded as they arrive, not buffered.
 */

'use strict';

const https = require('https');
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');

const VERBOSE = process.env.DARIO_SIDECAR_VERBOSE === '1';

function log(msg) {
  if (VERBOSE) {
    try { process.stderr.write(`[tls-sidecar] ${msg}\n`); } catch (_) { /* noop */ }
  }
}

// ---------------------------------------------------------------------------
// Keep-alive agent — reuses TLS connections like real CC does
// ---------------------------------------------------------------------------
const agent = new https.Agent({
  keepAlive: true,
  maxSockets: 10,
  timeout: 300_000, // 5 min — matches Anthropic SDK default
});

// ---------------------------------------------------------------------------
// Pending requests — tracks in-flight requests by id
// ---------------------------------------------------------------------------
const pending = new Map(); // id → { req, res?, sock }

// ---------------------------------------------------------------------------
// Socket server
// ---------------------------------------------------------------------------
let server = null;
let socketPath = null;

function cleanup() {
  try { if (socketPath && fs.existsSync(socketPath)) fs.unlinkSync(socketPath); } catch (_) { /* noop */ }
}

function handleMessage(msg, sock) {
  switch (msg.type) {
    case 'request':
      handleRequest(msg, sock);
      break;
    case 'abort':
      handleAbort(msg);
      break;
    case 'shutdown':
      handleShutdown(sock);
      break;
    default:
      log(`unknown message type: ${msg.type}`);
  }
}

// HTTP headers whose multiple values MUST NOT be joined by comma.
// per RFC 7230 §3.2.6, set-cookie values may contain commas in their
// content (expires date), so joining them corrupts the value.
const MULTI_VALUE_HEADERS = new Set(['set-cookie']);

function handleRequest(msg, sock) {
  const { id, method, url, headers, body, timeout: reqTimeout } = msg;

  if (pending.has(id)) {
    log(`duplicate request id: ${id}`);
    return;
  }

  log(`request ${id} ${method} ${url}`);

  // Decode body from base64
  let bodyBuf = null;
  if (body) {
    bodyBuf = Buffer.from(body, 'base64');
  }

  // Build request options
  const parsedUrl = new URL(url);
  const options = {
    method,
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || 443,
    path: parsedUrl.pathname + parsedUrl.search,
    headers,
    agent,
  };

  const req = https.request(options, (res) => {
    // Update pending entry with the response reference
    const entry = pending.get(id);
    if (entry) {
      entry.res = res;
    }

    // Send headers back — handle multi-value headers correctly
    const respHeaders = {};
    for (const [k, v] of Object.entries(res.headers)) {
      if (typeof v === 'string') {
        respHeaders[k] = v;
      } else if (Array.isArray(v)) {
        // RFC 7230: set-cookie values MUST NOT be comma-joined.
        // For Anthropic's API this is rare, but be safe: take the
        // first value for set-cookie, comma-join everything else.
        if (MULTI_VALUE_HEADERS.has(k.toLowerCase())) {
          respHeaders[k] = v[0];
        } else {
          respHeaders[k] = v.join(', ');
        }
      }
    }

    send(sock, { type: 'headers', id, status: res.statusCode, headers: respHeaders });

    // Stream response chunks back
    res.on('data', (chunk) => {
      send(sock, { type: 'chunk', id, data: chunk.toString('base64') });
    });

    res.on('end', () => {
      send(sock, { type: 'end', id });
      pending.delete(id);
      log(`request ${id} ended`);
    });

    res.on('error', (err) => {
      send(sock, { type: 'error', id, message: err.message });
      pending.delete(id);
      log(`request ${id} response error: ${err.message}`);
    });
  });

  req.on('error', (err) => {
    send(sock, { type: 'error', id, message: err.message });
    pending.delete(id);
    log(`request ${id} error: ${err.message}`);
  });

  // Apply per-request timeout if provided
  if (typeof reqTimeout === 'number' && reqTimeout > 0) {
    req.setTimeout(reqTimeout, () => {
      req.destroy(new Error('request timeout'));
    });
  } else {
    req.on('timeout', () => {
      req.destroy(new Error('request timeout'));
    });
  }

  // Register in pending IMMEDIATELY — before req.end() — so that
  // abort messages arriving before the response callback can find
  // the request and destroy it. The req object is already valid
  // for destroy() at this point.
  pending.set(id, { req, sock });

  if (bodyBuf) {
    req.write(bodyBuf);
  }
  req.end();
}

function handleAbort(msg) {
  const { id } = msg;
  const entry = pending.get(id);
  if (entry) {
    log(`abort ${id}`);
    try { entry.req.destroy(); } catch (_) { /* noop */ }
    pending.delete(id);
  }
}

function handleShutdown(sock) {
  log('shutdown received');
  // Destroy all pending requests
  for (const [id, entry] of pending) {
    try { entry.req.destroy(); } catch (_) { /* noop */ }
  }
  pending.clear();
  // Close socket and server
  try { sock?.end(); } catch (_) { /* noop */ }
  cleanup();
  if (server) {
    server.close(() => {
      process.exit(0);
    });
    // Force exit after 2s if server.close() hangs
    setTimeout(() => process.exit(0), 2000);
  } else {
    process.exit(0);
  }
}

function send(sock, obj) {
  try {
    sock.write(JSON.stringify(obj) + '\n');
  } catch (err) {
    log(`send error: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Main — listen on Unix socket
// ---------------------------------------------------------------------------
function main() {
  // Socket path from env or generate a temp one
  socketPath = process.env.DARIO_SIDECAR_SOCK;
  if (!socketPath) {
    const tmpDir = os.tmpdir();
    const rand = Math.random().toString(36).slice(2, 10);
    socketPath = path.join(tmpDir, `dario-sidecar-${rand}.sock`);
  }

  // Clean up stale socket file
  cleanup();

  server = net.createServer((sock) => {
    log('client connected');
    let buffer = '';

    sock.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);
          handleMessage(msg, sock);
        } catch (err) {
          log(`parse error: ${err.message}`);
        }
      }
    });

    sock.on('error', (err) => {
      log(`socket error: ${err.message}`);
    });

    sock.on('close', () => {
      log('client disconnected');
      // Destroy all pending requests — the main process is gone
      for (const [id, entry] of pending) {
        try { entry.req.destroy(); } catch (_) { /* noop */ }
      }
      pending.clear();
    });
  });

  server.listen(socketPath, () => {
    log(`listening on ${socketPath}`);

    // Signal ready to parent process via stdout.
    // The parent reads stdout to detect the ready message.
    try {
      process.stdout.write(JSON.stringify({ type: 'ready', socketPath }) + '\n');
    } catch (_) { /* noop */ }
  });

  server.on('error', (err) => {
    log(`server error: ${err.message}`);
    cleanup();
    process.exit(1);
  });

  // Handle parent process exit
  process.on('SIGHUP', () => {
    log('SIGHUP — parent likely exited');
    handleShutdown(null);
  });

  process.on('SIGTERM', () => {
    log('SIGTERM received');
    handleShutdown(null);
  });

  process.on('SIGINT', () => {
    log('SIGINT received');
    handleShutdown(null);
  });
}

main();
