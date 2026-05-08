/**
 * Inter-request pacing for codex-dario.
 *
 * Reuses dario's pacing logic with Codex-specific env var prefixes.
 */

export interface PacingConfig {
  minGapMs: number;
  jitterMs: number;
}

export function computePacingDelay(
  now: number,
  lastRequestTime: number,
  cfg: PacingConfig,
  rng: () => number = Math.random,
): number {
  if (lastRequestTime <= 0) return 0;
  const minGap = Math.max(0, cfg.minGapMs);
  const jitter = Math.max(0, cfg.jitterMs);
  const jitterAdd = jitter > 0 ? Math.floor(rng() * jitter) : 0;
  const effectiveGap = minGap + jitterAdd;
  const elapsed = now - lastRequestTime;
  if (elapsed >= effectiveGap) return 0;
  return effectiveGap - elapsed;
}

export function resolvePacingConfig(
  explicit: { minGapMs?: number; jitterMs?: number } = {},
  env: NodeJS.ProcessEnv = process.env,
): PacingConfig {
  const minGap = pickNonNegativeInt(
    explicit.minGapMs,
    env.CODEX_DARIO_PACE_MIN_MS,
    env.DARIO_PACE_MIN_MS,
  ) ?? 500;
  const jitter = pickNonNegativeInt(
    explicit.jitterMs,
    env.CODEX_DARIO_PACE_JITTER_MS,
    env.DARIO_PACE_JITTER_MS,
  ) ?? 0;
  return { minGapMs: minGap, jitterMs: jitter };
}

function pickNonNegativeInt(...candidates: (number | string | undefined)[]): number | undefined {
  for (const c of candidates) {
    if (c === undefined || c === null || c === '') continue;
    const n = typeof c === 'number' ? c : parseInt(c, 10);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return undefined;
}
