import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { healthzStatusCode } from '../dist/proxy.js';

test('healthz returns 200 only when overall status is healthy', () => {
  assert.equal(healthzStatusCode('healthy'), 200);
  assert.equal(healthzStatusCode('degraded'), 503);
  assert.equal(healthzStatusCode('down'), 503);
});

test('OAuth token endpoint calls go through the outbound token fetch helper', () => {
  for (const file of ['src/oauth.ts', 'src/accounts.ts']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf-8');
    assert.doesNotMatch(source, /\bfetch\(\s*cfg\.tokenUrl\b/, `${file} still directly fetches cfg.tokenUrl`);
  }
});

test('proxy refreshes H2 outbound state when live template state changes', () => {
  const source = readFileSync(new URL('../src/proxy.ts', import.meta.url), 'utf-8');
  assert.match(source, /h2Settings\s*:/, 'h2Config should explicitly carry template h2_settings');
  assert.match(source, /h2Config\s*=\s*buildH2ConfigFromTemplate\(\)/, 'h2Config should be rebuildable after template reload');
  assert.match(source, /closeAllSessions\(\)/, 'template or JA3 changes should drop stale H2 sessions');
});

test('h2 outbound reuses TLS session tickets on reconnect', () => {
  const source = readFileSync(new URL('../src/h2-outbound.ts', import.meta.url), 'utf-8');
  assert.match(source, /tlsSessionTickets\s*=\s*new Map<string, Buffer>/, 'should maintain a TLS session ticket cache');
  assert.match(source, /session:\s*getCachedTlsSessionTicket\(/, 'tls.connect should receive cached session ticket');
  assert.match(source, /socket\.on\('session'/, 'new TLS session tickets should be captured from TLSSocket');
  assert.match(source, /rejectUnauthorized:\s*process\.env\.NODE_TLS_REJECT_UNAUTHORIZED/, 'local capture must be able to disable cert verification explicitly');
});

test('local H2 capture tooling is configured', () => {
  const proxySource = readFileSync(new URL('../src/proxy.ts', import.meta.url), 'utf-8');
  assert.match(proxySource, /process\.env\.DARIO_ANTHROPIC_API/, 'proxy should allow local capture upstream override');

  const captureServer = readFileSync(new URL('../scripts/h2-capture-server.mjs', import.meta.url), 'utf-8');
  assert.match(captureServer, /createSecureServer/, 'capture server should terminate HTTPS/H2');
  assert.match(captureServer, /remoteSettings/, 'capture server should record peer H2 SETTINGS');
  assert.match(captureServer, /allowHTTP1:\s*true/, 'capture server should record Claude Code HTTP/1.1 fallback attempts');

  const runner = readFileSync(new URL('../scripts/run-local-h2-capture.mjs', import.meta.url), 'utf-8');
  assert.match(runner, /DARIO_ANTHROPIC_API/, 'local runner should point dario at capture server');
  assert.match(runner, /ANTHROPIC_BASE_URL/, 'local runner should point Claude Code at capture server');
  assert.match(runner, /ANTHROPIC_API_KEY/, 'local runner should force Claude Code into API/base-url mode');
});
