/**
 * TLS Shim IPC Client — communicates with the Rust tls-shim binary
 * over a Unix Domain Socket.
 *
 * The tls-shim binary uses tokio-rustls + ring + hyper, producing a
 * TLS ClientHello fingerprint that matches the real Codex CLI. This
 * client sends JSON-encoded request descriptors and receives JSON-
 * encoded responses over a newline-delimited Unix socket stream.
 */

import { connect } from 'node:net';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';

const DEFAULT_SOCKET_PATH = join(homedir(), '.codex-dario', 'tls-shim.sock');

export interface ShimRequest {
  id: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface ShimResponse {
  id: string;
  status: number;
  headers: Record<string, string>;
  body?: string;
  stream_first_chunk?: string;
  error?: string;
}

export class TlsShimClient {
  private socketPath: string;
  private shimProcess: ChildProcess | null = null;
  private requestCounter = 0;
  private pendingRequests: Map<string, {
    resolve: (response: ShimResponse) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }> = new Map();
  private buffer = '';
  private connected = false;
  private reconnectTimer: ReturnType<typeof setInterval> | null = null;
  private shimBinaryPath: string;

  constructor(opts?: {
    socketPath?: string;
    shimBinaryPath?: string;
  }) {
    this.socketPath = opts?.socketPath || process.env.CODEX_DARIO_TLS_SHIM_SOCKET || DEFAULT_SOCKET_PATH;
    this.shimBinaryPath = opts?.shimBinaryPath || process.env.CODEX_DARIO_TLS_SHIM_BINARY || 'tls-shim';
  }

  /** Start the tls-shim binary and connect to its Unix socket. */
  async start(): Promise<void> {
    // If the socket already exists (e.g. started by entrypoint.sh), skip spawning
    // and connect directly. This avoids deleting the socket of a running shim.
    const socketExists = existsSync(this.socketPath);

    if (!socketExists) {
      // Spawn the Rust binary ourselves
      this.shimProcess = spawn(this.shimBinaryPath, [this.socketPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });

      this.shimProcess.on('error', (err) => {
        console.error(`[tls-shim-client] Failed to spawn tls-shim: ${err.message}`);
      });

      this.shimProcess.on('exit', (code, signal) => {
        if (code !== 0 && code !== null) {
          console.error(`[tls-shim-client] tls-shim exited with code ${code}`);
        }
        this.connected = false;
      });

      // Wait for the socket to become available
      await this.waitForSocket(5000);
    }

    // Start the connection
    this.connect();

    // Start a reconnection timer
    this.reconnectTimer = setInterval(() => {
      if (!this.connected) {
        this.connect();
      }
    }, 3000);

    if (this.reconnectTimer) this.reconnectTimer.unref();
  }

  /** Stop the tls-shim binary and clean up. */
  async stop(): Promise<void> {
    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('tls-shim shutting down'));
      this.pendingRequests.delete(id);
    }

    if (this.shimProcess) {
      this.shimProcess.kill('SIGTERM');
      // Give it a moment to clean up the socket
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          this.shimProcess?.kill('SIGKILL');
          resolve();
        }, 3000);
        this.shimProcess?.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
      this.shimProcess = null;
    }

    // Clean up socket file
    try {
      if (existsSync(this.socketPath)) {
        unlinkSync(this.socketPath);
      }
    } catch { /* ignore */ }
  }

  /** Execute an HTTPS request through the tls-shim. */
  async request(opts: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  }): Promise<ShimResponse> {
    if (!this.connected) {
      throw new Error('tls-shim not connected');
    }

    const id = `${++this.requestCounter}-${randomUUID().slice(0, 8)}`;
    const req: ShimRequest = {
      id,
      method: opts.method,
      url: opts.url,
      headers: opts.headers,
      body: opts.body,
    };

    return new Promise<ShimResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`tls-shim request timed out after ${opts.timeoutMs ?? 30000}ms`));
      }, opts.timeoutMs ?? 30000);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      const line = JSON.stringify(req) + '\n';
      this.sendRaw(line);
    });
  }

  /** Check if the shim is connected and ready. */
  get isConnected(): boolean {
    return this.connected;
  }

  // ── Private ──────────────────────────────────────────────────────

  private socket: ReturnType<typeof connect> | null = null;

  private connect(): void {
    if (this.connected && this.socket) return;

    try {
      this.socket = connect(this.socketPath, () => {
        this.connected = true;
      });

      this.socket.on('data', (data: Buffer) => {
        this.handleData(data.toString('utf-8'));
      });

      this.socket.on('error', (err: Error) => {
        console.error(`[tls-shim-client] Socket error: ${err.message}`);
        this.connected = false;
      });

      this.socket.on('close', () => {
        this.connected = false;
      });
    } catch (err) {
      console.error(`[tls-shim-client] Connect failed: ${err instanceof Error ? err.message : err}`);
      this.connected = false;
    }
  }

  private handleData(data: string): void {
    this.buffer += data;

    // Process complete lines (newline-delimited JSON)
    let newlineIdx: number;
    while ((newlineIdx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIdx).trim();
      this.buffer = this.buffer.slice(newlineIdx + 1);

      if (!line) continue;

      try {
        const resp: ShimResponse = JSON.parse(line);
        const pending = this.pendingRequests.get(resp.id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(resp.id);
          if (resp.error) {
            pending.reject(new Error(`tls-shim error: ${resp.error}`));
          } else {
            pending.resolve(resp);
          }
        }
      } catch {
        console.error(`[tls-shim-client] Failed to parse response: ${line.slice(0, 200)}`);
      }
    }
  }

  private sendRaw(data: string): void {
    if (!this.socket || !this.connected) {
      throw new Error('tls-shim not connected');
    }
    this.socket.write(data);
  }

  private async waitForSocket(timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (existsSync(this.socketPath)) {
        // Small delay to let the shim finish binding
        await new Promise(r => setTimeout(r, 100));
        return;
      }
      await new Promise(r => setTimeout(r, 200));
    }
    throw new Error(`tls-shim socket not found at ${this.socketPath} after ${timeoutMs}ms`);
  }
}
