/**
 * Stream-consumption replay for codex-dario.
 *
 * When a client disconnects mid-stream, continue consuming the
 * upstream SSE to EOF — matching real Codex CLI's stream behavior.
 */

export type ClientCloseAction = 'abort' | 'drain' | 'noop';

export function decideOnClientClose(
  writableEnded: boolean,
  upstreamAborted: boolean,
  drainOnClose: boolean,
): ClientCloseAction {
  if (writableEnded || upstreamAborted) return 'noop';
  return drainOnClose ? 'drain' : 'abort';
}

export function resolveDrainOnClose(
  explicit: boolean | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (typeof explicit === 'boolean') return explicit;
  const v = (env.CODEX_DARIO_DRAIN_ON_CLOSE ?? env.DARIO_DRAIN_ON_CLOSE ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}
