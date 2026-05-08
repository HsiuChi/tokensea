/**
 * Live fingerprint extraction for Codex CLI.
 *
 * At codex-dario startup, spawn the user's actual `codex` binary
 * against a loopback MITM endpoint, capture the outbound request,
 * and use the captured data as the template for wire-fidelity replay.
 *
 * Same MITM approach as dario's live-fingerprint.ts, adapted for
 * Codex CLI's different binary name, env var, and API format.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Template data schema — mirrors what we capture from Codex CLI
export interface TemplateData {
  // Metadata
  _version: string;           // Codex CLI version that was captured
  _source: 'live' | 'bundled' | 'env';
  _captured: string;          // ISO timestamp of capture
  _schemaVersion: number;

  // Wire shape
  header_order: string[];     // Header insertion order
  header_values: Record<string, string>; // Static header values
  body_field_order: string[]; // JSON body key order
  anthropic_beta: string;     // Not used for Codex but kept for compatibility

  // Content
  system_prompt: string;
  tools: Array<Record<string, unknown>>;
  agent_identity: string;
}

const CURRENT_SCHEMA_VERSION = 2;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getTemplateDir(): string {
  return join(homedir(), '.codex-dario');
}

function getLiveCachePath(): string {
  return join(getTemplateDir(), 'codex-template.live.json');
}

function getBundledPath(): string {
  // In dist/ after build
  const distPath = join(new URL('.', import.meta.url).pathname, 'codex-template-data.json');
  if (existsSync(distPath)) return distPath;
  // In src/ during development
  return join(new URL('.', import.meta.url).pathname, '..', 'src', 'codex-template-data.json');
}

/**
 * Load the best available template.
 * Priority: env override > live cache > bundled snapshot
 */
export function loadTemplate(opts?: { silent?: boolean }): TemplateData {
  const silent = opts?.silent ?? false;

  // [TokenSea] Check for env-specified template path
  const envTemplatePath = process.env.CODEX_DARIO_TEMPLATE_PATH;
  if (envTemplatePath) {
    try {
      const raw = readFileSync(envTemplatePath, 'utf-8');
      const data = JSON.parse(raw) as TemplateData;
      if (!silent) console.log(`[codex-dario] Template loaded from env: ${envTemplatePath}`);
      return { ...data, _source: 'env', _schemaVersion: data._schemaVersion || CURRENT_SCHEMA_VERSION };
    } catch (err) {
      if (!silent) console.warn(`[codex-dario] Failed to load template from ${envTemplatePath}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Try live cache
  const liveCachePath = getLiveCachePath();
  try {
    if (existsSync(liveCachePath)) {
      const raw = readFileSync(liveCachePath, 'utf-8');
      const data = JSON.parse(raw) as TemplateData;
      const age = Date.now() - new Date(data._captured).getTime();

      if (age < CACHE_TTL_MS) {
        if (!silent) console.log(`[codex-dario] Template loaded: live cache, v${data._version}, ${Math.round(age / 3600000)}h old`);
        return { ...data, _source: 'live', _schemaVersion: data._schemaVersion || CURRENT_SCHEMA_VERSION };
      }

      if (!silent) console.log(`[codex-dario] Live cache expired (${Math.round(age / 3600000)}h old), falling back to bundled`);
    }
  } catch { /* try bundled */ }

  // Fall back to bundled snapshot
  try {
    const bundledPath = getBundledPath();
    if (existsSync(bundledPath)) {
      const raw = readFileSync(bundledPath, 'utf-8');
      const data = JSON.parse(raw) as TemplateData;
      if (!silent) console.log(`[codex-dario] Template loaded: bundled snapshot, v${data._version}`);
      return { ...data, _source: 'bundled', _schemaVersion: data._schemaVersion || CURRENT_SCHEMA_VERSION };
    }
  } catch { /* no bundled */ }

  // Last resort: minimal template
  if (!silent) console.warn('[codex-dario] No template found — using minimal defaults');
  return EMPTY_TEMPLATE();
}

function EMPTY_TEMPLATE(): TemplateData {
  return {
    _version: '0.0.0',
    _source: 'bundled',
    _captured: new Date().toISOString(),
    _schemaVersion: CURRENT_SCHEMA_VERSION,
    header_order: [],
    header_values: {},
    body_field_order: [],
    anthropic_beta: '',
    system_prompt: '',
    tools: [],
    agent_identity: '',
  };
}

// ── Live capture ───────────────────────────────────────────────────

/**
 * Run a live fingerprint capture by spawning Codex CLI against a
 * loopback MITM endpoint.
 */
export async function captureLiveFingerprint(): Promise<TemplateData | null> {
  if (process.env.CODEX_DARIO_NO_LIVE_CAPTURE === '1') {
    console.log('[codex-dario] Live capture skipped (CODEX_DARIO_NO_LIVE_CAPTURE=1)');
    return null;
  }

  // Check if codex binary exists
  const codexBinary = await findCodexBinary();
  if (!codexBinary) {
    console.warn('[codex-dario] Codex binary not found — skipping live capture');
    return null;
  }

  console.log('[codex-dario] Starting live fingerprint capture...');

  return new Promise<TemplateData | null>((resolve) => {
    let captured = false;
    let child: ChildProcess | null = null;

    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      if (captured) {
        res.writeHead(200);
        res.end('{"id":"resp_capture","status":"ok"}');
        return;
      }
      captured = true;

      try {
        // Read the request body
        const body = await readRequestBody(req);

        // Extract wire shape from the captured request
        const template = extractTemplateFromRequest(req, body);

        // Send a minimal response so Codex doesn't hang
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'resp_capture',
          status: 'completed',
          output: [{ type: 'message', content: [{ type: 'text', text: 'ok' }] }],
        }));

        // Save the captured template
        await saveLiveCache(template);

        // Kill the Codex process
        child?.kill();

        resolve(template);
      } catch (err) {
        console.error(`[codex-dario] Capture error: ${err instanceof Error ? err.message : err}`);
        res.writeHead(500);
        res.end('{"error":"capture failed"}');
        child?.kill();
        resolve(null);
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;

      if (!port) {
        console.error('[codex-dario] Failed to bind MITM port');
        resolve(null);
        return;
      }

      // Spawn Codex with our MITM endpoint
      // Use -c chatgpt_base_url to redirect API calls to our capture server
      child = spawn(codexBinary, [
        '-c', `chatgpt_base_url=http://127.0.0.1:${port}`,
        'exec', 'say hi',
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Close stdin so codex exits after the request
      child.stdin?.end();

      child.on('error', (err) => {
        console.error(`[codex-dario] Codex spawn error: ${err.message}`);
        server.close();
        resolve(null);
      });

      child.on('exit', () => {
        server.close();
        if (!captured) {
          console.warn('[codex-dario] Codex exited without sending a request');
          resolve(null);
        }
      });

      // Timeout after 15 seconds
      setTimeout(() => {
        if (!captured) {
          child?.kill();
          server.close();
          resolve(null);
        }
      }, 15000);
    });
  });
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function extractTemplateFromRequest(req: IncomingMessage, body: string): TemplateData {
  // Extract header order from rawHeaders
  const headerOrder: string[] = [];
  const headerValues: Record<string, string> = {};

  if (req.rawHeaders) {
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i]!;
      const value = req.rawHeaders[i + 1]!;
      headerOrder.push(name);
      headerValues[name.toLowerCase()] = value;
    }
  }

  // Parse body and extract field order + content
  let bodyFieldOrder: string[] = [];
  let systemPrompt = '';
  let tools: Array<Record<string, unknown>> = [];
  let agentIdentity = '';

  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    bodyFieldOrder = Object.keys(parsed);

    // Extract system prompt
    if (typeof parsed.instructions === 'string') {
      systemPrompt = parsed.instructions;
    }

    // Extract tools
    if (Array.isArray(parsed.tools)) {
      tools = parsed.tools as Array<Record<string, unknown>>;
    }

    // Extract agent identity from headers
    agentIdentity = headerValues['originator'] || headerValues['user-agent'] || '';
  } catch { /* unparseable body */ }

  // Detect Codex version from User-Agent
  const ua = headerValues['user-agent'] || '';
  const versionMatch = ua.match(/codex_cli_rs\/([\d.]+)/);
  const version = versionMatch?.[1] || 'unknown';

  return {
    _version: version,
    _source: 'live',
    _captured: new Date().toISOString(),
    _schemaVersion: CURRENT_SCHEMA_VERSION,
    header_order: headerOrder,
    header_values: headerValues,
    body_field_order: bodyFieldOrder,
    anthropic_beta: '',
    system_prompt: systemPrompt,
    tools,
    agent_identity: agentIdentity,
  };
}

async function saveLiveCache(template: TemplateData): Promise<void> {
  const dir = getTemplateDir();
  mkdirSync(dir, { recursive: true });
  const path = getLiveCachePath();
  const tmpPath = `${path}.tmp.${Date.now()}`;
  writeFileSync(tmpPath, JSON.stringify(template, null, 2), { mode: 0o600 });
  try {
    await rename(tmpPath, path);
  } catch {
    // Fallback to direct write
    writeFileSync(path, JSON.stringify(template, null, 2), { mode: 0o600 });
  }
}

async function findCodexBinary(): Promise<string | null> {
  const { execSync } = await import('node:child_process');
  try {
    const result = execSync('which codex 2>/dev/null || which codex-cli 2>/dev/null', {
      timeout: 3000,
      encoding: 'utf-8',
    }).trim();
    if (result && existsSync(result)) return result;
  } catch { /* not on PATH */ }

  // Check common locations
  const paths = [
    join(homedir(), '.codex', 'bin', 'codex'),
    '/usr/local/bin/codex',
  ];
  for (const p of paths) {
    if (existsSync(p)) return p;
  }

  return null;
}

// ── Utility functions ──────────────────────────────────────────────

export function describeTemplate(t: TemplateData): string {
  const age = t._captured
    ? Math.round((Date.now() - new Date(t._captured).getTime()) / 3600000)
    : -1;
  return `v${t._version} (${t._source}, ${age >= 0 ? `${age}h old` : 'unknown age'}, ${t.tools.length} tools, ${(t.system_prompt?.length ?? 0).toLocaleString()} chars system prompt)`;
}

export function detectDrift(t: TemplateData): { installedVersion: string | null; drifted: boolean; message: string } {
  // TODO: compare against installed Codex version
  return { installedVersion: null, drifted: false, message: 'no drift check available yet' };
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

export const SUPPORTED_CODEX_RANGE = { min: '0.1.0', maxTested: '99.0.0' };

export function checkCodexCompat(version: string): { status: 'ok' | 'untested-above' | 'below-min' } {
  if (compareVersions(version, SUPPORTED_CODEX_RANGE.min) < 0) return { status: 'below-min' };
  if (compareVersions(version, SUPPORTED_CODEX_RANGE.maxTested) > 0) return { status: 'untested-above' };
  return { status: 'ok' };
}

export function findInstalledCodex(): { path: string | null; version: string | null } {
  try {
    const { execSync } = require('node:child_process');
    const path = execSync('which codex 2>/dev/null', { timeout: 3000, encoding: 'utf-8' }).trim();
    if (!path) return { path: null, version: null };
    const versionOut = execSync('codex --version 2>/dev/null', { timeout: 3000, encoding: 'utf-8' }).trim();
    const match = versionOut.match(/([\d]+\.[\d]+\.[\d]+)/);
    return { path, version: match?.[1] || null };
  } catch {
    return { path: null, version: null };
  }
}

export { CURRENT_SCHEMA_VERSION };
