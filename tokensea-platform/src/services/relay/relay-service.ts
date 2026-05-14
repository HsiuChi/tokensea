import type { FastifyRequest, FastifyReply } from "fastify";
import type { PrismaClient, ApiKey, Plan, ChannelNode } from "@prisma/client";
import type Redis from "ioredis";
import { createHash } from "node:crypto";
import { hashApiKey } from "../../lib/crypto.js";
import { verifyToken } from "../../lib/jwt.js";
import { redisKeys } from "../../lib/redis-keys.js";
import { unauthorized, forbidden, rateLimited, internalError, badRequest } from "../../lib/errors.js";
import { SensitiveWordService } from "../sensitive/sensitive-service.js";
import { v4 as uuid } from "uuid";

interface RelayContext {
  requestId: string;
  apiKey: ApiKey & { user: any; plan: any };
  model: string;
  upstreamModel: string;
  channelId: bigint;
  nodeId: bigint;
  nodeUrl: string;
  nodeApiKey: string;
  startedAt: Date;
  protocol: "anthropic" | "openai";
}

interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

// ---- User soft partitioning ----
// Each user gets PARTITION_WIDTH preferred nodes via consistent hash.
// Controls blast radius: one user can only saturate PARTITION_WIDTH nodes
// before spilling to the global pool.

const PARTITION_WIDTH = 2;
const NODE_HEALTH_TTL_S = 30; // Redis TTL for node health cache
const CROSS_NODE_MAX_RETRIES = 3; // Max node-level 429 retries

interface NodeHealth {
  avgHeadroom: number; // 0–100, average across all accounts on the node
  healthyAccounts: number;
  totalAccounts: number;
  updatedAt: number;
}

function preferredNodeIds(userId: bigint, nodeIds: bigint[], width: number = PARTITION_WIDTH): bigint[] {
  if (nodeIds.length === 0) return [];
  const effectiveWidth = Math.min(width, nodeIds.length);
  const hash = parseInt(
    createHash('sha256').update(`node-partition:${userId.toString()}`).digest('hex').slice(0, 8),
    16,
  );
  const result: bigint[] = [];
  const used = new Set<number>();
  for (let i = 0; i < effectiveWidth; i++) {
    let idx = (hash + i) % nodeIds.length;
    let probe = 0;
    while (used.has(idx) && probe < nodeIds.length) {
      idx = (idx + 1) % nodeIds.length;
      probe++;
    }
    used.add(idx);
    result.push(nodeIds[idx]);
  }
  return result;
}

export class RelayService {
  constructor(
    private prisma: PrismaClient,
    private redis: Redis,
  ) {}

  async handleRequest(request: FastifyRequest, reply: FastifyReply) {
    const startedAt = new Date();
    const requestId = uuid();

    // ① Auth — accept API key (tsk-*) or JWT (Playground)
    const apiKey = await this.resolveApiKey(request);

    if (apiKey.expiresAt && apiKey.expiresAt < startedAt) {
      throw unauthorized("API key expired");
    }
    if (apiKey.user.status === "disabled") throw forbidden("Account is disabled");

    // ② Model access — controlled by key.models (empty = all models)
    const body = request.body as any;
    const requestedModel = body.model ?? (request.query as any).model;
    if (!requestedModel) throw forbidden("Model is required");

    const keyModels = apiKey.models as string[] | null;
    if (keyModels && keyModels.length > 0 && !keyModels.includes(requestedModel)) {
      throw forbidden(`Model ${requestedModel} not allowed on this key`);
    }

    // ③ Quota checks (Redis)
    await this.checkQuota(apiKey);

    // ④ Rate limit checks (Redis) — defaults if no plan
    const plan = apiKey.plan;
    await this.checkRateLimit(apiKey.userId, plan);

    // ⑤½ Sensitive word filtering
    const contentText = this.extractContentText(body);
    if (contentText) {
      const sensitiveService = new SensitiveWordService(this.prisma, this.redis);
      const check = await sensitiveService.checkContent(contentText);
      if (check.blocked) {
        throw badRequest(`Content contains prohibited content`);
      }
      if (check.action === "replace") {
        this.sanitizeContentText(body, sensitiveService);
      }
    }

    // ⑥ Route to node (with cross-node 429 failover)
    const { alias, routes } = await this.resolveRoute(requestedModel);
    const allNodes = await this.getHealthyNodes(routes);
    if (allNodes.length === 0) throw internalError("No available upstream nodes");

    // Cross-node failover loop
    const triedNodeIds = new Set<string>();
    let lastError: any;

    for (let attempt = 0; attempt < Math.min(allNodes.length, CROSS_NODE_MAX_RETRIES); attempt++) {
      const node = this.selectNodeWithPartition(apiKey.userId, allNodes, triedNodeIds);
      if (!node) break;

      triedNodeIds.add(node.id.toString());

      const isAnthropicEndpoint = request.url.startsWith("/v1/messages");
      const ctx: RelayContext = {
        requestId,
        apiKey: apiKey as any,
        model: requestedModel,
        upstreamModel: routes[0]?.upstreamModel ?? requestedModel,
        channelId: node.channelId,
        nodeId: node.id,
        nodeUrl: node.internalUrl,
        nodeApiKey: node.internalApiKey,
        startedAt,
        protocol: isAnthropicEndpoint ? "anthropic" : "openai",
      };

      try {
        // Transparent proxy: forward to dario on the SAME path the client used.
        // dario handles both /v1/messages (Anthropic) and /v1/chat/completions (OpenAI),
        // including protocol conversion, CC passthrough, and template replay internally.
        const upstreamUrl = `${node.internalUrl}${request.url}`;

        // Forward ALL original headers to dario. Only replace auth.
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(request.headers)) {
          if (typeof value !== "string") continue;
          const lower = key.toLowerCase();
          if (lower === "host" || lower === "connection" || lower === "transfer-encoding" ||
              lower === "content-length" || lower === "accept-encoding" ||
              lower === "authorization" || lower === "x-api-key") continue;
          headers[key] = value;
        }
        headers["x-api-key"] = node.internalApiKey;
        headers["x-request-id"] = requestId;
        headers["x-tokensea-user"] = apiKey.userId.toString();

        // Forward body as-is. dario handles everything:
        // CC clients → passthrough (token swap only)
        // Non-CC clients → template replay (CC fingerprint injection)
        // Model mapping, protocol conversion — all done by dario
        const upstreamBody = body;
        const isStream = body.stream === true;

        if (isStream) {
          await this.handleStreamRequest(request, reply, upstreamUrl, headers, upstreamBody, ctx);
        } else {
          await this.handleNonStreamRequest(request, reply, upstreamUrl, headers, upstreamBody, ctx);
        }
        return; // Success — exit failover loop
      } catch (err: any) {
        lastError = err;
        // If 429, try next node; otherwise throw immediately
        if (err?.statusCode !== 429 && err?.statusCode !== 503) {
          request.log.error({ err, requestId }, "Upstream request failed");
          await this.settle(ctx, { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }, "failed", err.statusCode ?? 502, err.code);
          throw internalError("Upstream request failed");
        }
        // 429/503 — try next node
        request.log.warn({ err, requestId, nodeId: node.id.toString(), attempt }, "Node returned 429/503, trying next node");
        // Mark node cooldown
        await this.redis.set(
          redisKeys.nodeCooldown(node.id),
          "1",
          "EX",
          60, // 60s cooldown
        );
      }
    }

    // All attempts exhausted
    throw internalError(lastError?.message ?? "All upstream nodes exhausted");
  }

  private async handleNonStreamRequest(
    request: FastifyRequest,
    reply: FastifyReply,
    upstreamUrl: string,
    headers: Record<string, string>,
    body: any,
    ctx: RelayContext,
  ) {
    const response = await fetch(upstreamUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      // For 429/503, throw to allow cross-node failover
      if (response.status === 429 || response.status === 503) {
        const errorBody = await response.text();
        await this.settle(ctx, { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }, "failed", response.status);
        const err: any = new Error(errorBody);
        err.statusCode = response.status;
        throw err;
      }
      const errorBody = await response.text();
      await this.settle(ctx, { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }, "failed", response.status);
      reply.code(response.status).send(errorBody);
      return;
    }

    const responseBody = await response.json();
    const usage = this.extractUsage(responseBody, ctx.protocol);
    await this.settle(ctx, usage, "succeeded", 200);

    reply.code(200).header("content-type", "application/json").send(responseBody);
  }

  private async handleStreamRequest(
    request: FastifyRequest,
    reply: FastifyReply,
    upstreamUrl: string,
    headers: Record<string, string>,
    body: any,
    ctx: RelayContext,
  ) {
    const response = await fetch(upstreamUrl, {
      method: "POST",
      headers: { ...headers, accept: "text/event-stream" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      // For 429/503, throw to allow cross-node failover
      if (response.status === 429 || response.status === 503) {
        const errorBody = await response.text();
        await this.settle(ctx, { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }, "failed", response.status);
        const err: any = new Error(errorBody);
        err.statusCode = response.status;
        throw err;
      }
      const errorBody = await response.text();
      await this.settle(ctx, { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }, "failed", response.status);
      reply.code(response.status).send(errorBody);
      return;
    }

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheCreationTokens = 0;
    let cacheReadTokens = 0;

    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          reply.raw.write(chunk);

          // Try to extract usage from SSE events
          const tokenInfo = this.extractTokensFromSSE(chunk, ctx.protocol);
          inputTokens += tokenInfo.inputTokens;
          outputTokens += tokenInfo.outputTokens;
          cacheCreationTokens += tokenInfo.cacheCreationTokens;
          cacheReadTokens += tokenInfo.cacheReadTokens;
        }
      } catch (err) {
        request.log.error({ err, requestId: ctx.requestId }, "Stream error");
      }
    }

    reply.raw.end();
    await this.settle(ctx, { inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens }, "succeeded", 200);
  }

  // ---- Auth ----

  private async resolveApiKey(request: FastifyRequest) {
    const authHeader = request.headers.authorization;
    const xApiKey = request.headers["x-api-key"] as string | undefined;
    let rawKey: string;
    if (authHeader?.startsWith("Bearer ")) {
      rawKey = authHeader.slice(7);
    } else if (xApiKey) {
      rawKey = xApiKey;
    } else {
      throw unauthorized("Missing API key");
    }
    let apiKey: any;
    if (rawKey.startsWith("tsk-")) {
      const keyHash = hashApiKey(rawKey);
      apiKey = await this.prisma.apiKey.findUnique({
        where: { keyHash },
        include: { user: true, plan: true },
      });
    } else {
      try {
        const payload = verifyToken(rawKey, (request.server as any).env?.JWT_SECRET || process.env.JWT_SECRET);
        apiKey = await this.prisma.apiKey.findFirst({
          where: { userId: payload.userId, status: "active" },
          include: { user: true, plan: true },
          orderBy: { createdAt: "asc" },
        });
      } catch {}
    }
    if (!apiKey || apiKey.status !== "active") throw unauthorized("Invalid API key");
    return apiKey;
  }

  // ---- Quota check ----

  private async checkQuota(apiKey: any) {
    const user = apiKey.user;

    // User wallet balance
    if (user.quota >= 0n && user.usedQuota >= user.quota) {
      throw rateLimited("User quota exhausted");
    }

    // Key quota
    if (apiKey.quota > 0 && apiKey.usedQuota >= apiKey.quota) {
      throw rateLimited("API key quota exhausted");
    }

    // Key call limit
    if (apiKey.maxCalls > 0 && apiKey.usedCalls >= apiKey.maxCalls) {
      throw rateLimited("API key call limit reached");
    }

    // Daily spending limit — user-level tracking, default $50/day unless key says unlimited (-1)
    if (apiKey.dailyLimit !== -1n) {
      const dailyLimit = Number(apiKey.dailyLimit > 0 ? apiKey.dailyLimit : 50_000_000);
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const dailyKey = redisKeys.userDailySpending(user.id, today);
      const dailySpent = await this.redis.get(dailyKey);
      if (dailySpent && Number(dailySpent) >= dailyLimit) {
        throw rateLimited("Daily spending limit reached");
      }
    }
  }

  // ---- Rate limit ----

  private async checkRateLimit(userId: bigint, plan: any | null) {
    const qpsLimit = plan?.qpsLimit ?? 5;
    const rpmLimit = plan?.rpmLimit ?? 60;
    const now = Date.now();

    // QPS
    if (qpsLimit > 0) {
      const key = redisKeys.qps(userId);
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, 1);
      if (count > qpsLimit) throw rateLimited("QPS limit exceeded");
    }

    // RPM
    if (rpmLimit > 0) {
      const key = redisKeys.rpm(userId);
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, 60);
      if (count > rpmLimit) throw rateLimited("RPM limit exceeded");
    }
  }

  // ---- Routing ----

  private async resolveRoute(modelAlias: string) {
    const alias = await this.prisma.modelAlias.findUnique({
      where: { alias: modelAlias },
      include: {
        routes: {
          where: { status: "active" },
          orderBy: { priority: "desc" },
          include: { channel: true },
        },
      },
    });

    if (!alias || alias.routes.length === 0) {
      throw forbidden(`No route found for model: ${modelAlias}`);
    }

    return { alias, routes: alias.routes };
  }

  /**
   * Get all healthy, non-cooled-down nodes for a set of routes.
   * Returns nodes sorted by health (best headroom first).
   */
  private async getHealthyNodes(routes: any[]): Promise<ChannelNode[]> {
    for (const route of routes) {
      const nodes = await this.prisma.channelNode.findMany({
        where: {
          channelId: route.channelId,
          status: "healthy",
        },
      });

      const available: ChannelNode[] = [];
      for (const node of nodes) {
        const cooldownKey = redisKeys.nodeCooldown(node.id);
        const isCooling = await this.redis.exists(cooldownKey);
        if (!isCooling) available.push(node);
      }

      if (available.length > 0) return available;
    }
    return [];
  }

  /**
   * Select a node using user soft partitioning + headroom-aware ordering.
   * 1. Check session affinity (Redis) — if bound node is healthy, use it
   * 2. Compute preferred nodes for the user (consistent hash)
   * 3. Among preferred + remaining, pick the one with best headroom
   */
  private selectNodeWithPartition(
    userId: bigint,
    allNodes: ChannelNode[],
    excludeIds: Set<string>,
  ): ChannelNode | null {
    const candidates = allNodes.filter(n => !excludeIds.has(n.id.toString()));
    if (candidates.length === 0) return null;

    // Compute preferred node IDs via soft partitioning
    const allNodeIds = candidates.map(n => n.id).sort((a, b) => {
      const ba = BigInt.asUintN(64, a);
      const bb = BigInt.asUintN(64, b);
      return ba < bb ? -1 : ba > bb ? 1 : 0;
    });
    const preferredIds = new Set(
      preferredNodeIds(userId, allNodeIds, PARTITION_WIDTH).map(id => id.toString()),
    );

    // Separate preferred and non-preferred, then sort each by headroom
    const preferred: ChannelNode[] = [];
    const rest: ChannelNode[] = [];
    for (const node of candidates) {
      if (preferredIds.has(node.id.toString())) {
        preferred.push(node);
      } else {
        rest.push(node);
      }
    }

    // Sort by cached headroom (desc) — preferred nodes first
    const sortByHeadroom = (a: ChannelNode, b: ChannelNode): number => {
      const hA = this.getCachedHeadroom(a.id);
      const hB = this.getCachedHeadroom(b.id);
      return hB - hA;
    };
    preferred.sort(sortByHeadroom);
    rest.sort(sortByHeadroom);

    // Pick: preferred first (if any have headroom > 0), then global pool
    const preferredWithHeadroom = preferred.filter(n => this.getCachedHeadroom(n.id) > 2);
    if (preferredWithHeadroom.length > 0) return preferredWithHeadroom[0];

    // All preferred exhausted — best from global pool
    const allSorted = [...preferred, ...rest].sort(sortByHeadroom);
    return allSorted[0] ?? null;
  }

  /**
   * Get cached headroom for a node from Redis. Returns 50 (default)
   * if no health data is available (new node, cache miss).
   */
  private getCachedHeadroom(nodeId: bigint): number {
    // Use an in-memory cache updated by pollNodeHealth
    return this.nodeHeadroomCache.get(nodeId.toString()) ?? 50;
  }

  /** In-memory cache of node headroom values, updated by pollNodeHealth */
  private nodeHeadroomCache: Map<string, number> = new Map();

  /**
   * Poll all dario nodes' /accounts endpoints and cache their headroom.
   * Called periodically by the health checker and after 429 events.
   */
  async pollNodeHealth(): Promise<void> {
    const nodes = await this.prisma.channelNode.findMany({
      where: { status: "healthy" },
    });

    for (const node of nodes) {
      try {
        const url = `${node.internalUrl}/accounts`;
        const resp = await fetch(url, {
          signal: AbortSignal.timeout(5_000),
          headers: node.internalApiKey ? { "x-api-key": node.internalApiKey } : {},
        });
        if (!resp.ok) continue;

        const data = await resp.json() as any;
        if (data.mode !== 'pool' || !Array.isArray(data.accounts)) {
          // Single-account or unexpected format — assume healthy
          this.nodeHeadroomCache.set(node.id.toString(), 50);
          continue;
        }

        // Average headroom across all accounts on this node
        const headrooms: number[] = data.accounts.map((a: any) => a.headroom ?? 0);
        const avgHeadroom = headrooms.length > 0
          ? headrooms.reduce((s: number, h: number) => s + h, 0) / headrooms.length
          : 0;

        this.nodeHeadroomCache.set(node.id.toString(), Math.round(avgHeadroom));

        // Persist to Redis for cross-instance visibility
        const health: NodeHealth = {
          avgHeadroom: Math.round(avgHeadroom),
          healthyAccounts: data.healthy ?? headrooms.filter((h: number) => h > 2).length,
          totalAccounts: data.accounts ?? headrooms.length,
          updatedAt: Date.now(),
        };
        await this.redis.set(
          redisKeys.nodeHealth(node.id),
          JSON.stringify(health),
          "EX",
          NODE_HEALTH_TTL_S,
        );
      } catch {
        // Node unreachable — assume degraded
        this.nodeHeadroomCache.set(node.id.toString(), 0);
      }
    }
  }

  /**
   * Start periodic node health polling. Returns the interval handle
   * so the caller can stop it on shutdown.
   */
  startHealthPolling(intervalMs: number = 10_000): ReturnType<typeof setInterval> {
    // Initial poll
    this.pollNodeHealth().catch(() => {});
    return setInterval(() => this.pollNodeHealth().catch(() => {}), intervalMs);
  }

  // ---- Billing settlement ----

  private async settle(
    ctx: RelayContext,
    usage: UsageInfo,
    status: string,
    httpStatus: number,
    errorCode?: string,
  ) {
    const finishedAt = new Date();

    try {
      // Calculate billing — prices are USD per 1M tokens
      const alias = await this.prisma.modelAlias.findUnique({
        where: { alias: ctx.model },
      });
      let billableUnits = 0n;
      let pricingDetail: any = undefined;

      if (alias && (usage.inputTokens > 0 || usage.outputTokens > 0)) {
        const multiplier = ctx.apiKey.plan?.billingMultiplier ?? 1;
        const ppt = (p: number) => p / 1_000_000;

        const inputCostUsd = usage.inputTokens * ppt(alias.inputPrice);
        const cacheWriteCostUsd = usage.cacheCreationTokens * ppt(alias.cacheWrite5mPrice);
        const cacheReadCostUsd = usage.cacheReadTokens * ppt(alias.cacheReadPrice);
        const outputCostUsd = usage.outputTokens * ppt(alias.outputPrice);

        const totalUsd = inputCostUsd + cacheWriteCostUsd + cacheReadCostUsd + outputCostUsd;
        // 1 billableUnit = 1 micro-dollar ($0.000001). 1M units = $1
        billableUnits = BigInt(Math.round(totalUsd * 1_000_000 * multiplier));

        pricingDetail = {
          inputTokens: usage.inputTokens, inputPrice: alias.inputPrice, inputCostUsd: +inputCostUsd.toFixed(6),
          cacheCreationTokens: usage.cacheCreationTokens, cacheWrite5mPrice: alias.cacheWrite5mPrice, cacheWriteCostUsd: +cacheWriteCostUsd.toFixed(6),
          cacheReadTokens: usage.cacheReadTokens, cacheReadPrice: alias.cacheReadPrice, cacheReadCostUsd: +cacheReadCostUsd.toFixed(6),
          outputTokens: usage.outputTokens, outputPrice: alias.outputPrice, outputCostUsd: +outputCostUsd.toFixed(6),
          totalUsd: +totalUsd.toFixed(6),
          billingMultiplier: multiplier,
        };
      }

      const period = finishedAt.toISOString().slice(0, 7).replace("-", "");

      await this.prisma.$transaction(async (tx) => {
        // Request log
        await tx.requestLog.create({
          data: {
            requestId: ctx.requestId,
            userId: ctx.apiKey.userId,
            apiKeyId: ctx.apiKey.id,
            endpoint: ctx.protocol === "anthropic" ? "/v1/messages" : "/v1/chat/completions",
            requestedModel: ctx.model,
            actualUpstreamModel: ctx.upstreamModel,
            channelId: ctx.channelId,
            nodeId: ctx.nodeId,
            stream: false,
            status: status as any,
            httpStatus,
            errorCode: errorCode ?? null,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheCreationTokens: usage.cacheCreationTokens,
            cacheReadTokens: usage.cacheReadTokens,
            billableUnits,
            pricingDetail,
            startedAt: ctx.startedAt,
            finishedAt,
            durationMs: finishedAt.getTime() - ctx.startedAt.getTime(),
          },
        });

        // Usage ledger
        if (billableUnits > 0n) {
          await tx.usageLedger.create({
            data: {
              requestId: ctx.requestId,
              userId: ctx.apiKey.userId,
              apiKeyId: ctx.apiKey.id,
              billingPeriod: period,
              billedRequests: 1,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              cacheCreationTokens: usage.cacheCreationTokens,
              cacheReadTokens: usage.cacheReadTokens,
              billableUnits,
              settlementStatus: "final",
            },
          });

          // Deduct from key quota
          await tx.apiKey.update({
            where: { id: ctx.apiKey.id },
            data: {
              usedQuota: { increment: billableUnits },
              usedCalls: { increment: 1n },
              lastUsedAt: finishedAt,
            },
          });

          // Deduct from user quota
          await tx.user.update({
            where: { id: ctx.apiKey.userId },
            data: {
              usedQuota: { increment: billableUnits },
              requestCount: { increment: 1n },
            },
          });
        } else {
          // Still update call count even if no billing
          await tx.apiKey.update({
            where: { id: ctx.apiKey.id },
            data: {
              usedCalls: { increment: 1n },
              lastUsedAt: finishedAt,
            },
          });
        }
      });

      // Update Redis daily spending
      if (billableUnits > 0n) {
        const today = finishedAt.toISOString().slice(0, 10).replace(/-/g, "");
        const dailyKey = redisKeys.userDailySpending(ctx.apiKey.userId, today);
        await this.redis.incrby(dailyKey, Number(billableUnits));
        await this.redis.expire(dailyKey, 2 * 86400);
      }
    } catch (err) {
      console.error("Settlement error:", err);
    }
  }

  // ---- Image generation ----

  async handleImageGeneration(request: FastifyRequest, reply: FastifyReply) {
    const startedAt = new Date();
    const requestId = uuid();

    // ① Auth
    const apiKey = await this.resolveApiKey(request);

    if (apiKey.expiresAt && apiKey.expiresAt < startedAt) throw unauthorized("API key expired");
    if (apiKey.user.status === "disabled") throw forbidden("Account is disabled");

    // ② Model access
    const body = request.body as any;
    const requestedModel = body.model ?? (request.query as any).model;
    if (!requestedModel) throw forbidden("Model is required");

    const keyModels = apiKey.models as string[] | null;
    if (keyModels && keyModels.length > 0 && !keyModels.includes(requestedModel)) {
      throw forbidden(`Model ${requestedModel} not allowed on this key`);
    }

    await this.checkQuota(apiKey);
    await this.checkRateLimit(apiKey.userId, apiKey.plan);

    // Sensitive word check on prompt
    const prompt = body.prompt ?? "";
    if (prompt) {
      const sensitiveService = new SensitiveWordService(this.prisma, this.redis);
      const check = await sensitiveService.checkContent(prompt);
      if (check.blocked) throw badRequest("Content contains prohibited content");
    }

    // Route to node
    const { alias, routes } = await this.resolveRoute(requestedModel);
    const allNodes = await this.getHealthyNodes(routes);
    if (allNodes.length === 0) throw internalError("No available upstream nodes");
    const node = allNodes[0];

    const ctx: RelayContext = {
      requestId,
      apiKey: apiKey as any,
      model: requestedModel,
      upstreamModel: routes[0]?.upstreamModel ?? requestedModel,
      channelId: node.channelId,
      nodeId: node.id,
      nodeUrl: node.internalUrl,
      nodeApiKey: node.internalApiKey,
      startedAt,
      protocol: "openai",
    };

    try {
      // Bridge through Responses API with image_generation tool
      // (codex-dario only supports /v1/chat/completions and /v1/responses, not /v1/images/generations)
      // ChatGPT accounts require stream=true, store=false, and instructions field
      const upstreamUrl = `${node.internalUrl}/v1/responses`;
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "x-api-key": node.internalApiKey,
        authorization: `Bearer ${node.internalApiKey}`,
        "x-request-id": requestId,
        "x-tokensea-user": apiKey.userId.toString(),
      };

      const responsesBody = {
        model: "gpt-5.4",
        input: [{ type: "message", role: "user", content: prompt || body.prompt }],
        tools: [{ type: "image_generation" }],
        tool_choice: { type: "image_generation" },
        instructions: "Generate the requested image.",
        stream: true,
        store: false,
      };

      const response = await fetch(upstreamUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(responsesBody),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        await this.settleImage(ctx, { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }, "failed", response.status, "/v1/responses");
        reply.code(response.status).send(errorBody);
        return;
      }

      // Stream-parse SSE: extract image_generation_call result and usage
      let imageB64 = "";
      let imageUsage: UsageInfo = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
      const reader = response.body!;
      const decoder = new TextDecoder();
      let buffer = "";

      for await (const chunk of reader as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop()!; // keep incomplete line

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === "response.output_item.done" && evt.item?.type === "image_generation_call" && evt.item.result) {
              imageB64 = evt.item.result;
            }
            // Extract usage from completed event
            if (evt.type === "response.completed" || evt.type === "response.done") {
              const u = evt.response?.usage ?? evt.usage;
              if (u) {
                imageUsage = {
                  inputTokens: u.input_tokens ?? 0,
                  outputTokens: u.output_tokens ?? 0,
                  cacheCreationTokens: u.input_tokens_details?.cached_tokens ? 0 : 0,
                  cacheReadTokens: u.input_tokens_details?.cached_tokens ?? 0,
                };
              }
            }
          } catch {}
        }

        // Stop once we have both the image and usage, or the image is ready and we've seen enough
        if (imageB64 && (imageUsage.inputTokens > 0 || imageUsage.outputTokens > 0)) break;
      }

      if (!imageB64) {
        await this.settleImage(ctx, { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }, "failed", 502, "/v1/responses");
        throw internalError("Image generation returned no images");
      }

      // Convert to OpenAI Images API response format
      const imageResponse = {
        created: Math.floor(Date.now() / 1000),
        data: [{
          url: `data:image/png;base64,${imageB64}`,
          revised_prompt: prompt,
        }],
      };

      await this.settleImage(ctx, imageUsage, "succeeded", 200, "/v1/responses");
      reply.code(200).header("content-type", "application/json").send(imageResponse);
    } catch (err: any) {
      if (err.statusCode) throw err;
      request.log.error({ err, requestId }, "Image generation upstream failed");
      await this.settleImage(ctx, { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }, "failed", err.statusCode ?? 502, "/v1/responses");
      throw internalError("Image generation failed");
    }
  }

  // ---- Image edit (image-to-image) ----

  async handleImageEdit(request: FastifyRequest, reply: FastifyReply) {
    const startedAt = new Date();
    const requestId = uuid();

    // ① Auth
    const apiKey = await this.resolveApiKey(request);

    if (apiKey.expiresAt && apiKey.expiresAt < startedAt) throw unauthorized("API key expired");
    if (apiKey.user.status === "disabled") throw forbidden("Account is disabled");

    await this.checkQuota(apiKey);
    await this.checkRateLimit(apiKey.userId, apiKey.plan);

    // ② Parse multipart form
    const parts = request.parts();
    const formData = new FormData();
    let requestedModel: string | undefined;
    let prompt = "";

    for await (const part of parts) {
      if (part.type === "file") {
        const buffer = await part.toBuffer();
        const blob = new Blob([new Uint8Array(buffer)], { type: part.mimetype as string });
        formData.append(part.fieldname, blob, part.filename as string);
      } else {
        const value = part.value as string;
        formData.append(part.fieldname, value);
        if (part.fieldname === "model") requestedModel = value;
        if (part.fieldname === "prompt") prompt = value;
      }
    }

    if (!requestedModel) throw forbidden("Model is required");

    const keyModels = apiKey.models as string[] | null;
    if (keyModels && keyModels.length > 0 && !keyModels.includes(requestedModel)) {
      throw forbidden(`Model ${requestedModel} not allowed on this key`);
    }

    // Sensitive word check on prompt
    if (prompt) {
      const sensitiveService = new SensitiveWordService(this.prisma, this.redis);
      const check = await sensitiveService.checkContent(prompt);
      if (check.blocked) throw badRequest("Content contains prohibited content");
    }

    // Route to node
    const { alias, routes } = await this.resolveRoute(requestedModel);
    const allNodes = await this.getHealthyNodes(routes);
    if (allNodes.length === 0) throw internalError("No available upstream nodes");
    const node = allNodes[0];

    // Replace model with upstream model
    formData.set("model", routes[0]?.upstreamModel ?? requestedModel);

    const ctx: RelayContext = {
      requestId,
      apiKey: apiKey as any,
      model: requestedModel,
      upstreamModel: routes[0]?.upstreamModel ?? requestedModel,
      channelId: node.channelId,
      nodeId: node.id,
      nodeUrl: node.internalUrl,
      nodeApiKey: node.internalApiKey,
      startedAt,
      protocol: "openai",
    };

    try {
      const upstreamUrl = `${node.internalUrl}/v1/images/edits`;
      const response = await fetch(upstreamUrl, {
        method: "POST",
        headers: {
          "x-api-key": node.internalApiKey,
          "x-request-id": requestId,
          "x-tokensea-user": apiKey.userId.toString(),
          authorization: `Bearer ${node.internalApiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        await this.settleImage(ctx, { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }, "failed", response.status, "/v1/images/edits");
        reply.code(response.status).send(errorBody);
        return;
      }

      const responseBody = await response.json();
      const editUsage = this.extractUsage(responseBody, "openai");
      await this.settleImage(ctx, editUsage, "succeeded", 200, "/v1/images/edits");
      reply.code(200).header("content-type", "application/json").send(responseBody);
    } catch (err: any) {
      request.log.error({ err, requestId }, "Image edit upstream failed");
      await this.settleImage(ctx, { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }, "failed", err.statusCode ?? 502, "/v1/images/edits");
      throw internalError("Image edit failed");
    }
  }

  private async settleImage(
    ctx: RelayContext,
    usage: UsageInfo,
    status: string,
    httpStatus: number,
    endpoint: string,
    errorCode?: string,
  ) {
    const finishedAt = new Date();
    try {
      const alias = await this.prisma.modelAlias.findUnique({ where: { alias: ctx.model } });
      // Token-based billing (same as chat models): prices are USD per 1M tokens
      let billableUnits = 0n;
      let pricingDetail: any = undefined;

      if (alias && (usage.inputTokens > 0 || usage.outputTokens > 0)) {
        const multiplier = ctx.apiKey.plan?.billingMultiplier ?? 1;
        const ppt = (p: number) => p / 1_000_000;

        const inputCostUsd = usage.inputTokens * ppt(alias.inputPrice);
        const cacheWriteCostUsd = usage.cacheCreationTokens * ppt(alias.cacheWrite5mPrice);
        const cacheReadCostUsd = usage.cacheReadTokens * ppt(alias.cacheReadPrice);
        const outputCostUsd = usage.outputTokens * ppt(alias.outputPrice);

        const totalUsd = inputCostUsd + cacheWriteCostUsd + cacheReadCostUsd + outputCostUsd;
        billableUnits = BigInt(Math.round(totalUsd * 1_000_000 * multiplier));

        pricingDetail = {
          inputTokens: usage.inputTokens, inputPrice: alias.inputPrice, inputCostUsd: +inputCostUsd.toFixed(6),
          cacheCreationTokens: usage.cacheCreationTokens, cacheWrite5mPrice: alias.cacheWrite5mPrice, cacheWriteCostUsd: +cacheWriteCostUsd.toFixed(6),
          cacheReadTokens: usage.cacheReadTokens, cacheReadPrice: alias.cacheReadPrice, cacheReadCostUsd: +cacheReadCostUsd.toFixed(6),
          outputTokens: usage.outputTokens, outputPrice: alias.outputPrice, outputCostUsd: +outputCostUsd.toFixed(6),
          totalUsd: +totalUsd.toFixed(6),
          billingMultiplier: multiplier,
        };
      }

      const period = finishedAt.toISOString().slice(0, 7).replace("-", "");

      await this.prisma.$transaction(async (tx) => {
        await tx.requestLog.create({
          data: {
            requestId: ctx.requestId,
            userId: ctx.apiKey.userId,
            apiKeyId: ctx.apiKey.id,
            endpoint,
            requestedModel: ctx.model,
            actualUpstreamModel: ctx.upstreamModel,
            channelId: ctx.channelId,
            nodeId: ctx.nodeId,
            stream: false,
            status: status as any,
            httpStatus,
            errorCode: errorCode ?? null,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheCreationTokens: usage.cacheCreationTokens,
            cacheReadTokens: usage.cacheReadTokens,
            billableUnits,
            pricingDetail,
            startedAt: ctx.startedAt,
            finishedAt,
            durationMs: finishedAt.getTime() - ctx.startedAt.getTime(),
          },
        });

        if (billableUnits > 0n) {
          await tx.usageLedger.create({
            data: {
              requestId: ctx.requestId,
              userId: ctx.apiKey.userId,
              apiKeyId: ctx.apiKey.id,
              billingPeriod: period,
              billedRequests: 1,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              cacheCreationTokens: usage.cacheCreationTokens,
              cacheReadTokens: usage.cacheReadTokens,
              billableUnits,
              settlementStatus: "final",
            },
          });
          await tx.apiKey.update({
            where: { id: ctx.apiKey.id },
            data: { usedQuota: { increment: billableUnits }, usedCalls: { increment: 1n }, lastUsedAt: finishedAt },
          });
          await tx.user.update({
            where: { id: ctx.apiKey.userId },
            data: { usedQuota: { increment: billableUnits }, requestCount: { increment: 1n } },
          });
        } else {
          await tx.apiKey.update({
            where: { id: ctx.apiKey.id },
            data: { usedCalls: { increment: 1n }, lastUsedAt: finishedAt },
          });
        }
      });

      if (billableUnits > 0n) {
        const today = finishedAt.toISOString().slice(0, 10).replace(/-/g, "");
        const dailyKey = redisKeys.userDailySpending(ctx.apiKey.userId, today);
        await this.redis.incrby(dailyKey, Number(billableUnits));
        await this.redis.expire(dailyKey, 2 * 86400);
      }
    } catch (err) {
      console.error("Image settlement error:", err);
    }
  }

  // ---- Protocol conversion ----

  private openAIToAnthropic(body: any): any {
    const messages: any[] = [];
    let system: string | undefined;

    for (const msg of body.messages ?? []) {
      if (msg.role === "system") {
        system = typeof msg.content === "string" ? msg.content : msg.content?.[0]?.text;
      } else if (msg.role === "assistant") {
        messages.push({ role: "assistant", content: msg.content });
      } else {
        messages.push({ role: "user", content: msg.content });
      }
    }

    return {
      model: body.model,
      max_tokens: body.max_tokens ?? 4096,
      stream: body.stream ?? false,
      system,
      messages,
      tools: body.tools?.map((t: any) => ({
        name: t.function?.name ?? t.name,
        description: t.function?.description ?? t.description,
        input_schema: t.function?.parameters ?? t.input_schema,
      })),
    };
  }

  private anthropicToOpenAI(body: any): any {
    const messages: any[] = [];
    if (body.system) {
      messages.push({ role: "system", content: body.system });
    }
    for (const msg of body.messages ?? []) {
      messages.push(msg);
    }

    return {
      model: body.model,
      max_tokens: body.max_tokens ?? 4096,
      stream: body.stream ?? false,
      messages,
      tools: body.tools?.map((t: any) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      })),
    };
  }

  private extractUsage(body: any, protocol: "anthropic" | "openai"): UsageInfo {
    if (protocol === "anthropic") {
      return {
        inputTokens: body.usage?.input_tokens ?? 0,
        outputTokens: body.usage?.output_tokens ?? 0,
        cacheCreationTokens: body.usage?.cache_creation_input_tokens ?? 0,
        cacheReadTokens: body.usage?.cache_read_input_tokens ?? 0,
      };
    }
    return {
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
      cacheCreationTokens: 0,
      cacheReadTokens: body.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    };
  }

  private extractTokensFromSSE(chunk: string, protocol: "anthropic" | "openai"): UsageInfo {
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheCreationTokens = 0;
    let cacheReadTokens = 0;

    for (const line of chunk.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;

      try {
        const parsed = JSON.parse(data);
        if (protocol === "anthropic") {
          if (parsed.type === "message_start" && parsed.message?.usage) {
            inputTokens = parsed.message.usage.input_tokens ?? 0;
            cacheCreationTokens = parsed.message.usage.cache_creation_input_tokens ?? 0;
            cacheReadTokens = parsed.message.usage.cache_read_input_tokens ?? 0;
          }
          if (parsed.type === "message_delta" && parsed.usage) {
            outputTokens = parsed.usage.output_tokens ?? 0;
          }
        } else {
          if (parsed.usage) {
            inputTokens = parsed.usage.prompt_tokens ?? 0;
            outputTokens = parsed.usage.completion_tokens ?? 0;
            cacheReadTokens = parsed.usage.prompt_tokens_details?.cached_tokens ?? 0;
          }
        }
      } catch {}
    }

    return { inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens };
  }

  // ---- Sensitive word content extraction ----

  private extractContentText(body: any): string {
    const parts: string[] = [];
    if (body.system) parts.push(typeof body.system === "string" ? body.system : JSON.stringify(body.system));
    for (const msg of body.messages ?? []) {
      if (typeof msg.content === "string") parts.push(msg.content);
      else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (typeof block === "string") parts.push(block);
          else if (block.text) parts.push(block.text);
          else if (block.content) parts.push(typeof block.content === "string" ? block.content : JSON.stringify(block.content));
        }
      }
    }
    return parts.join(" ");
  }

  private replaceContentText(body: any, _filtered: string) {
    // Legacy — not used, replaced by sanitizeContentText
  }

  private async sanitizeContentText(body: any, sensitiveService: SensitiveWordService) {
    if (body.system && typeof body.system === "string") {
      body.system = await sensitiveService.filterContent(body.system);
    }
    for (const msg of body.messages ?? []) {
      if (typeof msg.content === "string") {
        msg.content = await sensitiveService.filterContent(msg.content);
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.text && typeof block.text === "string") {
            block.text = await sensitiveService.filterContent(block.text);
          }
        }
      }
    }
  }
}
