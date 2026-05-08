/**
 * Auto-detect Codex CLI OAuth configuration.
 *
 * Scans the installed Codex binary for OAuth client_id, scopes,
 * authorize URL, and token URL. Falls back to known-good defaults
 * when Codex isn't installed or the scan fails.
 */

import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface CodexOAuthConfig {
  clientId: string;
  scopes: string;
  authorizeUrl: string;
  tokenUrl: string;
}

// Known-good defaults for Codex CLI OAuth (captured from real Codex CLI login flow)
const DEFAULT_CONFIG: CodexOAuthConfig = {
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  scopes: 'openid profile email offline_access api.connectors.read api.connectors.invoke',
  authorizeUrl: 'https://auth.openai.com/oauth/authorize',
  tokenUrl: 'https://auth.openai.com/oauth/token',
};

let cachedConfig: CodexOAuthConfig | null = null;

/**
 * Detect the OAuth configuration used by the installed Codex CLI.
 * Falls back to hardcoded defaults if detection fails.
 */
export async function detectCodexOAuthConfig(): Promise<CodexOAuthConfig> {
  if (cachedConfig) return cachedConfig;

  // Try to find the Codex binary
  const codexPath = await findCodexBinary();
  if (!codexPath) {
    cachedConfig = { ...DEFAULT_CONFIG };
    return cachedConfig;
  }

  // Try to extract OAuth config from the binary or its config files
  const detected = await extractOAuthConfig(codexPath);
  if (detected) {
    cachedConfig = detected;
    return cachedConfig;
  }

  cachedConfig = { ...DEFAULT_CONFIG };
  return cachedConfig;
}

/** Find the installed Codex binary path. */
export async function findCodexBinary(): Promise<string | null> {
  // Check common locations
  const paths = [
    'codex', // PATH
    join(homedir(), '.codex', 'bin', 'codex'),
    '/usr/local/bin/codex',
  ];

  for (const p of paths) {
    try {
      const { execSync } = await import('node:child_process');
      const result = execSync(`which codex 2>/dev/null || echo ""`, { timeout: 3000 }).toString().trim();
      if (result && existsSync(result)) return result;
    } catch { /* not on PATH */ }

    if (p !== 'codex' && existsSync(p)) return p;
  }

  return null;
}

async function extractOAuthConfig(binaryPath: string): Promise<CodexOAuthConfig | null> {
  // Try to read from Codex's config files
  const configPaths = [
    join(homedir(), '.codex', 'config.json'),
    join(homedir(), '.codex', 'oauth.json'),
  ];

  for (const p of configPaths) {
    try {
      const raw = readFileSync(p, 'utf-8');
      const data = JSON.parse(raw);
      if (data.client_id || data.oauth_client_id) {
        return {
          clientId: data.client_id || data.oauth_client_id || DEFAULT_CONFIG.clientId,
          scopes: data.scopes || data.oauth_scopes || DEFAULT_CONFIG.scopes,
          authorizeUrl: data.authorize_url || data.oauth_authorize_url || DEFAULT_CONFIG.authorizeUrl,
          tokenUrl: data.token_url || data.oauth_token_url || DEFAULT_CONFIG.tokenUrl,
        };
      }
    } catch { /* try next */ }
  }

  // Try to extract from the binary itself (strings extraction)
  try {
    const { execSync } = await import('node:child_process');
    const output = execSync(`strings "${binaryPath}" 2>/dev/null | grep -E '(client_id|auth\.openai\.com)' | head -20`, {
      timeout: 10000,
      encoding: 'utf-8',
    });

    // Look for client_id patterns
    const clientIdMatch = output.match(/client_id[=:]\s*"?([A-Za-z0-9_-]{10,})"?/);
    if (clientIdMatch?.[1]) {
      return {
        ...DEFAULT_CONFIG,
        clientId: clientIdMatch[1],
      };
    }
  } catch { /* strings not available or binary not readable */ }

  return null;
}

/** Clear the cached config (for testing or after an update). */
export function clearCachedConfig(): void {
  cachedConfig = null;
}
