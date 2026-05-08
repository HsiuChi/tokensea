/**
 * Upstream client that uses the @anthropic-ai/sdk for header generation
 * while preserving raw SSE streaming via manual fetch().
 *
 * The SDK automatically handles:
 *  - x-stainless-* platform headers (arch, lang, os, package-version, retry-count, runtime, runtime-version)
 *  - Header ordering (matches real Claude Code since it uses the same SDK)
 *  - anthropic-dangerous-direct-browser-access (via dangerouslyAllowBrowser: true)
 *  - Authorization: Bearer (via authToken)
 *  - ?beta=true query param (via defaultQuery)
 *
 * dario adds CC-specific headers on top via defaultHeaders / per-request headers:
 *  - user-agent override (claude-cli/... format)
 *  - X-Claude-Code-Session-Id (via defaultHeaders — placed after User-Agent like real CC)
 *  - x-app: cli (via defaultHeaders)
 *  - x-client-request-id (per-request, via options.headers)
 *  - anthropic-beta (per-request, via options.headers)
 */

import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';

export interface UpstreamClientOptions {
  cliVersion: string;
  /** Override x-stainless-os (default: 'Linux' to match CC) */
  stainlessOS?: string;
  /** Override x-stainless-arch (default: 'x64' to match CC) */
  stainlessArch?: string;
  /** Override x-stainless-runtime-version (default: 'v24.3.0' to match CC) */
  stainlessRuntimeVersion?: string;
}

export interface SendRequestOptions {
  sessionId: string;
  anthropicBeta?: string;
  signal?: AbortSignal;
  timeout?: number;
}

export class UpstreamClient {
  // Cache key: accessToken:sessionId — sessionId is in defaultHeaders so
  // a new client is needed when the session changes (e.g., rotation, failover)
  private clients: Map<string, Anthropic> = new Map();
  private cliVersion: string;
  private readonly stainlessOS: string;
  private readonly stainlessArch: string;
  private readonly stainlessRuntimeVersion: string;

  constructor(opts: UpstreamClientOptions) {
    this.cliVersion = opts.cliVersion;
    this.stainlessOS = opts.stainlessOS ?? 'Linux';
    this.stainlessArch = opts.stainlessArch ?? 'x64';
    this.stainlessRuntimeVersion = opts.stainlessRuntimeVersion ?? 'v24.3.0';
  }

  /**
   * Get or create an SDK client for the given access token + session.
   * Both token and sessionId are in defaultHeaders, so the cache key
   * includes both. A session change (rotation/failover) creates a new client.
   */
  getClient(accessToken: string, sessionId: string): Anthropic {
    const cacheKey = `${accessToken}:${sessionId}`;
    if (!this.clients.has(cacheKey)) {
      const client = new Anthropic({
        authToken: accessToken,
        dangerouslyAllowBrowser: true,
        defaultQuery: { beta: 'true' },
        defaultHeaders: {
          'User-Agent': `claude-cli/${this.cliVersion} (external, sdk-cli)`,
          // X-Claude-Code-Session-Id goes in defaultHeaders so it appears
          // right after User-Agent (matching real CC's header wire order).
          'X-Claude-Code-Session-Id': sessionId,
          'X-Stainless-OS': this.stainlessOS,
          'X-Stainless-Arch': this.stainlessArch,
          'X-Stainless-Runtime': 'node',
          'X-Stainless-Runtime-Version': this.stainlessRuntimeVersion,
          'x-app': 'cli',
        },
        maxRetries: 0, // dario handles retries itself
      });
      this.clients.set(cacheKey, client);
    }
    return this.clients.get(cacheKey)!;
  }

  /**
   * Build a request using the SDK's header generation logic, then send
   * with our own fetch() to get a raw Response for SSE streaming.
   *
   * The SDK's buildRequest() assembles headers in the same order as
   * real Claude Code (same SDK version = same header wire format).
   */
  async sendRequest(
    accessToken: string,
    body: Record<string, unknown>,
    options: SendRequestOptions,
  ): Promise<Response> {
    const client = this.getClient(accessToken, options.sessionId);

    // Per-request headers that change every call
    const perRequestHeaders: Record<string, string> = {
      'x-client-request-id': randomUUID(),
    };
    if (options.anthropicBeta) {
      perRequestHeaders['anthropic-beta'] = options.anthropicBeta;
    }

    // Use SDK's buildRequest to get the full request with correct headers
    const { req, url } = await client.buildRequest({
      method: 'post',
      path: '/v1/messages',
      body,
      headers: perRequestHeaders,
      signal: options.signal,
      timeout: options.timeout,
    });

    // Send with our own fetch to preserve raw SSE streaming
    return fetch(url, {
      method: req.method,
      headers: req.headers,
      body: req.body as BodyInit | undefined,
      signal: options.signal,
    });
  }

  /**
   * Update the CLI version (e.g., after live fingerprint refresh).
   * Clears cached clients since defaultHeaders depend on cliVersion.
   */
  updateCliVersion(version: string): void {
    if (this.cliVersion !== version) {
      this.cliVersion = version;
      this.clients.clear();
    }
  }
}
