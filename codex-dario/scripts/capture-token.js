#!/usr/bin/env node
/**
 * codex-dario Token Capture — intercepts a Codex CLI request to capture
 * the OAuth access_token, then optionally pushes it to a remote server.
 *
 * Usage:
 *   node capture-token.js                    # Capture and print token
 *   node capture-token.js --push lisa        # Capture and push to lisa
 *   node capture-token.js --push lisa ~/tokensea  # Custom remote dir
 *
 * Cron (refresh weekly, tokens last ~10 days):
 *   0 3 * * 1 node /path/to/codex-dario/scripts/capture-token.js --push lisa
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { execSync } from 'node:child_process';

const CAPTURE_PORT = 19882;
const TIMEOUT_MS = 30000;

const args = process.argv.slice(2);
const pushIdx = args.indexOf('--push');
const shouldPush = pushIdx !== -1;
const remoteHost = args[pushIdx + 1] || 'lisa';
const remoteDir = args[pushIdx + 2] || '~/tokensea';

async function captureToken() {
  return new Promise((resolve, reject) => {
    let captured = null;

    const server = createServer((req, res) => {
      const auth = req.headers['authorization'];
      const accountId = req.headers['chatgpt-account-id'];

      if (auth && auth.startsWith('Bearer ') && !captured) {
        const token = auth.substring(7);
        let expiresAt = 0;
        let chatgptAccountId = accountId || '';
        let planType = 'unknown';

        try {
          const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
          expiresAt = payload.exp * 1000;
          planType = payload['https://api.openai.com/auth']?.chatgpt_plan_type || 'unknown';
          chatgptAccountId = payload['https://api.openai.com/auth']?.chatgpt_account_id || accountId || '';
        } catch {}

        captured = { accessToken: token, expiresAt, chatgptAccountId, planType };
      }

      // Return a minimal success response so Codex CLI exits cleanly
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'cap', object: 'response', status: 'completed',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }],
        model: 'o3', created_at: Date.now() / 1000,
      }));
    });

    server.listen(CAPTURE_PORT, '127.0.0.1', () => {
      console.error(`[capture] Listening on port ${CAPTURE_PORT}`);
      console.error('[capture] Triggering Codex CLI request...');

      const codex = spawn('codex', [
        '-c', `chatgpt_base_url=http://127.0.0.1:${CAPTURE_PORT}`,
        'exec', 'say hi',
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      codex.stdin.end();

      let stdout = '';
      let stderr = '';
      codex.stdout.on('data', (d) => { stdout += d; });
      codex.stderr.on('data', (d) => { stderr += d; });

      codex.on('exit', (code) => {
        server.close();
        if (captured) {
          resolve(captured);
        } else {
          reject(new Error(`No token captured (codex exit code ${code}). stderr: ${stderr.slice(0, 500)}`));
        }
      });
    });

    server.on('error', (err) => {
      reject(new Error(`Capture server error: ${err.message}`));
    });

    setTimeout(() => {
      server.close();
      if (!captured) {
        reject(new Error(`Timeout after ${TIMEOUT_MS / 1000}s — no request from Codex CLI`));
      }
    }, TIMEOUT_MS);
  });
}

async function pushToRemote(token) {
  const { accessToken, expiresAt, chatgptAccountId } = token;

  console.log(`[push] Pushing token to ${remoteHost}:${remoteDir}...`);

  // Write a temp script on the remote and execute it
  const script = `#!/bin/bash
set -e
cd ${remoteDir}
sed -i 's|^CODEX_DARIO_1_OAUTH_ACCESS_TOKEN=.*|CODEX_DARIO_1_OAUTH_ACCESS_TOKEN=${accessToken}|' .env
sed -i 's|^CODEX_DARIO_1_OAUTH_EXPIRES_AT=.*|CODEX_DARIO_1_OAUTH_EXPIRES_AT=${expiresAt}|' .env
sed -i 's|^CODEX_DARIO_1_CHATGPT_ACCOUNT_ID=.*|CODEX_DARIO_1_CHATGPT_ACCOUNT_ID=${chatgptAccountId}|' .env
docker compose up -d codex-dario-1
sleep 8
docker exec tokensea-codex-dario-1 curl -s http://localhost:3457/healthz
`;

  try {
    // Pipe script to remote bash via stdin to avoid quoting issues
    const { execSync } = await import('node:child_process');
    const result = execSync(`ssh ${remoteHost} 'bash -s'`, {
      input: script,
      encoding: 'utf-8',
      timeout: 60000,
    });
    console.log('[push] Remote health:', result.trim());
    return true;
  } catch (err) {
    console.error(`[push] Failed: ${err.message}`);
    return false;
  }
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  try {
    const token = await captureToken();

    const expiryDate = new Date(token.expiresAt).toISOString();
    const remainingHours = ((token.expiresAt - Date.now()) / 3600000).toFixed(1);

    console.log('[capture] Token captured successfully!');
    console.log(`  Plan: ${token.planType}`);
    console.log(`  Account: ${token.chatgptAccountId}`);
    console.log(`  Expires: ${expiryDate} (${remainingHours}h remaining)`);

    if (shouldPush) {
      const ok = await pushToRemote(token);
      if (ok) {
        console.log(`[push] Token refreshed on ${remoteHost}. Valid for ${remainingHours}h.`);
      } else {
        console.error('[push] Failed to push token.');
        process.exit(1);
      }
    } else {
      // Print JSON to stdout for scripting
      console.log(JSON.stringify(token));
    }
  } catch (err) {
    console.error(`[capture] ERROR: ${err.message}`);
    console.error('[capture] Make sure Codex CLI is installed and logged in:');
    console.error('  codex login status  → should show "Logged in using ChatGPT"');
    process.exit(1);
  }
}

main();
