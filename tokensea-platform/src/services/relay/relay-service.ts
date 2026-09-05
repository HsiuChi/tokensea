import type { FastifyRequest, FastifyReply } from "fastify";
import type { PrismaClient, ApiKey, Plan, ChannelNode } from "@prisma/client";
import type Redis from "ioredis";
import { ReservationService } from "../billing/reservation-service.js";
import { SettlementError } from "../billing/settlement-error.js";
import { VideoTaskService } from "../billing/video-task-service.js";
import { safeErrorCode } from "../log/request-detail.js";
import { dispatchWebhookEvent } from "../notify/webhook-service.js";
import { calculateTokenPrice, openAiUsage, type TokenUsage } from "../billing/token-pricing.js";
import { ipAllowed } from "../../lib/ip-policy.js";
import { hashApiKey } from "../../lib/crypto.js";
import { verifyToken } from "../../lib/jwt.js";
import { redisKeys } from "../../lib/redis-keys.js";
import { unauthorized, forbidden, rateLimited, internalError, badRequest } from "../../lib/errors.js";
import { SensitiveWordService } from "../sensitive/sensitive-service.js";
import { v4 as uuid, v5 as uuidV5 } from "uuid";
import { selectChannel, channelsWithHealthyNodes } from "./channel-selection.js";
import { upstreamHeaders, upstreamUrl as joinUpstreamUrl } from "../channel/upstream-request.js";

interface RelayContext {
  upstreamAccepted?: boolean;
  requestId: string;
  apiKey: ApiKey & { user: any; plan: any };
  model: string;
  upstreamModel: string;
  channelId: bigint;
  channelBillingMultiplier: number;
  nodeId: bigint;
  nodeUrl: string;
  nodeApiKey: string;
  startedAt: Date;
  protocol: "anthropic" | "openai";
  endpoint?: string;
  isProbe?: boolean;
  stream?: boolean;
}

type UsageInfo = TokenUsage;

const NODE_HEALTH_TTL_S = 30; // Redis TTL for node health cache
const MAX_UPSTREAM_ATTEMPTS = 20;
const RETRYABLE_UPSTREAM_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

interface NodeHealth {
  avgHeadroom: number; // 0–100, average across all accounts on the node
  healthyAccounts: number;
  totalAccounts: number;
  updatedAt: number;
}

export class RelayService {
  constructor(
    private prisma: PrismaClient,
    private redis: Redis,
  ) {}

  async handleRequest(request: FastifyRequest, reply: FastifyReply) {
    const startedAt = new Date();
    const requestId = uuid();

    const isProbe = false; // Public headers must never bypass billing or policy checks.

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

    // Model whitelist: key-level overrides group-level; both empty = all allowed.
    const keyModels = apiKey.models as string[] | null;
    const groupModels = apiKey.keyGroup?.models as string[] | null;
    const effectiveModels = (keyModels && keyModels.length > 0)
      ? keyModels
      : (groupModels && groupModels.length > 0 ? groupModels : null);
    if ((groupModels?.length && !groupModels.includes(requestedModel)) || (effectiveModels && !effectiveModels.includes(requestedModel))) {
      throw forbidden(`Model ${requestedModel} not allowed on this key`);
    }

    // ③ Quota checks (Redis) — skipped for probe requests
    if (!isProbe) await this.checkQuota(apiKey);

    // ④ Rate limit checks (Redis) — defaults if no plan; skipped for probe
    const plan = apiKey.plan;
    if (!isProbe) await this.checkRateLimit(apiKey.userId, plan);

    // ⑤½ Sensitive word filtering — skipped for probe
    if (!isProbe) {
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
    }

    // ⑥ Route to channel + node (priority-tiered, weight-weighted, cross-channel failover)
    const { alias, routes } = await this.resolveRoute(requestedModel);

    // Load all channels touched by these routes, plus their healthy nodes.
    const channels = await this.resolveChannels(routes);
    if (channels.length === 0) throw internalError("No available upstream channels");

    // Fetch healthy nodes (status=healthy, not in Redis cooldown) across all routes' channels.
    const allNodes = await this.getHealthyNodesForChannels(channels.map((c) => c.id));
    if (allNodes.length === 0) throw internalError("No available upstream nodes");

    const healthyChannelIds = channelsWithHealthyNodes(allNodes);
    const triedChannelIds = new Set<string>();
    const triedNodeIds = new Set<string>();
    let lastError: any;
    let lastContext: RelayContext | undefined;

    await this.reserveQuota(requestId, apiKey.id, alias, body, Object.fromEntries(channels
      .filter(c=>healthyChannelIds.has(c.id.toString())).map(c=>[c.id.toString(),c.billingMultiplier??1])));
    // Bound otherwise-unbounded generation to the budget reserved above.
    if (!body.max_tokens && !body.max_completion_tokens && !body.max_output_tokens) {
      if (request.url.startsWith("/v1/responses")) body.max_output_tokens=4096;
      else body.max_tokens=4096;
    }
    const maxAttempts = Math.min(Math.max(allNodes.length, 1), MAX_UPSTREAM_ATTEMPTS);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const channel = selectChannel(channels, healthyChannelIds, triedChannelIds);
      if (!channel) break;

      // Nodes for this channel
      const channelNodes = allNodes.filter((n) => n.channelId === channel.id && !triedNodeIds.has(n.id.toString()));
      const node = this.selectNodeFromPool(channelNodes, triedNodeIds);
      if (!node) {
        triedChannelIds.add(channel.id.toString());
        continue;
      }
      triedNodeIds.add(node.id.toString());

      const isAnthropicEndpoint = request.url.startsWith("/v1/messages");
      const ctx: RelayContext = {
        requestId,
        apiKey: apiKey as any,
        model: requestedModel,
        upstreamModel: routes.find((r: any) => r.channelId === channel.id)?.upstreamModel ?? requestedModel,
        channelId: channel.id,
        channelBillingMultiplier: channel.billingMultiplier ?? 1.0,
        isProbe,
        endpoint: request.url.split("?")[0],
        stream: body.stream === true,
        nodeId: node.id,
        nodeUrl: node.internalUrl,
        nodeApiKey: node.internalApiKey,
        startedAt,
        protocol: isAnthropicEndpoint ? "anthropic" : "openai",
      };

      lastContext = ctx;
      try {
        // Transparent proxy: forward to dario on the SAME path the client used.
        // dario handles both /v1/messages (Anthropic) and /v1/chat/completions (OpenAI),
        // including protocol conversion, CC passthrough, and template replay internally.
        const upstreamUrl = joinUpstreamUrl(node.internalUrl, request.url);

        // Forward ALL original headers to dario. Only replace auth.
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(request.headers)) {
          if (typeof value !== "string") continue;
          const lower = key.toLowerCase();
          if (lower === "host" || lower === "connection" || lower === "transfer-encoding" ||
              lower === "content-length" || lower === "accept-encoding" ||
              lower === "authorization" || lower === "x-api-key" || lower === "x-tokensea-probe") continue;
          headers[key] = value;
        }
        Object.assign(headers, upstreamHeaders(node, request.url));
        headers["x-request-id"] = requestId;
        headers["x-tokensea-user"] = apiKey.userId.toString();

        // Forward body as-is. dario handles everything:
        // CC clients → passthrough (token swap only)
        // Non-CC clients → template replay (CC fingerprint injection)
        // Model mapping, protocol conversion — all done by dario
        const upstreamBody = { ...body, model: ctx.upstreamModel };
        if (body.stream === true && request.url.startsWith("/v1/chat/completions") && ctx.protocol === "openai") upstreamBody.stream_options = { ...body.stream_options, include_usage: true };
        const isStream = body.stream === true;

        if (isStream) {
          await this.handleStreamRequest(request, reply, upstreamUrl, headers, upstreamBody, ctx);
        } else {
          await this.handleNonStreamRequest(request, reply, upstreamUrl, headers, upstreamBody, ctx);
        }
        return; // Success — exit failover loop
      } catch (err: any) {
        if (err instanceof SettlementError) throw err;
        if (ctx.upstreamAccepted) {
          await this.holdAcceptedResult(ctx);
        }
        const reservation=await this.prisma.billingReservation.findUnique({where:{requestId}});
        if(reservation && reservation.status !== "reserved") throw err; // Never replay an upstream request after result persistence.
        if (!err.upstreamRejected) {
          await this.settle(ctx, openAiUsage(), "failed", 502, "transport_unknown");
          throw internalError("Upstream outcome unknown; request retained for review");
        }
        lastError = err;
        const upStatus = err?.statusCode ?? 502;
        // Resolve retry action: channel.retryPolicy overrides default 429/503-continue.
        const action = this.resolveRetryAction(channel.retryPolicy, upStatus, err?.code);
        if (action === "stop" || action === "stop-and-cooldown") {
          request.log.error({ err, requestId, action }, "Upstream request failed (retryPolicy stop)");
          await this.settle(ctx, { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }, "failed", upStatus, err.code ?? "transport_unknown");
          if (action === "stop-and-cooldown") {
            await this.redis.set(redisKeys.nodeCooldown(node.id), "1", "EX", 60);
          }
          throw internalError("Upstream request failed");
        }
        const shouldContinue = action ? action.startsWith("continue") : (upStatus === 429 || upStatus === 503);
        if (!shouldContinue) {
          request.log.error({ err, requestId }, "Upstream request failed");
          await this.settle(ctx, { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }, "failed", upStatus, err.code ?? "transport_unknown");
          throw internalError("Upstream request failed");
        }
        // continue (with optional cooldown)
        if (action === "continue-and-cooldown" || upStatus === 429 || upStatus === 503) {
          await this.redis.set(redisKeys.nodeCooldown(node.id), "1", "EX", 60);
        }
        const hasRemainingNodeInChannel = allNodes.some((candidate) =>
          candidate.channelId === channel.id && !triedNodeIds.has(candidate.id.toString()),
        );
        if (!hasRemainingNodeInChannel) triedChannelIds.add(channel.id.toString());
        request.log.warn({ err, requestId, channelId: channel.id.toString(), nodeId: node.id.toString(), attempt, action }, "Retrying with next channel/node");
      }
    }

    // All attempts exhausted: retain the final failure in the request statistics.
    if(lastContext) await this.settle(lastContext, openAiUsage(), "failed", lastError?.statusCode ?? 502, lastError?.code ?? "transport_unknown");
    throw internalError("All upstream nodes exhausted");
  }

  /**
   * Transparent relay for asynchronous media APIs whose paths differ between
   * providers. Clients keep the provider suffix but authenticate with a
   * TokenSea key: /v1/video/:model/<provider-path>.
   */
  async handleMediaRequest(request: FastifyRequest, reply: FastifyReply) {
    const apiKey = await this.resolveApiKey(request);
    if (apiKey.expiresAt && apiKey.expiresAt <= new Date()) throw unauthorized("API key expired");
    if (apiKey.user.status !== "active") throw forbidden("Account is disabled");
    const params = request.params as { model: string; "*": string };
    const model = params.model, suffix = params["*"];
    const tasks = new VideoTaskService(this.prisma);
    if (request.method === "GET") {
      // Polling is wallet-independent and owner-scoped, never forwarded to a random shared key.
      const match = /^tasks\/([a-f0-9-]{36})$/.exec(suffix);
      if (!match) throw badRequest("Use the TokenSea pollUrl returned by video submission");
      return reply.send(await tasks.get(apiKey.userId,model,match[1]));
    }
    const keyModels = apiKey.models as string[] | null, groupModels = apiKey.keyGroup?.models as string[] | null;
    if ((keyModels?.length && !keyModels.includes(model)) || (groupModels?.length && !groupModels.includes(model))) throw forbidden("Model not allowed on this key");
    await this.checkRateLimit(apiKey.userId,apiKey.plan);
    const body = (request.body ?? {}) as Record<string,any>;
    const text = this.extractContentText(body);
    if (text && (await new SensitiveWordService(this.prisma,this.redis).checkContent(text)).blocked) throw badRequest("Content contains prohibited content");
    const {alias,routes} = await this.resolveRoute(model);
    if (alias.category !== "video") throw badRequest("Not a video model");
    const channels = await this.resolveChannels(routes);
    const nodes = await this.getHealthyNodesForChannels(channels.map(c=>c.id));
    const node = this.selectNodeFromPool(nodes,new Set());
    if (!node) throw internalError("No available upstream nodes");
    const idempotency = request.headers["idempotency-key"];
    if (idempotency !== undefined && (typeof idempotency !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(idempotency))) throw badRequest("Idempotency-Key must be 8-128 letters, digits, underscores or hyphens");
    const id = typeof idempotency === "string" ? uuidV5(apiKey.id.toString()+":"+idempotency,uuidV5.URL) : uuid();
    const upstreamModel = routes.find(r=>r.channelId===node.channelId)?.upstreamModel ?? model;
    const result = await tasks.submit(id,apiKey.id,alias,body,node,channels.find(c=>c.id===node.channelId)?.billingMultiplier??1,upstreamModel,suffix);
    return reply.code(202).send(result);
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
      signal: AbortSignal.timeout(600000),
    });

    if (!response.ok) {
      if (RETRYABLE_UPSTREAM_STATUSES.has(response.status)) {
        const errorBody = await response.text();
        const err: any = new Error(errorBody);
        err.upstreamRejected = true;
        err.statusCode = response.status;
        err.code = safeErrorCode(errorBody, response.status);
        await this.reportUpstreamFailure(ctx, response.status, err.code);
        throw err;
      }
      const errorBody = await response.text();
      await this.settle(ctx, { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }, "failed", response.status, safeErrorCode(errorBody, response.status));
      await this.reportUpstreamFailure(ctx, response.status, safeErrorCode(errorBody, response.status));
      reply.code(response.status).send(errorBody);
      return;
    }

    ctx.upstreamAccepted = true;
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
      signal: AbortSignal.timeout(600000),
    });

    if (!response.ok) {
      if (RETRYABLE_UPSTREAM_STATUSES.has(response.status)) {
        const errorBody = await response.text();
        const err: any = new Error(errorBody);
        err.upstreamRejected = true;
        err.statusCode = response.status;
        err.code = safeErrorCode(errorBody, response.status);
        await this.reportUpstreamFailure(ctx, response.status, err.code);
        throw err;
      }
      const errorBody = await response.text();
      await this.settle(ctx, { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }, "failed", response.status, safeErrorCode(errorBody, response.status));
      await this.reportUpstreamFailure(ctx, response.status, safeErrorCode(errorBody, response.status));
      reply.code(response.status).send(errorBody);
      return;
    }

    ctx.upstreamAccepted = true;
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheCreationTokens = 0;
    let cacheReadTokens = 0;
    let pending = "";
    let failed = false;
    let terminal = false;

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
          pending += chunk;
          const end = pending.lastIndexOf("\n");
          if (end < 0) continue;
          const complete = pending.slice(0, end + 1);
          pending = pending.slice(end + 1);
          if (complete.includes("[DONE]") || /"type"\s*:\s*"(response.completed|response.done|message_stop)"/.test(complete)) terminal = true;
          const tokenInfo = this.extractTokensFromSSE(complete, ctx.protocol);
          inputTokens = Math.max(inputTokens, tokenInfo.inputTokens);
          outputTokens = Math.max(outputTokens, tokenInfo.outputTokens);
          cacheCreationTokens = Math.max(cacheCreationTokens, tokenInfo.cacheCreationTokens);
          cacheReadTokens = Math.max(cacheReadTokens, tokenInfo.cacheReadTokens);
          if (/"type"\s*:\s*"(response.failed|error)"/.test(complete)) failed = true;
        }
      } catch (err) {
        failed = true;
        request.log.error({ err, requestId: ctx.requestId }, "Stream error");
      }
    }

    if (!terminal) failed = true;
    reply.raw.end();
    await this.settle(ctx, { inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens }, failed ? "failed" : "succeeded", failed ? 502 : 200, failed ? "stream_interrupted" : undefined);
  }

  private async reportUpstreamFailure(ctx: RelayContext, status: number, code?: string) {
    const event = /quota|balance|credit|resource_exhausted/.test(code ?? "") ? "node.quota_exhausted"
      : status === 429 ? "node.rate_limited" : status === 401 || status === 403 ? "node.auth_failed" : null;
    if (!event) return;
    try {
      const key = "alert:" + event + ":" + ctx.nodeId;
      if (await this.redis.set(key, "1", "EX", 300, "NX")) dispatchWebhookEvent(this.prisma, event, { nodeId: ctx.nodeId.toString(), channelId: ctx.channelId.toString(), httpStatus: status, errorCode: code ?? null, model: ctx.model });
    } catch { /* Notification failures must not affect relay responses. */ }
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
        include: { user: true, plan: true, keyGroup: true },
      });
    } else {
      try {
        const payload = verifyToken(rawKey, (request.server as any).env?.JWT_SECRET || process.env.JWT_SECRET);
        apiKey = await this.prisma.apiKey.findFirst({
          where: { userId: payload.userId, status: "active", deletedAt: null },
          include: { user: true, plan: true, keyGroup: true },
          orderBy: { createdAt: "asc" },
        });
      } catch {}
    }
    if (!apiKey || apiKey.deletedAt || apiKey.status !== "active") throw unauthorized("Invalid API key");
    if (!ipAllowed(request.ip, Array.isArray(apiKey.allowedIps) ? apiKey.allowedIps : [])) throw forbidden("IP address not allowed on this key");
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
    if (apiKey.quota >= 0n && apiKey.usedQuota >= apiKey.quota) {
      throw rateLimited("API key quota exhausted");
    }

    // Key group quota (shared pool)
    const g = apiKey.keyGroup;
    if (g && g.quota !== -1n && g.usedQuota >= g.quota) {
      const err = rateLimited("Key group quota exhausted");
      (err as any).cause = { code: "quota_exceeded", scope: "group" };
      throw err;
    }

    // Key call limit
    if (apiKey.maxCalls >= 0n && apiKey.usedCalls >= apiKey.maxCalls) {
      throw rateLimited("API key call limit reached");
    }

    // Daily monetary limits are checked atomically against PostgreSQL ledgers + holds.

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
   * Resolve the retry action for an upstream failure, consulting the
   * channel's retryPolicy if present. Returns one of:
   *   stop | stop-and-cooldown | continue | continue-and-cooldown | undefined
   * undefined means "no policy matched — use default (continue for 429/503, stop otherwise)".
   */
  private resolveRetryAction(retryPolicy: any, status: number, errorCode?: string): string | undefined {
    if (!retryPolicy || !Array.isArray(retryPolicy.rules)) return undefined;
    for (const rule of retryPolicy.rules) {
      if (rule.status !== status) continue;
      if (Array.isArray(rule.match) && rule.match.length > 0) {
        const text = errorCode ?? "";
        if (!rule.match.some((m: string) => text.includes(m))) continue;
      }
      return rule.action; // stop | stop-and-cooldown | continue | continue-and-cooldown
    }
    return undefined;
  }

  /**
   * Load the distinct channels referenced by the given routes, with their
   * billingMultiplier. status=active only.
   */
  private async resolveChannels(routes: any[]): Promise<any[]> {
    const channelIds = [...new Set(routes.map((r: any) => r.channelId))];
    if (channelIds.length === 0) return [];
    return this.prisma.channel.findMany({
      where: { id: { in: channelIds }, status: "active" },
    });
  }

  /**
   * Get all healthy, non-cooled-down nodes across the given channels.
   * (probe worker maintains status; Redis cooldown is the short-term 429 cooldown.)
   */
  private async getHealthyNodesForChannels(channelIds: bigint[]): Promise<ChannelNode[]> {
    const nodes = await this.prisma.channelNode.findMany({
      where: { channelId: { in: channelIds }, status: "healthy" },
    });
    const available: ChannelNode[] = [];
    for (const node of nodes) {
      const cooldownKey = redisKeys.nodeCooldown(node.id);
      const isCooling = await this.redis.exists(cooldownKey);
      if (!isCooling) available.push(node);
    }
    return available;
  }

  /** Weighted selection across the complete key pool. Free concurrency and
   * provider headroom both contribute, so one user's traffic is spread too. */
  private selectNodeFromPool(
    allNodes: ChannelNode[],
    excludeIds: Set<string>,
  ): ChannelNode | null {
    const candidates = allNodes.filter(n => !excludeIds.has(n.id.toString()));
    if (candidates.length === 0) return null;
    const usable = candidates.filter((node) => this.getCachedHeadroom(node.id) > 2);
    const pool = usable.length ? usable : candidates;
    const weights = pool.map((node) => {
      const freeConcurrency = Math.max(1, node.maxConcurrent - node.currentLoad);
      return Math.max(1, Math.min(freeConcurrency, this.getCachedHeadroom(node.id)));
    });
    const total = weights.reduce((sum, value) => sum + value, 0);
    let cursor = Math.random() * total;
    for (let index = 0; index < pool.length; index++) {
      cursor -= weights[index];
      if (cursor <= 0) return pool[index];
    }
    return pool[pool.length - 1] ?? null;
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
      if ((node as any).adapter !== "dario") {
        this.nodeHeadroomCache.set(node.id.toString(), 50);
        continue;
      }
      try {
        const url = `${node.internalUrl}/accounts`;
        const resp = await fetch(url, {
          signal: AbortSignal.timeout(5_000),
          headers: upstreamHeaders(node, "/accounts"),
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

  private async reserveQuota(...args: Parameters<ReservationService["reserve"]>) {
    return new ReservationService(this.prisma).reserve(...args);
  }

  private async settle(ctx: RelayContext, usage: UsageInfo, status: string, httpStatus: number, errorCode?: string) {
    if(ctx.isProbe) return;
    try {
      await new ReservationService(this.prisma).finish(ctx,usage,status,httpStatus,errorCode);
    } catch {
      // Keep the original reserved/pending/review state, even if the database is unavailable.
      throw new SettlementError(ctx.requestId);
    }
  }

  private async holdAcceptedResult(ctx: RelayContext): Promise<never> {
    try { await new ReservationService(this.prisma).markForReview(ctx.requestId,"accepted_result_unavailable"); }
    finally { throw new SettlementError(ctx.requestId); }
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

    // Model whitelist: key-level overrides group-level; both empty = all allowed.
    const keyModels = apiKey.models as string[] | null;
    const groupModels = apiKey.keyGroup?.models as string[] | null;
    const effectiveModels = (keyModels && keyModels.length > 0)
      ? keyModels
      : (groupModels && groupModels.length > 0 ? groupModels : null);
    if ((groupModels?.length && !groupModels.includes(requestedModel)) || (effectiveModels && !effectiveModels.includes(requestedModel))) {
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

    // Route to node (legacy single-node path for image/embeddings)
    const { alias, routes } = await this.resolveRoute(requestedModel);
    const channels = await this.resolveChannels(routes);
    const allNodes = await this.getHealthyNodesForChannels(channels.map((c) => c.id));
    if (allNodes.length === 0) throw internalError("No available upstream nodes");
    const node = allNodes[0];

    const ctx: RelayContext = {
      requestId,
      apiKey: apiKey as any,
      model: requestedModel,
      upstreamModel: routes.find(r => r.channelId === node.channelId)?.upstreamModel ?? requestedModel,
      channelId: node.channelId,
      channelBillingMultiplier: channels.find(c => c.id === node.channelId)?.billingMultiplier ?? 1,
      nodeId: node.id,
      nodeUrl: node.internalUrl,
      nodeApiKey: node.internalApiKey,
      startedAt,
      protocol: "openai",
    };

    await this.reserveQuota(requestId, apiKey.id, alias, body, {[node.channelId.toString()]:ctx.channelBillingMultiplier}, true);
    try {
      if (body.stream === true) throw badRequest("Streaming images are not supported on this endpoint");
      const path = "/v1/images/generations";
      const response = await fetch(joinUpstreamUrl(node.internalUrl, path), {
        method: "POST",
        headers: { "content-type": "application/json", ...upstreamHeaders(node, path), "x-request-id": requestId },
        body: JSON.stringify({ ...body, model: ctx.upstreamModel }),
        signal: AbortSignal.timeout(180000),
      });
      if (!response.ok) {
        const errorBody = await response.text();
        await this.settleImage(ctx, openAiUsage(), "failed", response.status, path, safeErrorCode(errorBody, response.status));
        await this.reportUpstreamFailure(ctx, response.status, safeErrorCode(errorBody, response.status));
        reply.code(response.status).send(errorBody);
        return;
      }
      ctx.upstreamAccepted = true;
      const result = await response.json() as any;
      if (!Array.isArray(result.data) || result.data.length === 0) throw internalError("Image generation returned no images");
      await this.settleImage(ctx, openAiUsage(result.usage), "succeeded", 200, path);
      reply.code(200).send(result);
    } catch (err: any) {
      if (err instanceof SettlementError) throw err;
      if (ctx.upstreamAccepted) await this.holdAcceptedResult(ctx);
      request.log.error({ err, requestId }, "Image generation upstream failed");
      await this.settleImage(ctx, { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }, "failed", err.statusCode ?? 502, "/v1/images/generations", err.statusCode ? "request_rejected" : "transport_unknown");
      if (err.statusCode) throw err;
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

    // Model whitelist: key-level overrides group-level; both empty = all allowed.
    const keyModels = apiKey.models as string[] | null;
    const groupModels = apiKey.keyGroup?.models as string[] | null;
    const effectiveModels = (keyModels && keyModels.length > 0)
      ? keyModels
      : (groupModels && groupModels.length > 0 ? groupModels : null);
    if ((groupModels?.length && !groupModels.includes(requestedModel)) || (effectiveModels && !effectiveModels.includes(requestedModel))) {
      throw forbidden(`Model ${requestedModel} not allowed on this key`);
    }

    // Sensitive word check on prompt
    if (prompt) {
      const sensitiveService = new SensitiveWordService(this.prisma, this.redis);
      const check = await sensitiveService.checkContent(prompt);
      if (check.blocked) throw badRequest("Content contains prohibited content");
    }

    // Route to node (legacy single-node path for image/embeddings)
    const { alias, routes } = await this.resolveRoute(requestedModel);
    const channels = await this.resolveChannels(routes);
    const allNodes = await this.getHealthyNodesForChannels(channels.map((c) => c.id));
    if (allNodes.length === 0) throw internalError("No available upstream nodes");
    const node = allNodes[0];

    // Replace model with upstream model
    formData.set("model", routes.find(r => r.channelId === node.channelId)?.upstreamModel ?? requestedModel);

    const ctx: RelayContext = {
      requestId,
      apiKey: apiKey as any,
      model: requestedModel,
      upstreamModel: routes.find(r => r.channelId === node.channelId)?.upstreamModel ?? requestedModel,
      channelId: node.channelId,
      channelBillingMultiplier: channels.find(c => c.id === node.channelId)?.billingMultiplier ?? 1,
      nodeId: node.id,
      nodeUrl: node.internalUrl,
      nodeApiKey: node.internalApiKey,
      startedAt,
      protocol: "openai",
    };

    // Derive reference count from actual uploaded files, never from a caller-supplied billing hint.
    const referenceImages = [...formData.entries()].filter(([name, value]) =>
      (name === "image" || name === "image[]") && value instanceof Blob);
    await this.reserveQuota(requestId, apiKey.id, alias, {
      prompt, n: Number(formData.get("n") ?? 1), size: formData.get("size") ?? "auto",
      quality: formData.get("quality") ?? "auto",
      images: referenceImages.map(() => ({ type: "input_image" })),
    }, {[node.channelId.toString()]:ctx.channelBillingMultiplier}, true);
    try {
      const upstreamUrl = joinUpstreamUrl(node.internalUrl, "/v1/images/edits");
      const response = await fetch(upstreamUrl, {
        method: "POST",
        headers: {
          ...upstreamHeaders(node, "/v1/images/edits"),
          "x-request-id": requestId,
          "x-tokensea-user": apiKey.userId.toString(),
        },
        body: formData,
        signal: AbortSignal.timeout(180000),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        await this.settleImage(ctx, { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }, "failed", response.status, "/v1/images/edits", safeErrorCode(errorBody, response.status));
        await this.reportUpstreamFailure(ctx, response.status, safeErrorCode(errorBody, response.status));
        reply.code(response.status).send(errorBody);
        return;
      }

      ctx.upstreamAccepted = true;
      const responseBody = await response.json();
      const editUsage = openAiUsage((responseBody as any).usage);
      await this.settleImage(ctx, editUsage, "succeeded", 200, "/v1/images/edits");
      reply.code(200).header("content-type", "application/json").send(responseBody);
    } catch (err: any) {
      if (err instanceof SettlementError) throw err;
      if (ctx.upstreamAccepted) await this.holdAcceptedResult(ctx);
      request.log.error({ err, requestId }, "Image edit upstream failed");
      await this.settleImage(ctx, { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }, "failed", err.statusCode ?? 502, "/v1/images/edits", err.statusCode ? "request_rejected" : "transport_unknown");
      throw internalError("Image edit failed");
    }
  }

  private async settleImage(ctx: RelayContext, usage: UsageInfo, status: string, httpStatus: number, endpoint: string, errorCode?: string) {
    await this.settle({...ctx,endpoint},usage,status,httpStatus,errorCode);
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
    const u = openAiUsage(body.usage);
    return { ...u, inputTokens: u.inputTokens + (u.imageInputTokens ?? 0), cacheReadTokens: u.cacheReadTokens + (u.imageCacheReadTokens ?? 0), imageInputTokens: 0, imageCacheReadTokens: 0 };
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
          const u = parsed.usage ?? parsed.response?.usage;
          if (u) {
            const normalized = openAiUsage(u);
            inputTokens = Math.max(inputTokens, normalized.inputTokens + (normalized.imageInputTokens ?? 0));
            outputTokens = Math.max(outputTokens, normalized.outputTokens);
            cacheCreationTokens = Math.max(cacheCreationTokens, normalized.cacheCreationTokens);
            cacheReadTokens = Math.max(cacheReadTokens, normalized.cacheReadTokens + (normalized.imageCacheReadTokens ?? 0));
          }
        }
      } catch {}
    }

    return { inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens };
  }

  // ---- Sensitive word content extraction ----

  private extractContentText(body: any): string {
    const parts: string[] = [];
    if (typeof body.prompt === "string") parts.push(body.prompt);
    if (body.system) parts.push(typeof body.system === "string" ? body.system : JSON.stringify(body.system));
    for (const block of body.content ?? []) {
      if (typeof block === "string") parts.push(block);
      else if (typeof block?.text === "string") parts.push(block.text);
    }
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
