/**
 * Multi-account credential storage for codex-dario.
 *
 * Accounts live at `~/.codex-dario/accounts/<alias>.json`.
 * When 2+ accounts exist, the proxy activates pool mode.
 */

import { readFile, writeFile, mkdir, readdir, unlink, rename } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID, randomBytes } from 'node:crypto';
import { redactSecrets } from './redact.js';

const CODEX_DARIO_DIR = join(homedir(), '.codex-dario');
const ACCOUNTS_DIR = join(CODEX_DARIO_DIR, 'accounts');

function safeAliasPath(alias: string): string | null {
  if (typeof alias !== 'string' || alias.length === 0) return null;
  const leaf = basename(alias);
  if (leaf !== alias) return null;
  if (leaf === '.' || leaf === '..') return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9_\-.]{0,63}$/.test(leaf)) return null;
  return join(ACCOUNTS_DIR, `${leaf}.json`);
}

export interface AccountCredentials {
  alias: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  chatgptAccountId: string;
  deviceId?: string;
  accountUuid?: string;
}

async function ensureDir(): Promise<void> {
  await mkdir(ACCOUNTS_DIR, { recursive: true, mode: 0o700 });
}

export async function listAccountAliases(): Promise<string[]> {
  try {
    await ensureDir();
    const entries = await readdir(ACCOUNTS_DIR);
    return entries.filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));
  } catch {
    return [];
  }
}

export async function loadAccount(alias: string): Promise<AccountCredentials | null> {
  const path = safeAliasPath(alias);
  if (!path) return null;
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as AccountCredentials;
  } catch {
    return null;
  }
}

export async function loadAllAccounts(): Promise<AccountCredentials[]> {
  const aliases = await listAccountAliases();
  const loaded = await Promise.all(aliases.map(a => loadAccount(a)));
  return loaded.filter((a): a is AccountCredentials => a !== null);
}

export async function saveAccount(creds: AccountCredentials): Promise<void> {
  const path = safeAliasPath(creds.alias);
  if (!path) throw new Error(`invalid account alias: ${creds.alias}`);
  await ensureDir();
  const tmp = `${path}.tmp.${randomBytes(4).toString('hex')}`;
  await writeFile(tmp, JSON.stringify(creds, null, 2), { mode: 0o600 });
  try {
    await rename(tmp, path);
  } catch {
    await writeFile(path, JSON.stringify(creds, null, 2), { mode: 0o600 });
    try { await unlink(tmp); } catch { /* ignore */ }
  }
}

export async function removeAccount(alias: string): Promise<boolean> {
  const path = safeAliasPath(alias);
  if (!path) return false;
  try {
    await unlink(path);
    return true;
  } catch {
    return false;
  }
}

// Per-alias SingleFlight for refresh
const accountRefreshesInFlight = new Map<string, Promise<AccountCredentials>>();

export async function refreshAccountToken(creds: AccountCredentials): Promise<AccountCredentials> {
  const inFlight = accountRefreshesInFlight.get(creds.alias);
  if (inFlight) return inFlight;

  const promise = doRefreshAccountToken(creds).finally(() => {
    if (accountRefreshesInFlight.get(creds.alias) === promise) {
      accountRefreshesInFlight.delete(creds.alias);
    }
  });
  accountRefreshesInFlight.set(creds.alias, promise);
  return promise;
}

async function doRefreshAccountToken(creds: AccountCredentials): Promise<AccountCredentials> {
  const { detectCodexOAuthConfig } = await import('./codex-auth-detect.js');
  const cfg = await detectCodexOAuthConfig();

  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: creds.refreshToken,
      client_id: cfg.clientId,
    }).toString(),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Refresh failed for ${creds.alias} (${res.status}): ${redactSecrets(errBody.slice(0, 200))}`);
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  const updated: AccountCredentials = {
    ...creds,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  await saveAccount(updated);
  return updated;
}
