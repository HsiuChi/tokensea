/**
 * Health probe worker.
 *
 * Periodically probes every ChannelNode (probeEnabled channel, status != disabled)
 * and transitions node.status through healthy → degraded → unhealthy based on
 * consecutive success/failure counts. Decoupled from the relay request path.
 *
 * Distributed lock via Redis prevents multi-instance duplicate probing.
 */
import type { PrismaClient } from "@prisma/client";
import type Redis from "ioredis";
import { redisKeys } from "../../lib/redis-keys.js";
import { dispatchWebhookEvent } from "../notify/webhook-service.js";
import { probeCpa, upstreamHeaders, upstreamUrl } from "./upstream-request.js";

const PROBE_INTERVAL_MS = 30_000;
const PROBE_CONCURRENCY = 10;
const FAIL_THRESHOLD = 3;
const RECOVER_THRESHOLD = 2;
const LOCK_TTL_S = 25;

export interface ProbeConfig {
  intervalMs?: number;
  concurrency?: number;
  failThreshold?: number;
  recoverThreshold?: number;
}

export function startHealthProbeWorker(
  prisma: PrismaClient,
  redis: Redis,
  cfg: ProbeConfig = {},
): { stop: () => void } {
  const intervalMs = cfg.intervalMs ?? PROBE_INTERVAL_MS;
  const concurrency = cfg.concurrency ?? PROBE_CONCURRENCY;
  const failThreshold = cfg.failThreshold ?? FAIL_THRESHOLD;
  const recoverThreshold = cfg.recoverThreshold ?? RECOVER_THRESHOLD;

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const probeOne = async (node: any): Promise<void> => {
    // distributed lock — skip if another instance is already probing this node
    const lockKey = `probe:lock:${node.id}`;
    const got = await redis.set(lockKey, "1", "EX", LOCK_TTL_S, "NX");
    if (!got) return;

    try {
      if (node.adapter === "cpa") {
        try {
          const result = await probeCpa(node);
          if (result.healthy) await updateSuccess(node, result.latency, { modelCount: result.models.length }, prisma, recoverThreshold);
          else await updateFail(node, prisma, failThreshold);
        } catch {
          await updateFail(node, prisma, failThreshold);
        }
        return;
      }
      const path = node.probePath || "/health";
      const timeoutMs = node.probeTimeoutMs ?? 5000;
      const start = Date.now();
      let ok = false;
      let body: any = null;
      try {
        const res = await fetch(upstreamUrl(node.internalUrl, path), {
          signal: AbortSignal.timeout(timeoutMs),
          headers: upstreamHeaders(node, path),
        });
        const latency = Date.now() - start;
        // Node is considered reachable if it returns any JSON we can parse
        // (even 503 with status:degraded means the node process is up — the
        // upstream account state is the dario layer's concern, not the probe).
        // Only network errors / non-JSON / 404-no-fallback count as fail.
        if (res.status === 401 || res.status === 403) {
          // auth required but our key was rejected → try fallback endpoint
          const fallbackPath = path === "/health" ? "/healthz" : "/health";
          const r2 = await fetch(upstreamUrl(node.internalUrl, fallbackPath), {
            signal: AbortSignal.timeout(timeoutMs),
            headers: upstreamHeaders(node, fallbackPath),
          });
          const l2 = Date.now() - start;
          if (r2.ok || r2.status === 503) {
            body = await r2.json().catch(() => null);
            await updateSuccess(node, l2, body, prisma, recoverThreshold);
          } else {
            await updateFail(node, prisma, failThreshold);
          }
        } else if (res.status === 404) {
          // endpoint not found → fallback
          const fallbackPath = path === "/health" ? "/healthz" : "/health";
          const r2 = await fetch(upstreamUrl(node.internalUrl, fallbackPath), {
            signal: AbortSignal.timeout(timeoutMs),
            headers: upstreamHeaders(node, fallbackPath),
          });
          const l2 = Date.now() - start;
          if (r2.ok || r2.status === 503) {
            body = await r2.json().catch(() => null);
            await updateSuccess(node, l2, body, prisma, recoverThreshold);
          } else {
            await updateFail(node, prisma, failThreshold);
          }
        } else if (res.ok || res.status === 503) {
          // 200 or 503(degraded) — node process is alive
          ok = true;
          body = await res.json().catch(() => null);
          await updateSuccess(node, latency, body, prisma, recoverThreshold);
        } else {
          await updateFail(node, prisma, failThreshold);
        }
      } catch {
        await updateFail(node, prisma, failThreshold);
      }
      void ok;
    } finally {
      await redis.del(lockKey);
    }
  };

  const tick = async () => {
    if (stopped) return;
    try {
      const nodes = await prisma.channelNode.findMany({
        where: { channel: { probeEnabled: true, status: "active" } },
        include: { channel: true },
      });
      // limited concurrency
      const running: Promise<void>[] = [];
      for (const n of nodes) {
        running.push(probeOne(n));
        if (running.length >= concurrency) {
          await Promise.allSettled(running.splice(0));
        }
      }
      await Promise.allSettled(running);
    } catch (err) {
      console.error("[health-probe] tick error:", err);
    }
  };

  // fire one immediately, then on interval
  tick();
  timer = setInterval(tick, intervalMs);

  return { stop: () => {
    stopped = true;
    if (timer) clearInterval(timer);
  } };
}

async function updateSuccess(
  node: any,
  latency: number,
  body: any,
  prisma: PrismaClient,
  recoverThreshold: number,
): Promise<void> {
  const succ = (node.consecutiveSuccesses ?? 0) + 1;
  const wasUnhealthy = node.status === "unhealthy";
  // recover to healthy only after threshold AND currently not healthy
  const newStatus = wasUnhealthy && succ >= recoverThreshold
    ? "healthy"
    : node.status === "degraded" && succ >= recoverThreshold
      ? "healthy"
      : node.status;
  if (newStatus !== node.status && newStatus === "healthy") {
    dispatchWebhookEvent(prisma, "node.recovered", {
      nodeId: node.id.toString(), node: node.name, channel: node.channel?.name, latencyMs: latency,
    });
  }
  await prisma.channelNode.update({
    where: { id: node.id },
    data: {
      status: newStatus as any,
      lastHealthCheck: new Date(),
      probeLatency: latency,
      healthStatus: body,
      consecutiveSuccesses: succ,
      consecutiveFails: 0,
    },
  });
}

async function updateFail(
  node: any,
  prisma: PrismaClient,
  failThreshold: number,
): Promise<void> {
  const fails = (node.consecutiveFails ?? 0) + 1;
  let newStatus = node.status;
  if (fails >= failThreshold) newStatus = "unhealthy";
  else if (fails === 1 && node.status === "healthy") newStatus = "degraded";
  if (newStatus !== node.status && (newStatus === "unhealthy" || newStatus === "degraded")) {
    dispatchWebhookEvent(prisma, `node.${newStatus}` as any, {
      nodeId: node.id.toString(), node: node.name, channel: node.channel?.name, consecutiveFails: fails,
    });
  }
  await prisma.channelNode.update({
    where: { id: node.id },
    data: {
      status: newStatus as any,
      lastHealthCheck: new Date(),
      consecutiveFails: fails,
      consecutiveSuccesses: 0,
    },
  });
}

// keep redisKeys import referenced (used by other modules in this dir)
void redisKeys;
