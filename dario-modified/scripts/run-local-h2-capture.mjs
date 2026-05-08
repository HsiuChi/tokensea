#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, '..');
const captureDir = resolve(process.env.CAPTURE_DIR || resolve(projectDir, 'capture'));
const capturePort = Number(process.env.CAPTURE_PORT || 9443);
const darioPort = Number(process.env.DARIO_CAPTURE_PORT || 3459);
const darioRuntime = process.env.DARIO_CAPTURE_RUNTIME || 'node';
const captureUrl = `https://127.0.0.1:${capturePort}`;

mkdirSync(captureDir, { recursive: true });

function spawnChild(name, command, args, options = {}) {
  const env = { ...process.env };
  for (const [key, value] of Object.entries(options.env || {})) {
    if (value !== undefined) env[key] = value;
  }
  const child = spawn(command, args, {
    cwd: projectDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  child.on('error', (err) => {
    process.stderr.write(`[${name}] failed to start: ${err.message}\n`);
  });
  return child;
}

function waitForOutput(child, pattern, timeoutMs, name) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`${name} did not emit ${pattern} within ${timeoutMs}ms`));
    }, timeoutMs);
    function onData(chunk) {
      if (pattern.test(chunk.toString())) {
        cleanup();
        resolve();
      }
    }
    function onExit(code) {
      cleanup();
      reject(new Error(`${name} exited before ready (code ${code})`));
    }
    function cleanup() {
      clearTimeout(timeout);
      child.stdout.off('data', onData);
      child.stderr.off('data', onData);
      child.off('exit', onExit);
    }
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', onExit);
  });
}

async function waitForExit(child, timeoutMs, name) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ timedOut: true, code: null });
    }, timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(timeout);
      resolve({ timedOut: false, code });
    });
    child.on('error', () => {
      clearTimeout(timeout);
      resolve({ timedOut: false, code: null });
    });
  }).then((result) => {
    if (result.timedOut) {
      console.log(`[${name}] timed out; process was stopped after trace window`);
    }
    return result;
  });
}

async function withCapture(label, fn) {
  const server = spawnChild(`capture:${label}`, process.execPath, ['scripts/h2-capture-server.mjs'], {
    env: {
      CAPTURE_LABEL: label,
      CAPTURE_DIR: captureDir,
      CAPTURE_PORT: String(capturePort),
    },
  });
  await waitForOutput(server, /listening https:\/\//, 5000, `capture:${label}`);
  try {
    await fn();
  } finally {
    server.kill('SIGTERM');
    await waitForExit(server, 2000, `capture:${label}`);
  }
}

async function captureClaudeCode() {
  await withCapture('cc', async () => {
    const child = spawnChild('cc', 'claude', [
      '--debug', 'api',
      '--debug-file', resolve(captureDir, 'cc-debug.log'),
      '--print',
      '-p',
      'hi',
    ], {
      env: {
        ANTHROPIC_BASE_URL: captureUrl,
        ANTHROPIC_API_KEY: 'sk-dario-fingerprint-capture',
        CLAUDE_NONINTERACTIVE: '1',
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
      },
    });
    await waitForExit(child, 20000, 'cc');
  });
}

async function captureDario() {
  await withCapture('dario', async () => {
    const darioCommand = darioRuntime === 'bun' ? (process.env.BUN_BIN || 'bun') : process.execPath;
    const darioArgs = darioRuntime === 'bun' ? ['run', 'dist/cli.js'] : ['dist/cli.js'];
    const dario = spawnChild('dario', darioCommand, [
      ...darioArgs,
      'proxy',
      `--host=127.0.0.1`,
      `--port=${darioPort}`,
      '--no-live-capture',
    ], {
      env: {
        DARIO_ANTHROPIC_API: captureUrl,
        DARIO_API_KEY: 'capture-local',
        DARIO_OAUTH_ACCESS_TOKEN: 'capture-access-token',
        DARIO_OAUTH_REFRESH_TOKEN: 'capture-refresh-token',
        DARIO_OAUTH_EXPIRES_AT: '4102444800000',
        DARIO_OAUTH_SCOPES: 'user:inference,user:profile,user:sessions:claude_code',
        DARIO_NO_LIVE_CAPTURE: '1',
        DARIO_NO_BUN: darioRuntime === 'node' ? '1' : undefined,
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
      },
    });
    await waitForOutput(dario, /dario .*http:\/\/localhost:|dario .*http:\/\/127\.0\.0\.1:/, 10000, 'dario');
    try {
      const res = await fetch(`http://127.0.0.1:${darioPort}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': 'capture-local',
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 16,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });
      console.log(`[runner] dario request status ${res.status}`);
      await res.text().catch(() => '');
    } finally {
      dario.kill('SIGTERM');
      await waitForExit(dario, 3000, 'dario');
    }
  });
}

async function main() {
  console.log(`[runner] capture dir: ${captureDir}`);
  console.log(`[runner] capture upstream: ${captureUrl}`);
  console.log(`[runner] dario runtime: ${darioRuntime}`);
  console.log('[runner] running Claude Code capture');
  await captureClaudeCode();
  console.log('[runner] running dario capture');
  await captureDario();
  console.log('[runner] trace outputs:');
  for (const file of ['cc.jsonl', 'dario.jsonl']) {
    const path = resolve(captureDir, file);
    if (existsSync(path) && statSync(path).size > 0) {
      console.log(`  ${path}`);
    } else {
      console.log(`  ${path} (not written; capture client did not reach local H2 server)`);
    }
  }
}

main().catch((err) => {
  console.error(`[runner] ${err.message}`);
  process.exitCode = 1;
});
