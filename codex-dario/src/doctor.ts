/**
 * codex-dario doctor — health report aggregator.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, platform, arch, release } from 'node:os';
import { CODEX_TEMPLATE } from './codex-template.js';
import { describeTemplate, detectDrift, findInstalledCodex, SUPPORTED_CODEX_RANGE, compareVersions } from './live-fingerprint.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'info';

export interface Check {
  status: CheckStatus;
  label: string;
  detail: string;
}

export function formatChecks(checks: Check[]): string {
  const prefix: Record<CheckStatus, string> = {
    ok: '[ OK ]', warn: '[WARN]', fail: '[FAIL]', info: '[INFO]',
  };
  const labelWidth = checks.reduce((n, c) => Math.max(n, c.label.length), 0);
  return checks.map(c => `  ${prefix[c.status]}  ${c.label.padEnd(labelWidth)}  ${c.detail}`).join('\n');
}

export function exitCodeFor(checks: Check[]): number {
  return checks.some(c => c.status === 'fail') ? 1 : 0;
}

export async function runChecks(): Promise<Check[]> {
  const checks: Check[] = [];

  // codex-dario version
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
    checks.push({ status: 'info', label: 'codex-dario', detail: `v${pkg.version}` });
  } catch {
    checks.push({ status: 'warn', label: 'codex-dario', detail: 'version unknown' });
  }

  // Node
  checks.push({ status: 'info', label: 'Node', detail: process.version });

  // Platform
  checks.push({ status: 'info', label: 'Platform', detail: `${platform()} ${arch()} (${release()})` });

  // Codex binary
  const codex = findInstalledCodex();
  if (codex.path && codex.version) {
    checks.push({ status: 'ok', label: 'Codex CLI', detail: `v${codex.version} at ${codex.path}` });
  } else {
    checks.push({ status: 'warn', label: 'Codex CLI', detail: 'not found on PATH — falling back to bundled template' });
  }

  // Template
  checks.push({
    status: CODEX_TEMPLATE._source === 'live' ? 'ok' : 'info',
    label: 'Template',
    detail: describeTemplate(CODEX_TEMPLATE),
  });

  // OAuth
  try {
    const { getStatus } = await import('./oauth.js');
    const s = await getStatus();
    if (!s.authenticated) {
      checks.push({ status: 'fail', label: 'OAuth', detail: `not authenticated (${s.status})` });
    } else {
      checks.push({ status: 'ok', label: 'OAuth', detail: `${s.status} (expires in ${s.expiresIn})` });
    }
  } catch (err) {
    checks.push({ status: 'warn', label: 'OAuth', detail: `check failed: ${(err as Error).message}` });
  }

  // Home dir
  checks.push({ status: 'info', label: 'Home', detail: join(homedir(), '.codex-dario') });

  return checks;
}
