/**
 * Session-ID lifecycle management for codex-dario.
 *
 * Reuses the same rotation logic as dario's session-rotation.ts,
 * with Codex-specific env var prefixes.
 */

export interface SessionRotationConfig {
  idleRotateMs: number;
  jitterMs: number;
  maxAgeMs?: number;
  perClient: boolean;
}

export interface SessionEntry {
  upstreamSessionId: string;
  createdAt: number;
  lastUsedAt: number;
  idleJitterOffsetMs: number;
}

export type RotationDecision = 'keep' | 'rotate-new' | 'rotate-idle' | 'rotate-age';

export function decideSessionRotation(
  entry: SessionEntry | undefined,
  now: number,
  cfg: SessionRotationConfig,
): RotationDecision {
  if (!entry) return 'rotate-new';
  const idleBase = Math.max(0, cfg.idleRotateMs);
  const idleThreshold = idleBase + Math.max(0, entry.idleJitterOffsetMs);
  if (now - entry.lastUsedAt > idleThreshold) return 'rotate-idle';
  if (cfg.maxAgeMs !== undefined && cfg.maxAgeMs > 0 && now - entry.createdAt > cfg.maxAgeMs) {
    return 'rotate-age';
  }
  return 'keep';
}

export interface RegistryResult {
  sessionId: string;
  rotated: boolean;
  reason: RotationDecision;
}

export class SessionRegistry {
  private readonly entries = new Map<string, SessionEntry>();

  constructor(
    private readonly cfg: SessionRotationConfig,
    private readonly newId: () => string,
    private readonly rng: () => number = Math.random,
    private readonly maxEntries: number = 1024,
  ) {}

  getOrCreate(clientKey: string | undefined, now: number): RegistryResult {
    const key = this.cfg.perClient ? (clientKey && clientKey.length > 0 ? clientKey : 'default') : 'default';
    const existing = this.entries.get(key);
    const decision = decideSessionRotation(existing, now, this.cfg);
    if (decision === 'keep' && existing) {
      existing.lastUsedAt = now;
      this.entries.delete(key);
      this.entries.set(key, existing);
      return { sessionId: existing.upstreamSessionId, rotated: false, reason: 'keep' };
    }
    const jitterOffset = this.cfg.jitterMs > 0 ? Math.floor(this.rng() * this.cfg.jitterMs) : 0;
    const entry: SessionEntry = {
      upstreamSessionId: this.newId(),
      createdAt: now,
      lastUsedAt: now,
      idleJitterOffsetMs: jitterOffset,
    };
    this.entries.set(key, entry);
    this.evictIfOverCap();
    return { sessionId: entry.upstreamSessionId, rotated: true, reason: decision };
  }

  peek(clientKey: string | undefined): string | undefined {
    const key = this.cfg.perClient ? (clientKey && clientKey.length > 0 ? clientKey : 'default') : 'default';
    return this.entries.get(key)?.upstreamSessionId;
  }

  size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  private evictIfOverCap(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

export function resolveSessionRotationConfig(
  explicit: { idleRotateMs?: number; jitterMs?: number; maxAgeMs?: number; perClient?: boolean } = {},
  env: NodeJS.ProcessEnv = process.env,
): SessionRotationConfig {
  const idleRotateMs = pickNonNegativeInt(
    explicit.idleRotateMs,
    env.CODEX_DARIO_SESSION_IDLE_ROTATE_MS,
    env.DARIO_SESSION_IDLE_ROTATE_MS,
  ) ?? 15 * 60 * 1000;
  const jitterMs = pickNonNegativeInt(
    explicit.jitterMs,
    env.CODEX_DARIO_SESSION_JITTER_MS,
    env.DARIO_SESSION_JITTER_MS,
  ) ?? 0;
  const maxAgeMs = pickPositiveInt(
    explicit.maxAgeMs,
    env.CODEX_DARIO_SESSION_MAX_AGE_MS,
    env.DARIO_SESSION_MAX_AGE_MS,
  );
  const perClient = pickBool(
    explicit.perClient,
    env.CODEX_DARIO_SESSION_PER_CLIENT,
    env.DARIO_SESSION_PER_CLIENT,
  ) ?? false;
  return { idleRotateMs, jitterMs, maxAgeMs, perClient };
}

function pickNonNegativeInt(...candidates: (number | string | undefined)[]): number | undefined {
  for (const c of candidates) {
    if (c === undefined || c === null || c === '') continue;
    const n = typeof c === 'number' ? c : parseInt(c, 10);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return undefined;
}

function pickPositiveInt(...candidates: (number | string | undefined)[]): number | undefined {
  for (const c of candidates) {
    if (c === undefined || c === null || c === '') continue;
    const n = typeof c === 'number' ? c : parseInt(c, 10);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return undefined;
}

function pickBool(...candidates: (boolean | string | undefined)[]): boolean | undefined {
  for (const c of candidates) {
    if (c === undefined || c === null) continue;
    if (typeof c === 'boolean') return c;
    const s = c.trim().toLowerCase();
    if (s === '') continue;
    if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true;
    if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false;
  }
  return undefined;
}
