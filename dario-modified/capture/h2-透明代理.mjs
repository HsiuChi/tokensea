/**
 * H2 transparent proxy capture tool — fixed version.
 *
 * Sits between CC and api.anthropic.com, forwarding TLS traffic
 * and recording all H2 frames to JSONL files.
 *
 * Usage:
 *   node capture/h2-透明代理.mjs
 *
 * Then:
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 \
 *   ANTHROPIC_BASE_URL=https://127.0.0.1:9443 \
 *   claude -p "hi" --max-turns 1
 */

import { createSecureServer } from 'node:http2';
import { connect as h2Connect } from 'node:http2';
import { readFileSync, createWriteStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CERT_DIR = join(__dirname, 'certs');
const OUT_DIR = __dirname;

const CERT = readFileSync(join(CERT_DIR, 'h2-capture.crt'), 'utf-8');
const KEY = readFileSync(join(CERT_DIR, 'h2-capture.key'), 'utf-8');

const UPSTREAM_HOST = 'api.anthropic.com';
const LOCAL_PORT = 9443;

const ccStream = createWriteStream(join(OUT_DIR, 'proxy-cc.jsonl'), { flags: 'w' });
const upstreamStream = createWriteStream(join(OUT_DIR, 'proxy-upstream.jsonl'), { flags: 'w' });

function logCc(obj) {
  ccStream.write(JSON.stringify({ ts: new Date().toISOString(), ...obj }) + '\n');
}

function logUpstream(obj) {
  upstreamStream.write(JSON.stringify({ ts: new Date().toISOString(), ...obj }) + '\n');
}

function instrumentSession(session, logFn) {
  try {
    const ls = session.localSettings;
    logFn({ event: 'localSettings', localSettings: { ...ls } });
  } catch { /* */ }
  try {
    const rs = session.remoteSettings;
    logFn({ event: 'remoteSettings', remoteSettings: { ...rs } });
  } catch { /* */ }

  session.on('remoteSettings', (settings) => {
    logFn({ event: 'remoteSettings.update', remoteSettings: { ...settings } });
  });
  session.on('localSettings', (settings) => {
    logFn({ event: 'localSettings.update', localSettings: { ...settings } });
  });
  session.on('ping', (payload) => {
    logFn({ event: 'ping', payload: payload.toString('hex') });
  });
  session.on('goaway', (errorCode, lastStreamID, opaqueData) => {
    logFn({ event: 'goaway', errorCode, lastStreamID });
  });
  session.on('close', () => {
    logFn({ event: 'session.close' });
  });
  session.on('error', (err) => {
    logFn({ event: 'session.error', error: err.message });
  });
}

// ── Upstream session pool ───────────────────────────────────────

let upstreamSession = null;

function getUpstreamSession() {
  if (upstreamSession && !upstreamSession.closed && !upstreamSession.destroyed) {
    return upstreamSession;
  }
  const session = h2Connect(`https://${UPSTREAM_HOST}`);
  instrumentSession(session, logUpstream);

  session.on('connect', () => {
    logUpstream({ event: 'session.connect' });
    try {
      const ls = session.localSettings;
      logUpstream({ event: 'localSettings.afterConnect', localSettings: { ...ls } });
    } catch { /* */ }
    try {
      const rs = session.remoteSettings;
      logUpstream({ event: 'remoteSettings.afterConnect', remoteSettings: { ...rs } });
    } catch { /* */ }
  });

  session.on('error', (err) => {
    logUpstream({ event: 'session.error', error: err.message });
    if (upstreamSession === session) upstreamSession = null;
  });

  session.on('close', () => {
    if (upstreamSession === session) upstreamSession = null;
  });

  upstreamSession = session;
  return session;
}

// ── Local H2 server ─────────────────────────────────────────────

const server = createSecureServer({ key: KEY, cert: CERT, allowHTTP1: true });

server.on('session', (clientSession) => {
  logCc({ event: 'session.connect', alpnProtocol: clientSession.alpnProtocol ?? 'unknown' });
  instrumentSession(clientSession, logCc);
});

// Register request handler on the SERVER, not inside session event
server.on('request', (req, res) => {
  const startTime = Date.now();

  // Capture CC request headers
  const reqHeaders = [];
  for (const [k, v] of Object.entries(req.headers)) {
    if (k.startsWith(':')) continue;
    reqHeaders.push([k, typeof v === 'string' ? v : (Array.isArray(v) ? v.join(',') : String(v))]);
  }

  logCc({
    event: 'stream.request',
    method: req.method,
    url: req.url,
    headers: reqHeaders,
    httpVersion: req.httpVersion,
  });

  // Collect request body
  const bodyChunks = [];
  req.on('data', (chunk) => bodyChunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(bodyChunks);
    logCc({
      event: 'stream.body',
      bytes: body.length,
      sinceStartMs: Date.now() - startTime,
    });

    // Get or create upstream session
    const upSession = getUpstreamSession();

    // Build upstream request headers
    const upstreamHeaders = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (k === ':method') upstreamHeaders[':method'] = v;
      else if (k === ':path') upstreamHeaders[':path'] = v;
      else if (k === ':scheme') upstreamHeaders[':scheme'] = 'https';
      else if (k === ':authority') upstreamHeaders[':authority'] = UPSTREAM_HOST;
      else if (k === 'host') { /* skip, use :authority */ }
      else if (k.startsWith(':')) { /* skip other pseudo-headers */ }
      else upstreamHeaders[k] = v;
    }

    logUpstream({
      event: 'stream.request',
      method: upstreamHeaders[':method'],
      path: upstreamHeaders[':path'],
      headers: Object.entries(upstreamHeaders)
        .filter(([k]) => !k.startsWith(':'))
        .map(([k, v]) => [k, typeof v === 'string' ? v : String(v)]),
    });

    // Send to upstream
    const upstreamReq = upSession.request(upstreamHeaders, { waitForTrailers: false });

    if (body.length > 0) {
      upstreamReq.write(body);
    }
    upstreamReq.end();

    logUpstream({
      event: 'stream.body',
      bytes: body.length,
    });

    // Capture upstream response
    upstreamReq.on('response', (upHeaders) => {
      const status = upHeaders[':status'];
      const resHeaders = [];
      for (const [k, v] of Object.entries(upHeaders)) {
        if (k.startsWith(':')) continue;
        resHeaders.push([k, typeof v === 'string' ? v : String(v)]);
      }

      logUpstream({
        event: 'stream.response',
        status,
        headers: resHeaders,
      });

      // Forward to CC
      const resHeaderObj = {};
      for (const [k, v] of Object.entries(upHeaders)) {
        if (k.startsWith(':')) continue;
        if (typeof v === 'string') resHeaderObj[k] = v;
        else if (Array.isArray(v)) resHeaderObj[k] = v.join(', ');
      }
      res.writeHead(status, resHeaderObj);
    });

    // Stream response body
    let responseBytes = 0;
    upstreamReq.on('data', (chunk) => {
      responseBytes += chunk.length;
      res.write(chunk);
    });

    upstreamReq.on('end', () => {
      logUpstream({
        event: 'stream.response.end',
        totalBytes: responseBytes,
        sinceStartMs: Date.now() - startTime,
      });
      logCc({
        event: 'stream.response.end',
        totalBytes: responseBytes,
        sinceStartMs: Date.now() - startTime,
      });
      res.end();
    });

    upstreamReq.on('error', (err) => {
      logUpstream({ event: 'stream.error', error: err.message });
      logCc({ event: 'stream.error', error: err.message });
      try {
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      } catch { /* response already started */ }
    });
  });

  req.on('error', (err) => {
    logCc({ event: 'stream.error', error: err.message });
  });
});

server.on('error', (err) => {
  console.error(`[proxy] Server error: ${err.message}`);
});

server.listen(LOCAL_PORT, '127.0.0.1', () => {
  console.log(`[proxy] H2 transparent proxy listening on https://127.0.0.1:${LOCAL_PORT}`);
  console.log(`[proxy] Forwarding to https://${UPSTREAM_HOST}`);
  console.log(`[proxy] Run CC with:`);
  console.log(`[proxy]   NODE_TLS_REJECT_UNAUTHORIZED=0 ANTHROPIC_BASE_URL=https://127.0.0.1:${LOCAL_PORT} claude -p "hi" --max-turns 1`);
});

process.on('SIGINT', () => {
  console.log('\n[proxy] Shutting down...');
  ccStream.end();
  upstreamStream.end();
  server.close();
  if (upstreamSession) upstreamSession.close();
  process.exit(0);
});
