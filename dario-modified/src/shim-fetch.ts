/**
 * shimFetch — drop-in fetch() wrapper that routes requests through the
 * local TLS shim when DARIO_TLS_SHIM is enabled.
 *
 * The shim produces a ClientHello matching CC's exact TLS fingerprint
 * (no ECH/65037). Without it, Bun's native fetch adds 65037, diverging
 * from CC.
 *
 * For non-default targets (e.g. platform.claude.com instead of
 * api.anthropic.com), the original host is passed via the
 * X-Shim-Target-Host header so the shim can dial the correct upstream.
 */

const TLS_SHIM_URL = process.env.DARIO_TLS_SHIM !== '0' ? 'http://127.0.0.1:3443' : '';
const SHIM_TARGET_HEADER = 'X-Shim-Target-Host';

export interface ShimFetchRequestInit extends RequestInit {
  /** Force disable shim for this request (even if DARIO_TLS_SHIM is set) */
  skipShim?: boolean;
}

/**
 * fetch() that routes through the TLS shim when enabled.
 *
 * - Rewrites https://host:port/path → http://127.0.0.1:3443/path
 * - Adds X-Shim-Target-Host header so the shim dials the right upstream
 * - Preserves all other fetch options unchanged
 */
export async function shimFetch(url: string | URL, init?: ShimFetchRequestInit): Promise<Response> {
  const { skipShim, ...fetchInit } = init ?? {};

  if (!TLS_SHIM_URL || skipShim) {
    return fetch(url, fetchInit);
  }

  const originalUrl = typeof url === 'string' ? url : url.toString();
  const parsed = new URL(originalUrl);
  const targetHost = parsed.host; // includes port if non-default

  // Rewrite URL to go through shim
  const shimUrl = originalUrl.replace(/^https:\/\/[^/]+/, TLS_SHIM_URL);

  // Merge headers: add X-Shim-Target-Host, preserve existing
  const headers = new Headers(fetchInit.headers as HeadersInit ?? undefined);
  headers.set(SHIM_TARGET_HEADER, targetHost);

  return fetch(shimUrl, { ...fetchInit, headers });
}
