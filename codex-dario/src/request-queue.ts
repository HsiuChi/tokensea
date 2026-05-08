/**
 * Bounded request queue for codex-dario.
 *
 * Identical to dario's request-queue.ts — pure admission control
 * with configurable concurrency, queue size, and timeout.
 */

export interface QueueState {
  active: number;
  queued: number;
  maxConcurrent: number;
  maxQueued: number;
}

export type AdmitDecision =
  | { action: 'admit' }
  | { action: 'enqueue' }
  | { action: 'reject'; reason: 'queue-full' };

export function decideAdmit(state: QueueState): AdmitDecision {
  if (state.active < state.maxConcurrent) return { action: 'admit' };
  if (state.queued < state.maxQueued) return { action: 'enqueue' };
  return { action: 'reject', reason: 'queue-full' };
}

export function isQueueEntryExpired(enqueuedAt: number, now: number, timeoutMs: number): boolean {
  return (now - enqueuedAt) > timeoutMs;
}

export class QueueFullError extends Error {
  constructor() { super('queue-full'); this.name = 'QueueFullError'; }
}

export class QueueTimeoutError extends Error {
  constructor() { super('queue-timeout'); this.name = 'QueueTimeoutError'; }
}

interface QueueEntry {
  resolve: () => void;
  reject: (err: Error) => void;
  enqueuedAt: number;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

export interface RequestQueueOptions {
  maxConcurrent?: number;
  maxQueued?: number;
  queueTimeoutMs?: number;
  unrefTimers?: boolean;
}

export const DEFAULT_MAX_CONCURRENT = 10;
export const DEFAULT_MAX_QUEUED = 128;
export const DEFAULT_QUEUE_TIMEOUT_MS = 60_000;

export class RequestQueue {
  readonly maxConcurrent: number;
  readonly maxQueued: number;
  readonly queueTimeoutMs: number;
  readonly unrefTimers: boolean;
  private active = 0;
  private queue: QueueEntry[] = [];

  constructor(opts: RequestQueueOptions = {}) {
    this.maxConcurrent = opts.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    this.maxQueued = opts.maxQueued ?? DEFAULT_MAX_QUEUED;
    this.queueTimeoutMs = opts.queueTimeoutMs ?? DEFAULT_QUEUE_TIMEOUT_MS;
    this.unrefTimers = opts.unrefTimers ?? true;
  }

  async acquire(): Promise<void> {
    const decision = decideAdmit(this.snapshot());
    if (decision.action === 'admit') {
      this.active++;
      return;
    }
    if (decision.action === 'reject') {
      throw new QueueFullError();
    }
    return new Promise<void>((resolve, reject) => {
      const enqueuedAt = Date.now();
      const timeoutHandle = setTimeout(() => {
        const idx = this.queue.indexOf(entry);
        if (idx >= 0) {
          this.queue.splice(idx, 1);
          reject(new QueueTimeoutError());
        }
      }, this.queueTimeoutMs);
      if (this.unrefTimers) timeoutHandle.unref?.();
      const entry: QueueEntry = { resolve, reject, enqueuedAt, timeoutHandle };
      this.queue.push(entry);
    });
  }

  release(): void {
    if (this.active > 0) this.active--;
    const next = this.queue.shift();
    if (next) {
      clearTimeout(next.timeoutHandle);
      this.active++;
      next.resolve();
    }
  }

  snapshot(): QueueState {
    return {
      active: this.active,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
      maxQueued: this.maxQueued,
    };
  }
}
