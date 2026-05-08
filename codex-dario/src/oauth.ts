/**
 * Codex-Dario OAuth Engine
 *
 * OpenAI/Codex OAuth flow supporting:
 * - PKCE browser flow (localhost callback)
 * - Device code flow (headless / container)
 * - Token refresh with SingleFlight mutex
 * - One-time refresh_token protection (OpenAI's refresh tokens are single-use)
 * - Auto-detection of Codex CLI OAuth configuration
 */

import { randomBytes, createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { homedir, platform } from 'node:os';
import { detectCodexOAuthConfig } from './codex-auth-detect.js';
import { redactSecrets } from './redact.js';

// OpenAI OAuth endpoints (extracted from real Codex CLI binary)
const CODEX_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CODEX_DEVICE_CODE_URL = 'https://auth.openai.com/codex/device';
const CODEX_DEVICE_VERIFY_URL = 'https://auth.openai.com/device';
// Codex CLI uses a fixed callback port and path
const CODEX_CALLBACK_PORT = 1455;
const CODEX_CALLBACK_PATH = '/auth/callback';

// Refresh 10 minutes before expiry (Codex tokens ~1 hour)
const REFRESH_BUFFER_MS = 10 * 60 * 1000;
const REFRESH_COOLDOWN_MS = 30 * 1000;
let lastRefreshFailure = 0;

// In-memory credential cache
let credentialsCache: CodexCredentials | null = null;
let credentialsCacheTime = 0;
const CACHE_TTL_MS = 5_000;

// SingleFlight mutex: prevents concurrent refresh_token requests.
// CRITICAL: OpenAI refresh_tokens are ONE-TIME-USE. Concurrent usage
// triggers `refresh_token_reused` → token invalidated → account dead.
const refreshInFlight: Map<string, Promise<OAuthTokens>> = new Map();

// Exponential backoff for refresh failures: 1s → 2s → 4s → 8s, max 30s
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
const accountBackoff: Map<string, number> = new Map();

// Token invalidated accounts — no further refresh attempts
const invalidatedAccounts: Set<string> = new Set();

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
}

export interface CodexCredentials {
  alias: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  chatgptAccountId: string;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

function getCredentialsPath(): string {
  return join(homedir(), '.codex-dario', 'credentials.json');
}

function getAccountsDir(): string {
  return join(homedir(), '.codex-dario', 'accounts');
}

// ── Credential loading ─────────────────────────────────────────────

export async function loadCredentials(alias?: string): Promise<CodexCredentials | null> {
  if (credentialsCache && !alias && Date.now() - credentialsCacheTime < CACHE_TTL_MS) {
    return credentialsCache;
  }

  const candidates: CodexCredentials[] = [];

  // [TokenSea] Environment variable source — highest priority
  const envAccessToken = process.env.CODEX_DARIO_OAUTH_ACCESS_TOKEN;
  const envRefreshToken = process.env.CODEX_DARIO_OAUTH_REFRESH_TOKEN;
  if (envAccessToken && !alias) {
    candidates.push({
      alias: process.env.CODEX_DARIO_ACCOUNT_ID || 'env',
      accessToken: envAccessToken,
      refreshToken: envRefreshToken || '',
      expiresAt: process.env.CODEX_DARIO_OAUTH_EXPIRES_AT
        ? Number(process.env.CODEX_DARIO_OAUTH_EXPIRES_AT)
        : 0,
      scopes: ['codex:read', 'codex:write'],
      chatgptAccountId: process.env.CODEX_DARIO_CHATGPT_ACCOUNT_ID || '',
    });
  }

  // Account-specific file
  if (alias) {
    const accountPath = join(getAccountsDir(), `${alias}.json`);
    try {
      const raw = await readFile(accountPath, 'utf-8');
      const parsed = JSON.parse(raw) as CodexCredentials;
      if (parsed.accessToken && parsed.refreshToken) {
        candidates.push(parsed);
      }
    } catch { /* try next */ }
  }

  // Single-account file
  if (!alias) {
    try {
      const raw = await readFile(getCredentialsPath(), 'utf-8');
      const parsed = JSON.parse(raw) as CodexCredentials;
      if (parsed.accessToken && parsed.refreshToken) {
        candidates.push(parsed);
      }
    } catch { /* try next */ }
  }

  // Pick freshest credentials
  const best = pickFreshestCredentials(candidates);
  if (best && !alias) {
    credentialsCache = best;
    credentialsCacheTime = Date.now();
  }
  return best;
}

export function pickFreshestCredentials(candidates: CodexCredentials[]): CodexCredentials | null {
  if (candidates.length === 0) return null;
  let best = candidates[0]!;
  let bestExp = best.expiresAt ?? 0;
  for (let i = 1; i < candidates.length; i++) {
    const exp = candidates[i]!.expiresAt ?? 0;
    if (exp > bestExp) {
      best = candidates[i]!;
      bestExp = exp;
    }
  }
  return best;
}

async function saveCredentials(creds: CodexCredentials): Promise<void> {
  const dir = creds.alias && creds.alias !== 'env'
    ? getAccountsDir()
    : dirname(getCredentialsPath());
  await mkdir(dir, { recursive: true });
  const path = creds.alias && creds.alias !== 'env'
    ? join(getAccountsDir(), `${creds.alias}.json`)
    : getCredentialsPath();
  const tmpPath = `${path}.tmp.${Date.now()}`;
  await writeFile(tmpPath, JSON.stringify(creds, null, 2), { mode: 0o600 });
  await rename(tmpPath, path);
  if (!creds.alias || creds.alias === 'env') {
    credentialsCache = creds;
    credentialsCacheTime = Date.now();
  }
}

// ── PKCE Browser OAuth ─────────────────────────────────────────────

export async function startAutoOAuthFlow(alias?: string): Promise<OAuthTokens> {
  const { createServer } = await import('node:http');
  const { codeVerifier, codeChallenge } = generatePKCE();
  const state = base64url(randomBytes(32));
  const cfg = await detectCodexOAuthConfig();

  const redirectUri = `http://localhost:${CODEX_CALLBACK_PORT}${CODEX_CALLBACK_PATH}`;

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url || '', `http://localhost:${CODEX_CALLBACK_PORT}`);

      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      if (error) {
        const desc = url.searchParams.get('error_description') || error;
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<h1>Login failed</h1><p>${desc}</p>`);
        server.close();
        reject(new Error(`OAuth error: ${desc}`));
        return;
      }

      if (!code) {
        if (url.pathname === '/' || url.pathname === '') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h1>Waiting for authorization...</h1><p>Complete the login in your browser.</p>');
          return;
        }
        res.writeHead(404);
        res.end();
        return;
      }

      if (returnedState !== state) {
        res.writeHead(400);
        res.end('Invalid state parameter');
        server.close();
        reject(new Error('Invalid state parameter'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Login successful!</h1><p>You can close this tab and return to codex-dario.</p>');
      server.close();

      exchangeCode(code, codeVerifier, redirectUri, state, alias)
        .then(resolve)
        .catch(reject);
    });

    server.listen(CODEX_CALLBACK_PORT, 'localhost', async () => {
      // Match the exact parameters used by the real Codex CLI
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: cfg.clientId,
        redirect_uri: redirectUri,
        scope: 'openid profile email offline_access api.connectors.read api.connectors.invoke',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
        id_token_add_organizations: 'true',
        codex_cli_simplified_flow: 'true',
        originator: 'codex_cli_rs',
      });

      const authUrl = `${cfg.authorizeUrl}?${params.toString()}`;
      console.log('  Opening browser to sign in...');
      console.log(`  If the browser didn't open, visit: ${authUrl}`);

      const { openBrowser } = await import('./open-browser.js');
      try { openBrowser(authUrl); } catch { /* non-fatal */ }
    });

    server.on('error', (err: Error) => {
      reject(new Error(`Failed to start OAuth callback server: ${err.message}. Is port ${CODEX_CALLBACK_PORT} already in use?`));
    });

    setTimeout(() => {
      server.close();
      reject(new Error('OAuth flow timed out (10 min). Try again with `codex-dario login`.'));
    }, 600_000); // 10 minute timeout
  });
}

// ── Device Code OAuth (headless) ───────────────────────────────────

export async function startDeviceCodeFlow(alias?: string): Promise<OAuthTokens> {
  const cfg = await detectCodexOAuthConfig();
  const { codeVerifier, codeChallenge } = generatePKCE();

  // Request device code
  const deviceRes = await fetch(CODEX_DEVICE_CODE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: cfg.clientId,
      scope: cfg.scopes,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!deviceRes.ok) {
    const body = await deviceRes.text().catch(() => '');
    throw new Error(`Device code request failed (${deviceRes.status}): ${redactSecrets(body.slice(0, 200))}`);
  }

  const deviceData = await deviceRes.json() as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  };

  console.log('');
  console.log('  To authenticate, visit:');
  console.log(`    ${deviceData.verification_uri}`);
  console.log(`  And enter code: ${deviceData.user_code}`);
  console.log('');

  // Poll for token
  const pollInterval = (deviceData.interval || 5) * 1000;
  const expiresAt = Date.now() + deviceData.expires_in * 1000;

  while (Date.now() < expiresAt) {
    await new Promise(r => setTimeout(r, pollInterval));

    const tokenRes = await fetch(CODEX_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: cfg.clientId,
        device_code: deviceData.device_code,
        code_verifier: codeVerifier,
      }),
      signal: AbortSignal.timeout(15000),
    });

    const tokenBody = await tokenRes.json() as Record<string, unknown>;

    if (tokenRes.ok) {
      const tokens: OAuthTokens = {
        accessToken: tokenBody.access_token as string,
        refreshToken: tokenBody.refresh_token as string,
        expiresAt: Date.now() + (tokenBody.expires_in as number) * 1000,
        scopes: (tokenBody.scope as string)?.split(' ') || ['codex:read', 'codex:write'],
      };

      const creds: CodexCredentials = {
        alias: alias || 'default',
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        scopes: tokens.scopes,
        chatgptAccountId: '',
      };

      await saveCredentials(creds);
      return tokens;
    }

    const error = tokenBody.error as string;
    if (error === 'authorization_pending') {
      continue; // User hasn't completed the flow yet
    }
    if (error === 'slow_down') {
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }
    if (error === 'expired_token') {
      throw new Error('Device code expired. Please try `codex-dario login` again.');
    }
    if (error === 'access_denied') {
      throw new Error('Access denied by user.');
    }
    throw new Error(`Device code flow error: ${error}`);
  }

  throw new Error('Device code flow timed out.');
}

// ── Code exchange ──────────────────────────────────────────────────

async function exchangeCode(
  code: string,
  codeVerifier: string,
  redirectUri: string,
  state: string,
  alias?: string,
): Promise<OAuthTokens> {
  const cfg = await detectCodexOAuthConfig();
  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: cfg.clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
      state,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Token exchange failed (${res.status}): ${redactSecrets(body.slice(0, 200))}`);
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope?: string;
  };

  const tokens: OAuthTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    scopes: data.scope?.split(' ') || ['codex:read', 'codex:write'],
  };

  const creds: CodexCredentials = {
    alias: alias || 'default',
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    scopes: tokens.scopes,
    chatgptAccountId: '',
  };

  await saveCredentials(creds);
  return tokens;
}

// ── Token refresh with SingleFlight + one-time token protection ────

/**
 * Refresh an account's OAuth token. Uses SingleFlight to prevent
 * concurrent refresh_token requests — CRITICAL because OpenAI's
 * refresh_tokens are ONE-TIME-USE.
 *
 * On `refresh_token_reused` error, marks the account as invalidated
 * and throws — no further refresh attempts will be made for this account.
 */
export async function refreshTokens(alias?: string): Promise<OAuthTokens> {
  const key = alias || '__default__';

  // Check if account has been invalidated
  if (invalidatedAccounts.has(key)) {
    throw new Error(`Account ${key} has been invalidated (refresh_token_reused). Re-authenticate with \`codex-dario login\`.`);
  }

  // SingleFlight: if a refresh is already in flight for this account, wait for it
  const inFlight = refreshInFlight.get(key);
  if (inFlight) return inFlight;

  const promise = doRefreshTokens(alias).finally(() => {
    if (refreshInFlight.get(key) === promise) {
      refreshInFlight.delete(key);
    }
  });
  refreshInFlight.set(key, promise);
  return promise;
}

async function doRefreshTokens(alias?: string): Promise<OAuthTokens> {
  const key = alias || '__default__';

  // Check backoff
  const backoff = accountBackoff.get(key) ?? 0;
  if (Date.now() - lastRefreshFailure < REFRESH_COOLDOWN_MS) {
    // Still in cooldown
    const creds = await loadCredentials(alias);
    if (creds?.accessToken) {
      return {
        accessToken: creds.accessToken,
        refreshToken: creds.refreshToken,
        expiresAt: creds.expiresAt,
        scopes: creds.scopes,
      };
    }
  }

  const creds = await loadCredentials(alias);
  if (!creds?.refreshToken) {
    throw new Error('No refresh token available. Run `codex-dario login` first.');
  }

  const cfg = await detectCodexOAuthConfig();

  // Exponential backoff on retries
  const attempts = 3;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(BACKOFF_BASE_MS * Math.pow(2, attempt - 1), BACKOFF_MAX_MS);
      await new Promise(r => setTimeout(r, delay));
    }

    const res = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: creds.refreshToken,
        client_id: cfg.clientId,
      }).toString(),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      const redacted = redactSecrets(errBody.slice(0, 300));

      // Check for refresh_token_reused — this is fatal
      if (errBody.includes('refresh_token_reused') || errBody.includes('token_revoked')) {
        console.error(`[codex-dario] FATAL: refresh_token_reused for account ${key}. Account invalidated.`);
        invalidatedAccounts.add(key);
        throw new Error(`Refresh token was reused — account ${key} invalidated. Re-authenticate with \`codex-dario login\`.`);
      }

      console.error(`[codex-dario] Refresh attempt ${attempt + 1}/${attempts} failed: HTTP ${res.status} — ${redacted}`);
      if (res.status === 401 || res.status === 403) {
        throw new Error(`Refresh token rejected (${res.status}). Run \`codex-dario login\` to re-authenticate.`);
      }
      continue;
    }

    const data = await res.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    const tokens: OAuthTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      scopes: creds.scopes,
    };

    // Save the new credentials (including the new one-time refresh_token)
    await saveCredentials({
      alias: creds.alias,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scopes: tokens.scopes,
      chatgptAccountId: creds.chatgptAccountId,
    });

    // Reset backoff on success
    accountBackoff.delete(key);

    return tokens;
  }

  // Update backoff
  const currentBackoff = accountBackoff.get(key) ?? BACKOFF_BASE_MS;
  accountBackoff.set(key, Math.min(currentBackoff * 2, BACKOFF_MAX_MS));

  throw new Error('Token refresh failed after 3 attempts');
}

/**
 * Get a valid access token, refreshing if needed.
 * Uses SingleFlight to prevent concurrent refresh races.
 */
export async function getAccessToken(alias?: string): Promise<string> {
  const creds = await loadCredentials(alias);
  if (!creds?.accessToken) {
    throw new Error('Not authenticated. Run `codex-dario login` first.');
  }

  // Still valid
  if (creds.expiresAt > Date.now() + REFRESH_BUFFER_MS) {
    return creds.accessToken;
  }

  // Need refresh — but respect cooldown
  if (Date.now() - lastRefreshFailure < REFRESH_COOLDOWN_MS) {
    return creds.accessToken;
  }

  console.log('[codex-dario] Token expiring soon, refreshing...');
  try {
    const refreshed = await refreshTokens(alias);
    return refreshed.accessToken;
  } catch (err) {
    lastRefreshFailure = Date.now();
    console.error(`[codex-dario] Refresh failed: ${err instanceof Error ? err.message : err}`);
    return creds.accessToken;
  }
}

/**
 * Get token status info.
 */
export async function getStatus(alias?: string): Promise<{
  authenticated: boolean;
  status: 'healthy' | 'expiring' | 'expired' | 'none';
  expiresAt?: number;
  expiresIn?: string;
  canRefresh?: boolean;
  invalidated?: boolean;
}> {
  const key = alias || '__default__';
  const creds = await loadCredentials(alias);
  if (!creds?.accessToken) {
    return {
      authenticated: false,
      status: 'none',
      invalidated: invalidatedAccounts.has(key),
    };
  }

  const { expiresAt } = creds;
  const now = Date.now();

  if (invalidatedAccounts.has(key)) {
    return {
      authenticated: false,
      status: 'expired',
      expiresAt,
      canRefresh: false,
      invalidated: true,
    };
  }

  if (expiresAt < now) {
    return {
      authenticated: false,
      status: 'expired',
      expiresAt,
      canRefresh: !!creds.refreshToken && !invalidatedAccounts.has(key),
    };
  }

  const ms = expiresAt - now;
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  const expiresIn = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  return {
    authenticated: true,
    status: ms < REFRESH_BUFFER_MS ? 'expiring' : 'healthy',
    expiresAt,
    expiresIn,
  };
}

/** Check if an account has been invalidated. */
export function isAccountInvalidated(alias?: string): boolean {
  return invalidatedAccounts.has(alias || '__default__');
}

/** Mark an account as invalidated (e.g. on 401 from upstream). */
export function markAccountInvalidated(alias?: string): void {
  invalidatedAccounts.add(alias || '__default__');
}

/**
 * Background patrol: check all accounts' token status and refresh
 * any that are expiring soon. Should be called every 5 minutes.
 */
export async function patrolRefresh(): Promise<void> {
  const accountsDir = getAccountsDir();
  let aliases: string[] = [];

  try {
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(accountsDir);
    aliases = entries.filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));
  } catch { /* no accounts dir */ }

  // Include env credentials if present
  if (process.env.CODEX_DARIO_OAUTH_ACCESS_TOKEN) {
    aliases.push('env');
  }

  for (const alias of aliases) {
    if (invalidatedAccounts.has(alias)) continue;

    const creds = await loadCredentials(alias);
    if (!creds) continue;

    // Refresh if expiring within 10 minutes
    if (creds.expiresAt < Date.now() + REFRESH_BUFFER_MS) {
      try {
        await refreshTokens(alias);
        console.log(`[codex-dario] Proactive refresh succeeded for ${alias}`);
      } catch (err) {
        console.error(`[codex-dario] Proactive refresh failed for ${alias}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
}
