/**
 * TLS fingerprint drift detection.
 *
 * Compares the latest captured CC fingerprint (from data/fingerprints/)
 * against the shim's expected fingerprint (from the shim's /healthz).
 * Used by dario's /healthz to surface TLS drift status.
 *
 * The shim's /healthz reports its expected TLS fingerprint fields:
 *   extensions, cipher_suites, alpn, ech_65037
 *
 * The CC capture JSON (from fingerprint-capture.sh) reports the same fields.
 * If they diverge, dario is producing a different TLS fingerprint than CC.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface TlsFingerprintStatus {
  /** Whether CC and shim fingerprints match. */
  aligned: boolean;
  /** Source of the CC fingerprint data. */
  cc_source: 'capture-file' | 'none';
  /** CC's captured extensions string (e.g. "0-23-65281-..."). */
  cc_extensions?: string;
  /** CC's captured cipher suites string. */
  cc_ciphers?: string;
  /** CC's captured ALPN. */
  cc_alpn?: string;
  /** Whether CC's capture had ECH 65037. */
  cc_ech?: boolean;
  /** Shim's expected extensions string. */
  shim_extensions?: string;
  /** Shim's expected cipher suites string. */
  shim_ciphers?: string;
  /** Shim's expected ALPN. */
  shim_alpn?: string;
  /** Whether shim's spec includes ECH 65037. */
  shim_ech?: boolean;
  /** Human-readable explanation. */
  message: string;
}

let _cachedStatus: TlsFingerprintStatus | null = null;
let _lastCheck = 0;
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // re-check every 5 minutes

/**
 * Read the latest CC fingerprint capture from the fingerprints directory.
 */
function readLatestCCFingerprint(fpDir: string): Record<string, unknown> | null {
  try {
    const files = readdirSync(fpDir)
      .filter(f => f.startsWith('claude-code-') && f.endsWith('.json'))
      .sort()
      .reverse();
    if (files.length === 0) return null;
    const content = readFileSync(join(fpDir, files[0]), 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Fetch the shim's expected TLS fingerprint from its /healthz.
 */
async function readShimFingerprint(shimUrl: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${shimUrl}/healthz`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const data = await res.json() as { tls_fingerprint?: Record<string, unknown> };
    return data.tls_fingerprint ?? null;
  } catch {
    return null;
  }
}

/**
 * Check TLS fingerprint alignment between CC and shim.
 * Results are cached for 5 minutes to avoid hammering the shim.
 */
export async function checkTlsFingerprintDrift(
  fpDir = './data/fingerprints',
  shimUrl = process.env.DARIO_TLS_SHIM !== '0' ? 'http://127.0.0.1:3443' : '',
): Promise<TlsFingerprintStatus> {
  const now = Date.now();
  if (_cachedStatus && now - _lastCheck < CHECK_INTERVAL_MS) {
    return _cachedStatus;
  }

  // No shim — skip TLS fingerprint check
  if (!shimUrl) {
    const status: TlsFingerprintStatus = {
      aligned: true,
      cc_source: 'none',
      message: 'TLS shim disabled, fingerprint check skipped',
    };
    _cachedStatus = status;
    _lastCheck = now;
    return status;
  }

  const ccFp = readLatestCCFingerprint(fpDir);
  const shimFp = await readShimFingerprint(shimUrl);

  if (!ccFp) {
    const status: TlsFingerprintStatus = {
      aligned: true, // no data to prove drift, assume ok
      cc_source: 'none',
      shim_extensions: shimFp?.extensions as string | undefined,
      shim_ciphers: shimFp?.cipher_suites as string | undefined,
      shim_alpn: shimFp?.alpn as string | undefined,
      shim_ech: shimFp?.ech_65037 as boolean | undefined,
      message: 'No CC fingerprint capture found — run fingerprint:capture',
    };
    _cachedStatus = status;
    _lastCheck = now;
    return status;
  }

  const ccExt = ccFp.extensions as string | undefined;
  const ccCiphers = ccFp.cipher_suites as string | undefined;
  const ccAlpn = ccFp.alpn as string | undefined;
  const ccEch = ccFp.has_ech_65037 as boolean | undefined;

  const shimExt = shimFp?.extensions as string | undefined;
  const shimCiphers = shimFp?.cipher_suites as string | undefined;
  const shimAlpn = shimFp?.alpn as string | undefined;
  const shimEch = shimFp?.ech_65037 as boolean | undefined;

  const extMatch = ccExt === shimExt;
  const cipherMatch = ccCiphers === shimCiphers;
  const alpnMatch = ccAlpn === shimAlpn;
  const echMatch = !ccEch && !shimEch; // both must be false

  const aligned = extMatch && cipherMatch && alpnMatch && echMatch;

  const mismatches: string[] = [];
  if (!extMatch) mismatches.push('extensions');
  if (!cipherMatch) mismatches.push('ciphers');
  if (!alpnMatch) mismatches.push('ALPN');
  if (!echMatch) mismatches.push('ECH(65037)');

  const status: TlsFingerprintStatus = {
    aligned,
    cc_source: 'capture-file',
    cc_extensions: ccExt,
    cc_ciphers: ccCiphers,
    cc_alpn: ccAlpn,
    cc_ech: ccEch,
    shim_extensions: shimExt,
    shim_ciphers: shimCiphers,
    shim_alpn: shimAlpn,
    shim_ech: shimEch,
    message: aligned
      ? 'CC and shim TLS fingerprints match'
      : `TLS fingerprint drift: ${mismatches.join(', ')} differ`,
  };

  _cachedStatus = status;
  _lastCheck = now;
  return status;
}

/** Reset cached result — for tests. */
export function _resetTlsFingerprintCache(): void {
  _cachedStatus = null;
  _lastCheck = 0;
}
