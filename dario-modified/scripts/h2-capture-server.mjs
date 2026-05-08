#!/usr/bin/env node
import { createSecureServer } from 'node:http2';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, '..');
const captureDir = resolve(process.env.CAPTURE_DIR || resolve(projectDir, 'capture'));
const label = process.env.CAPTURE_LABEL || 'capture';
const host = process.env.CAPTURE_HOST || '127.0.0.1';
const port = Number(process.env.CAPTURE_PORT || 9443);
const certDir = resolve(captureDir, 'certs');
const traceFile = resolve(captureDir, `${label}.jsonl`);

mkdirSync(certDir, { recursive: true });
mkdirSync(captureDir, { recursive: true });
writeFileSync(traceFile, '');

const keyFile = resolve(certDir, 'h2-capture.key');
const certFile = resolve(certDir, 'h2-capture.crt');

function ensureCertificate() {
  if (existsSync(keyFile) && existsSync(certFile)) return;
  const result = spawnSync('openssl', [
    'req',
    '-x509',
    '-newkey', 'rsa:2048',
    '-nodes',
    '-keyout', keyFile,
    '-out', certFile,
    '-days', '7',
    '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost,DNS:h2-capture,IP:127.0.0.1',
  ], { stdio: 'ignore' });
  if (result.status !== 0) {
    throw new Error('failed to generate self-signed cert with openssl');
  }
}

function log(event, data = {}) {
  appendFileSync(traceFile, `${JSON.stringify({
    ts: new Date().toISOString(),
    label,
    event,
    ...data,
  })}\n`);
}

function normalizedHeaders(headers) {
  return Object.entries(headers).map(([name, value]) => [name, value]);
}

function responseBody() {
  return JSON.stringify({
    id: `msg_capture_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-5',
    content: [{ type: 'text', text: 'capture-ok' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  });
}

ensureCertificate();

const server = createSecureServer({
  key: await import('node:fs').then(fs => fs.readFileSync(keyFile)),
  cert: await import('node:fs').then(fs => fs.readFileSync(certFile)),
  allowHTTP1: true,
  ALPNProtocols: ['h2', 'http/1.1'],
});

server.on('session', (session) => {
  const socket = session.socket;
  log('session', {
    alpnProtocol: socket.alpnProtocol,
    remoteAddress: socket.remoteAddress,
    remotePort: socket.remotePort,
    localAddress: socket.localAddress,
    localPort: socket.localPort,
  });
  log('remoteSettings.initial', { remoteSettings: session.remoteSettings });
  session.on('remoteSettings', (remoteSettings) => {
    log('remoteSettings', { remoteSettings });
  });
  session.on('localSettings', (localSettings) => {
    log('localSettings', { localSettings });
  });
  session.on('goaway', (errorCode, lastStreamID, opaqueData) => {
    log('goaway', {
      errorCode,
      lastStreamID,
      opaqueData: opaqueData ? opaqueData.toString('hex') : null,
    });
  });
  session.on('close', () => log('session.close'));
  session.on('error', (err) => log('session.error', { message: err.message }));
});

server.on('tlsClientError', (err) => {
  log('tlsClientError', { message: err.message, code: err.code ?? null });
});

server.on('stream', (stream, headers) => {
  const streamId = stream.id;
  const startedAt = process.hrtime.bigint();
  let bodyBytes = 0;

  log('stream.start', {
    streamId,
    headers: normalizedHeaders(headers),
    state: stream.state,
  });

  stream.on('data', (chunk) => {
    bodyBytes += chunk.length;
    log('stream.data', {
      streamId,
      bytes: chunk.length,
      totalBytes: bodyBytes,
      sinceStartMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
    });
  });

  stream.on('end', () => {
    log('stream.end', {
      streamId,
      totalBytes: bodyBytes,
      sinceStartMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
    });
    const body = responseBody();
    stream.respond({
      ':status': 200,
      'content-type': 'application/json',
      'request-id': `req_capture_${Date.now()}`,
    });
    stream.end(body);
  });

  stream.on('close', () => log('stream.close', { streamId }));
  stream.on('error', (err) => log('stream.error', { streamId, message: err.message }));
});

server.on('request', (req, res) => {
  if (req.httpVersionMajor >= 2) return;
  const startedAt = process.hrtime.bigint();
  let bodyBytes = 0;
  log('h1.request.start', {
    method: req.method,
    url: req.url,
    httpVersion: req.httpVersion,
    headers: Object.entries(req.headers),
    rawHeaders: req.rawHeaders,
  });
  req.on('data', (chunk) => {
    bodyBytes += chunk.length;
    log('h1.request.data', {
      bytes: chunk.length,
      totalBytes: bodyBytes,
      sinceStartMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
    });
  });
  req.on('end', () => {
    log('h1.request.end', {
      totalBytes: bodyBytes,
      sinceStartMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
    });
    res.writeHead(200, {
      'content-type': 'application/json',
      'request-id': `req_capture_${Date.now()}`,
    });
    res.end(responseBody());
  });
});

server.listen(port, host, () => {
  console.log(`[h2-capture] listening https://${host}:${port}`);
  console.log(`[h2-capture] trace ${traceFile}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
