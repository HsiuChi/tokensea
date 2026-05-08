/**
 * Account pool — rate limit tracking, headroom routing, failover.
 *
 * Adapted from dario's pool.ts for OpenAI/Codex.
 */

import { createHash, randomUUID } from 'node:crypto';

export function computeStickyKey(firstUserMessage: string | null | undefined): string | null {
  const trimmed = (firstUserMessage ?? '').trim();
  if (trimmed.length === 0) return null;
  return createHash('sha256').update(trimmed).digest('hex').slice(0, 16);
}

export interface AccountIdentity {
  deviceId: string;
  accountUuid: string;
  sessionId: string;
}

export interface RateLimitSnapshot {
  status: string;
  utilization: number;
  requestsRemaining: number;
  resetAt: number;
  updatedAt: number;
}

export const EMPTY_SNAPSHOT: RateLimitSnapshot = {
  status: 'unknown',
  utilization: 0,
  requestsRemaining: 0,
  resetAt: 0,
  updatedAt: 0,
};

export interface PoolAccount {
  alias: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  identity: AccountIdentity;
  rateLimit: RateLimitSnapshot;
  requestCount: number;
}

export interface PoolStatus {
  accounts: number;
  healthy: number;
  exhausted: number;
  bestAccount: string;
  queued: number;
}

const POOL_HEADROOM_FLOOR = 0.02;
const STICKY_TTL_MS = 6 * 60 * 60 * 1000;
const STICKY_MAX_ENTRIES = 2_000;

interface StickyBinding {
  alias: string;
  boundAt: number;
}

export class AccountPool {
  private accounts: Map<string, PoolAccount> = new Map();
  private queue: Array<{ resolve: (account: PoolAccount) => void; reject: (error: Error) => void; enqueuedAt: number }> = [];
  private sticky: Map<string, StickyBinding> = new Map();

  add(alias: string, opts: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    deviceId: string;
    accountUuid: string;
  }): void {
    const existing = this.accounts.get(alias);
    this.accounts.set(alias, {
      alias,
      accessToken: opts.accessToken,
      refreshToken: opts.refreshToken,
      expiresAt: opts.expiresAt,
      identity: existing?.identity ?? {
        deviceId: opts.deviceId,
        accountUuid: opts.accountUuid,
        sessionId: randomUUID(),
      },
      rateLimit: existing?.rateLimit ?? { ...EMPTY_SNAPSHOT },
      requestCount: existing?.requestCount ?? 0,
    });
  }

  remove(alias: string): boolean {
    return this.accounts.delete(alias);
  }

  get size(): number {
    return this.accounts.size;
  }

  select(): PoolAccount | null {
    if (this.accounts.size === 0) return null;
    const now = Date.now();
    const eligible = [...this.accounts.values()].filter(a =>
      a.rateLimit.status !== 'rejected' && a.expiresAt > now + 30_000
    );
    if (eligible.length > 0) {
      return eligible.reduce((best, curr) =>
        curr.rateLimit.utilization < best.rateLimit.utilization ? curr : best
      );
    }
    return [...this.accounts.values()].reduce((a, b) =>
      a.requestCount < b.requestCount ? a : b
    );
  }

  selectSticky(stickyKey: string | null): PoolAccount | null {
    if (!stickyKey) return this.select();
    this.cleanupSticky();

    const binding = this.sticky.get(stickyKey);
    if (binding) {
      const bound = this.accounts.get(binding.alias);
      const now = Date.now();
      if (bound && bound.rateLimit.status !== 'rejected' && bound.expiresAt > now + 30_000) {
        return bound;
      }
    }

    const picked = this.select();
    if (picked) {
      this.sticky.set(stickyKey, { alias: picked.alias, boundAt: Date.now() });
    }
    return picked;
  }

  rebindSticky(stickyKey: string | null, alias: string): void {
    if (!stickyKey || !this.accounts.has(alias)) return;
    this.sticky.set(stickyKey, { alias, boundAt: Date.now() });
  }

  selectExcluding(excluded: Set<string>): PoolAccount | null {
    const candidates = [...this.accounts.values()].filter(a => !excluded.has(a.alias));
    if (candidates.length === 0) return null;
    const eligible = candidates.filter(a => a.rateLimit.status !== 'rejected' && a.expiresAt > Date.now() + 30_000);
    if (eligible.length > 0) {
      return eligible.reduce((best, curr) => curr.rateLimit.utilization < best.rateLimit.utilization ? curr : best);
    }
    return candidates.reduce((a, b) => a.requestCount < b.requestCount ? a : b);
  }

  updateRateLimits(alias: string, snapshot: RateLimitSnapshot): void {
    const account = this.accounts.get(alias);
    if (!account) return;
    account.rateLimit = snapshot;
    account.requestCount++;
  }

  markRejected(alias: string): void {
    const account = this.accounts.get(alias);
    if (!account) return;
    account.rateLimit = { ...account.rateLimit, status: 'rejected' };
  }

  updateTokens(alias: string, accessToken: string, refreshToken: string, expiresAt: number): void {
    const account = this.accounts.get(alias);
    if (!account) return;
    account.accessToken = accessToken;
    account.refreshToken = refreshToken;
    account.expiresAt = expiresAt;
  }

  get(alias: string): PoolAccount | undefined {
    return this.accounts.get(alias);
  }

  all(): PoolAccount[] {
    return [...this.accounts.values()];
  }

  status(): PoolStatus {
    const all = this.all();
    const now = Date.now();
    const healthy = all.filter(a => a.rateLimit.status !== 'rejected' && a.expiresAt > now + 30_000);
    return {
      accounts: all.length,
      healthy: healthy.length,
      exhausted: all.length - healthy.length,
      bestAccount: this.select()?.alias ?? 'none',
      queued: this.queue.length,
    };
  }

  private cleanupSticky(): void {
    const now = Date.now();
    for (const [key, b] of this.sticky) {
      if (!this.accounts.has(b.alias) || now - b.boundAt > STICKY_TTL_MS) {
        this.sticky.delete(key);
      }
    }
    if (this.sticky.size > STICKY_MAX_ENTRIES) {
      const sorted = [...this.sticky.entries()].sort((a, b) => a[1].boundAt - b[1].boundAt);
      for (const [key] of sorted.slice(0, this.sticky.size - STICKY_MAX_ENTRIES)) {
        this.sticky.delete(key);
      }
    }
  }
}
