/**
 * TLS sidecar client — main-process side of the Node.js TLS sidecar.
 *
 * When dario runs on Bun, its outbound TLS fingerprint (BoringSSL) differs
 * from real Claude Code's (OpenSSL). The sidecar is a Node.js child process
 * that handles all outbound HTTPS connections to api.anthropic.com, producing
 * an OpenSSL-shaped ClientHello that matches CC.
 *
 * Usage:
 *   const client = new TlsSidecarClient();
 *   await client.start();
 *   const resp = await client.fetch('https://api.anthropic.com/v1/messages?beta=true', {
 *     method: 'POST',
 *     headers: { ... },
 *     body: ...,
 *     signal: abortController.signal,
 *   });
 *   // resp is a standard Response with streaming body
 *
 * The sidecar is only needed when dario runs on Bun. On Node.js or in shim
 * mode, the TLS fingerprint already matches CC and the sidecar is not started.
 */

import { spawn as spawnChild, type ChildProcess } from 'node:child_process';
import { createConnection as netConnect, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { dirname, join as joinPath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unlinkSync } from 'node:fs';

// ---------------------------------------------------------------------------
// locateSidecar() — find the .cjs sidecar script next to this compiled file
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
// → /app/dist/shim/ (after compilation)

function locateSidecar(): string {
  return joinPath(__dirname, 'tls-sidecar.cjs');
  // → /app/dist/shim/tls-sidecar.cjs ✅
}

// ---------------------------------------------------------------------------
// headersToRecord() — safe type conversion for RequestInit.headers
// ---------------------------------------------------------------------------

/**
 * Convert various header representations to a flat Record<string, string>.
 * RequestInit.headers can be Headers, [string, string][], or Record<string, string>.
 */
export function headersToRecord(
  headers: Headers | [string, string][] | Record<string, string> | undefined,
): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const result: Record<string, string> = {};
    headers.forEach((v, k) => { result[k] = v; });
    return result;
  }
  if (Array.isArray(headers)) {
    const result: Record<string, string> = {};
    for (const [k, v] of headers) result[k] = v;
    return result;
  }
  return { ...headers };
}

// ---------------------------------------------------------------------------
// Pending request state
// ---------------------------------------------------------------------------

interface PendingRequest {
  /** Resolve the headers promise — called when sidecar sends headers message */
  headersResolve: (value: { status: number; headers: Record<string, string>; stream: ReadableStream<Uint8Array> }) => void;
  /** Reject the headers promise — called on sidecar error or abort */
  headersReject: (err: Error) => void;
  /** The ReadableStream controller for SSE chunks */
  streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  /** Chunks that arrived before streamController was set up (SSE race fix) */
  pendingChunks: Uint8Array[];
  /** The ReadableStream created before sending the request */
  stream: ReadableStream<Uint8Array>;
  /** The upstream abort signal — used to remove listener on cleanup */
  signal?: AbortSignal;
  /** The upstream abort signal listener — detached on cleanup */
  abortListener?: () => void;
  /** Whether the request has been cleaned up */
  done: boolean;
}

// ---------------------------------------------------------------------------
// TlsSidecarClient
// ---------------------------------------------------------------------------

export class TlsSidecarClient {
  private child: ChildProcess | null = null;
  private sock: Socket | null = null;
  private socketPath = '';
  private pending: Map<string, PendingRequest> = new Map();
  private buffer = '';
  private _ready = false;
  private restarting = false;
  private sidecarPath: string = '';

  /** Whether the sidecar is ready to accept requests */
  get ready(): boolean {
    return this._ready;
  }

  /**
   * Start the sidecar child process and wait for it to become ready.
   * Returns false if the sidecar could not be started (e.g. Node.js not installed).
   */
  async start(): Promise<boolean> {
    this.sidecarPath = locateSidecar();

    // Generate a socket path
    const rand = randomUUID().slice(0, 8);
    this.socketPath = `/tmp/dario-sidecar-${rand}.sock`;

    const ok = await this.spawnAndWait();
    return ok;
  }

  /**
   * Spawn the sidecar process and wait for ready.
   * Separated from start() so restart() can reuse it.
   */
  private async spawnAndWait(): Promise<boolean> {
    try {
      this.child = spawnChild('node', [this.sidecarPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          DARIO_SIDECAR_SOCK: this.socketPath,
          DARIO_SIDECAR_VERBOSE: process.env.DARIO_SIDECAR_VERBOSE ?? '',
        },
      });
    } catch (err) {
      console.warn(`[dario] TLS sidecar: failed to spawn Node.js — ${err instanceof Error ? err.message : err}`);
      return false;
    }

    // Handle child process errors
    this.child.on('error', (err) => {
      console.warn(`[dario] TLS sidecar: process error — ${err.message}`);
      this._ready = false;
    });

    this.child.on('exit', (code) => {
      const wasReady = this._ready;
      this._ready = false;
      this.sock = null;
      if (wasReady) {
        console.warn(`[dario] TLS sidecar: exited unexpectedly (code=${code})`);
        this.rejectAllPending('sidecar exited');
        // Attempt automatic restart (issue #5)
        this.tryRestart();
      }
    });

    // Wait for the sidecar to signal ready
    try {
      await this.waitForReady(10_000);
    } catch (err) {
      console.warn(`[dario] TLS sidecar: failed to start — ${err instanceof Error ? err.message : err}`);
      this.killChild();
      return false;
    }

    return true;
  }

  /**
   * Attempt to restart the sidecar after an unexpected exit.
   * Uses exponential backoff: 1s, 2s, 4s, capped at 30s.
   */
  private async tryRestart(): Promise<void> {
    if (this.restarting) return;
    this.restarting = true;

    let attempt = 0;
    while (this.restarting) {
      attempt++;
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30_000);
      console.warn(`[dario] TLS sidecar: restart attempt ${attempt} in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));

      // Generate a new socket path for the fresh process
      const rand = randomUUID().slice(0, 8);
      this.socketPath = `/tmp/dario-sidecar-${rand}.sock`;

      const ok = await this.spawnAndWait();
      if (ok) {
        console.log(`[dario] TLS sidecar: restarted successfully`);
        this.restarting = false;
        return;
      }
      // Cap at 5 attempts before giving up
      if (attempt >= 5) {
        console.error(`[dario] TLS sidecar: gave up restarting after ${attempt} attempts — outbound TLS will use Bun (BoringSSL)`);
        this.restarting = false;
        return;
      }
    }
  }

  /**
   * Wait for the sidecar to become ready by reading its stdout.
   */
  private waitForReady(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('sidecar ready timeout'));
      }, timeoutMs);

      let stdoutBuf = '';
      const onData = (data: Buffer) => {
        stdoutBuf += data.toString();
        const lines = stdoutBuf.split('\n');
        stdoutBuf = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed);
            if (msg.type === 'ready') {
              clearTimeout(timeout);
              this.child!.stdout!.off('data', onData);
              // Now connect to the socket
              this.connectSocket().then(() => {
                this._ready = true;
                this.restarting = false;
                console.log(`[dario] TLS sidecar: ready (socket=${this.socketPath})`);
                resolve();
              }).catch(reject);
              return;
            }
          } catch { /* not JSON — ignore */ }
        }
      };

      if (this.child?.stdout) {
        this.child.stdout.on('data', onData);
      } else {
        clearTimeout(timeout);
        reject(new Error('sidecar has no stdout'));
      }
    });
  }

  /**
   * Connect to the sidecar's Unix socket.
   */
  private connectSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('socket connect timeout'));
      }, 5_000);

      this.sock = netConnect(this.socketPath, () => {
        clearTimeout(timeout);
        resolve();
      });

      this.sock.on('error', (err) => {
        clearTimeout(timeout);
        if (this._ready) {
          console.warn(`[dario] TLS sidecar: socket error — ${err.message}`);
        }
        reject(err);
      });

      this.sock.on('data', (data) => {
        this.onSocketData(data);
      });

      this.sock.on('close', () => {
        this._ready = false;
        this.sock = null;
        this.rejectAllPending('sidecar socket closed');
      });
    });
  }

  /**
   * Handle data from the sidecar socket.
   */
  private onSocketData(data: string | Buffer): void {
    this.buffer += data.toString();
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        this.dispatchMessage(msg as Record<string, unknown>);
      } catch { /* ignore parse errors */ }
    }
  }

  /**
   * Dispatch a message from the sidecar to the appropriate handler.
   */
  private dispatchMessage(msg: Record<string, unknown>): void {
    const { type, id } = msg;
    if (typeof id !== 'string') return;

    const pending = this.pending.get(id);
    if (!pending) return;

    switch (type) {
      case 'headers': {
        const status = msg.status as number;
        const headers = msg.headers as Record<string, string>;

        // The ReadableStream was already created in fetch() before the
        // request was sent. Its controller is pending.streamController.
        // Flush any buffered chunks that arrived before this callback.
        // (This can happen when headers and first chunk arrive in the
        // same socket data event — the SSE race that pendingChunks fixes.)
        if (pending.streamController) {
          for (const chunk of pending.pendingChunks) {
            try { pending.streamController.enqueue(chunk); } catch { /* stream cancelled */ }
          }
          pending.pendingChunks.length = 0;
        }

        // Resolve the headers promise — fetch() builds the Response from this
        pending.headersResolve({ status, headers, stream: pending.stream });
        break;
      }

      case 'chunk': {
        const data = msg.data as string;
        const chunk = new Uint8Array(Buffer.from(data, 'base64'));
        if (pending.streamController) {
          // Controller is ready — enqueue directly
          try {
            pending.streamController.enqueue(chunk);
          } catch { /* stream may have been cancelled */ }
        } else {
          // Controller not yet ready (headers not yet dispatched) — buffer
          pending.pendingChunks.push(chunk);
        }
        break;
      }

      case 'end': {
        if (!pending.done) {
          try { pending.streamController?.close(); } catch { /* already closed */ }
          pending.done = true;
        }
        this.cleanupPending(id);
        break;
      }

      case 'error': {
        const message = msg.message as string;
        if (!pending.done) {
          const err = new Error(`sidecar error: ${message}`);
          if (pending.streamController) {
            // Stream already started — close with error
            try { pending.streamController.error(err); } catch { /* already closed */ }
          } else {
            // Headers not yet resolved — reject the promise
            pending.headersReject(err);
          }
          pending.done = true;
        }
        this.cleanupPending(id);
        break;
      }
    }
  }

  /**
   * Clean up a pending request after completion or error.
   * Removes the abort listener from the signal to prevent leaks.
   */
  private cleanupPending(id: string): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    // Remove abort listener from signal to prevent leaks
    if (pending.signal && pending.abortListener) {
      pending.signal.removeEventListener('abort', pending.abortListener);
    }
    this.pending.delete(id);
  }

  /**
   * Reject all pending requests (e.g. on socket close / sidecar exit).
   */
  private rejectAllPending(reason: string): void {
    const err = new Error(reason);
    for (const [id, pending] of this.pending) {
      if (!pending.done) {
        pending.headersReject(err);
        try { pending.streamController?.error(err); } catch { /* noop */ }
        pending.done = true;
      }
      // Remove abort listener
      if (pending.signal && pending.abortListener) {
        pending.signal.removeEventListener('abort', pending.abortListener);
      }
    }
    this.pending.clear();
  }

  /**
   * Send a message to the sidecar over the Unix socket.
   */
  private send(msg: Record<string, unknown>): void {
    if (!this.sock || this.sock.destroyed) {
      throw new Error('sidecar socket not connected');
    }
    this.sock.write(JSON.stringify(msg) + '\n');
  }

  /**
   * Send an HTTPS request through the sidecar.
   * The interface matches fetch() — returns a standard Response with a streaming body.
   */
  async fetch(url: string, init: RequestInit & { timeout?: number } = {}): Promise<Response> {
    if (!this._ready) {
      throw new Error('sidecar not ready');
    }

    const id = randomUUID();
    const method = init.method ?? 'GET';
    const headerRecord = headersToRecord(
      init.headers as Headers | [string, string][] | Record<string, string> | undefined,
    );
    const signal = init.signal as AbortSignal | undefined;
    const timeout = init.timeout;

    // Encode body to base64
    let bodyB64: string | undefined;
    if (init.body != null) {
      if (typeof init.body === 'string') {
        bodyB64 = Buffer.from(init.body).toString('base64');
      } else if (init.body instanceof Uint8Array) {
        bodyB64 = Buffer.from(init.body).toString('base64');
      } else if (init.body instanceof ArrayBuffer) {
        bodyB64 = Buffer.from(init.body).toString('base64');
      } else if (typeof Blob !== 'undefined' && init.body instanceof Blob) {
        const buf = Buffer.from(await init.body.arrayBuffer());
        bodyB64 = buf.toString('base64');
      } else {
        // ReadableStream or other — read all chunks
        // For our use case (JSON bodies from SDK buildRequest), this is rare
        bodyB64 = Buffer.from(String(init.body)).toString('base64');
      }
    }

    // Create the ReadableStream BEFORE sending the request.
    // This ensures the controller is available when chunks arrive,
    // even if headers and first chunk arrive in the same socket data event.
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
      pull(_controller) {
        // Backpressure: could pause socket reads here if needed
      },
      cancel() {
        // Client cancelled the stream — rely on AbortSignal to send abort
      },
    });

    // Set up pending request
    const pendingReq: PendingRequest = {
      headersResolve: undefined!,
      headersReject: undefined!,
      streamController: undefined, // will be set below
      pendingChunks: [],
      stream,
      signal,
      done: false,
    };

    const headersPromise = new Promise<{ status: number; headers: Record<string, string>; stream: ReadableStream<Uint8Array> }>(
      (resolve, reject) => {
        pendingReq.headersResolve = resolve;
        pendingReq.headersReject = reject;
      },
    );

    // The streamController is set synchronously in the ReadableStream
    // constructor's start() callback, so it's available immediately.
    pendingReq.streamController = streamController;

    this.pending.set(id, pendingReq);

    // Handle abort signal — closes the ReadableStream on abort so the
    // consumer doesn't hang waiting for data that will never arrive.
    if (signal) {
      if (signal.aborted) {
        this.pending.delete(id);
        throw new DOMException('The operation was aborted', 'AbortError');
      }
      const abortListener = () => {
        if (pendingReq.done) return;
        pendingReq.done = true;
        // Close/error the ReadableStream so the consumer unblocks
        const abortErr = new DOMException('The operation was aborted', 'AbortError');
        if (pendingReq.streamController) {
          try { pendingReq.streamController.error(abortErr); } catch { /* already closed */ }
        }
        // Send abort to sidecar so it destroys the upstream request
        try {
          this.send({ type: 'abort', id });
        } catch { /* socket may already be closed */ }
        // Reject headers promise if it hasn't resolved yet
        pendingReq.headersReject(abortErr);
        this.cleanupPending(id);
      };
      pendingReq.abortListener = abortListener;
      signal.addEventListener('abort', abortListener, { once: true });
    }

    // Send the request to the sidecar (includes timeout)
    try {
      this.send({
        type: 'request',
        id,
        method,
        url,
        headers: headerRecord,
        body: bodyB64,
        timeout,
      });
    } catch (err) {
      this.cleanupPending(id);
      throw err;
    }

    // Wait for the sidecar to send back the response headers
    const { status, headers: respHeaders, stream: respStream } = await headersPromise;

    // Build a standard Response from the sidecar's response
    return new Response(respStream, {
      status,
      headers: respHeaders,
    });
  }

  /**
   * Kill the child process (used internally).
   */
  private killChild(): void {
    if (this.child && !this.child.killed) {
      try { this.child.kill('SIGKILL'); } catch { /* noop */ }
    }
    this.child = null;
  }

  /**
   * Close the sidecar and clean up.
   */
  async close(): Promise<void> {
    this._ready = false;
    this.restarting = false; // prevent restart attempts

    // Send shutdown
    try {
      if (this.sock && !this.sock.destroyed) {
        this.send({ type: 'shutdown' });
      }
    } catch { /* socket may already be closed */ }

    // Close socket
    try { this.sock?.destroy(); } catch { /* noop */ }
    this.sock = null;

    // Kill child process
    if (this.child && !this.child.killed) {
      this.child.kill('SIGTERM');
      // Wait for exit (with timeout)
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          this.killChild();
          resolve();
        }, 3000);
        this.child!.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
    this.child = null;

    // Clean up socket file
    try { unlinkSync(this.socketPath); } catch { /* noop */ }
  }
}
