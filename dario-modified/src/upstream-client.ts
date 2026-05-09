/**
 * Upstream client that uses the @anthropic-ai/sdk for header generation
 * while preserving raw SSE streaming via manual fetch().
 *
 * The SDK automatically handles:
 *  - x-stainless-* platform headers (arch, lang, os, package-version, retry-count, runtime, runtime-version)
 *  - anthropic-dangerous-direct-browser-access (via dangerouslyAllowBrowser: true)
 *  - Authorization: Bearer (via authToken)
 *  - ?beta=true query param (via defaultQuery)
 *
 * After buildRequest(), headers are reordered via orderHeadersForOutbound()
 * to match CC's captured wire order (the SDK's internal order differs from
 * CC's actual wire order).
 *
 * TLS: When DARIO_TLS_SHIM is set (default), outbound requests route through
 * the Go utls shim at 127.0.0.1:3443, which produces a ClientHello matching
 * CC's exact TLS fingerprint (no ECH/65037 extension). Without the shim,
 * Bun's native fetch adds 65037, which diverges from CC.
 *
 * dario adds CC-specific headers on top via defaultHeaders / per-request headers:
 *  - user-agent override (claude-cli/... format)
 *  - X-Claude-Code-Session-Id (via defaultHeaders)
 *  - x-app: cli (via defaultHeaders)
 *  - x-client-request-id (per-request, via options.headers)
 *  - anthropic-beta (per-request, via options.headers)
 */

import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import { orderHeadersForOutbound } from './cc-template.js';

export interface UpstreamClientOptions {
  cliVersion: string;
  /** Override x-stainless-os (default: 'Linux' to match CC) */
  stainlessOS?: string;
  /** Override x-stainless-arch (default: 'x64' to match CC) */
  stainlessArch?: string;
  /** Override x-stainless-runtime-version (default: 'v24.3.0' to match CC) */
  stainlessRuntimeVersion?: string;
  /** TLS shim URL (e.g. 'http://127.0.0.1:3443'). Set to '' to disable. */
  tlsShimUrl?: string;
}

export interface SendRequestOptions {
  sessionId: string;
  anthropicBeta?: string;
  signal?: AbortSignal;
  timeout?: number;
}

/** Rewrite an https:// URL to go through the local TLS shim. */
function rewriteForShim(originalUrl: string, shimUrl: string): string {
  // Replace scheme + host with shim, keep path and query
  return originalUrl.replace(/^https:\/\/[^/]+/, shimUrl);
}

export class UpstreamClient {
  private clients: Map<string, Anthropic> = new Map();
  private cliVersion: string;
  private readonly stainlessOS: string;
  private readonly stainlessArch: string;
  private readonly stainlessRuntimeVersion: string;
  private readonly tlsShimUrl: string;

  constructor(opts: UpstreamClientOptions) {
    this.cliVersion = opts.cliVersion;
    this.stainlessOS = opts.stainlessOS ?? 'Linux';
    this.stainlessArch = opts.stainlessArch ?? 'x64';
    this.stainlessRuntimeVersion = opts.stainlessRuntimeVersion ?? 'v24.3.0';
    this.tlsShimUrl = opts.tlsShimUrl ?? (process.env.DARIO_TLS_SHIM !== '0' ? 'http://127.0.0.1:3443' : '');
  }

  getClient(accessToken: string, sessionId: string): Anthropic {
    const cacheKey = `${accessToken}:${sessionId}`;
    if (!this.clients.has(cacheKey)) {
      const client = new Anthropic({
        authToken: accessToken,
        dangerouslyAllowBrowser: true,
        defaultQuery: { beta: 'true' },
        defaultHeaders: {
          'User-Agent': `claude-cli/${this.cliVersion} (external, sdk-cli)`,
          'X-Claude-Code-Session-Id': sessionId,
          'X-Stainless-OS': this.stainlessOS,
          'X-Stainless-Arch': this.stainlessArch,
          'X-Stainless-Runtime': 'node',
          'X-Stainless-Runtime-Version': this.stainlessRuntimeVersion,
          'x-app': 'cli',
        },
        maxRetries: 0,
      });
      this.clients.set(cacheKey, client);
    }
    return this.clients.get(cacheKey)!;
  }

  async sendRequest(
    accessToken: string,
    body: Record<string, unknown>,
    options: SendRequestOptions,
  ): Promise<Response> {
    const client = this.getClient(accessToken, options.sessionId);

    const perRequestHeaders: Record<string, string> = {
      'x-client-request-id': randomUUID(),
    };
    if (options.anthropicBeta) {
      perRequestHeaders['anthropic-beta'] = options.anthropicBeta;
    }

    const { req, url } = await client.buildRequest({
      method: 'post',
      path: '/v1/messages',
      body,
      headers: perRequestHeaders,
      signal: options.signal,
      timeout: options.timeout,
    });

    // Reorder headers to match CC's captured wire order
    const hdrRecord: Record<string, string> = req.headers instanceof Headers
      ? Object.fromEntries(req.headers.entries())
      : Object.keys(req.headers as Record<string, string>).reduce((acc: Record<string, string>, k: string) => {
          const v = (req.headers as Record<string, string>)[k];
          acc[k] = v;
          return acc;
        }, {});
    const orderedHeaders = orderHeadersForOutbound(hdrRecord);

    // Route through TLS shim if configured. The shim uses Go utls to produce
    // a ClientHello matching CC's fingerprint (no ECH/65037 extension).
    // Without the shim, Bun's native fetch adds 65037, diverging from CC.
    const fetchUrl = this.tlsShimUrl
      ? rewriteForShim(url.toString(), this.tlsShimUrl)
      : url;

    return fetch(fetchUrl, {
      method: req.method,
      headers: orderedHeaders,
      body: req.body as BodyInit | undefined,
      signal: options.signal,
    });
  }

  updateCliVersion(version: string): void {
    if (this.cliVersion !== version) {
      this.cliVersion = version;
      this.clients.clear();
    }
  }
}
