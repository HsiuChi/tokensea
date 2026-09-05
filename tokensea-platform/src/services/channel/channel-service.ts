import { Prisma, type PrismaClient } from "@prisma/client";
import { badRequest, notFound } from "../../lib/errors.js";
import { encryptUpstreamSecret, maskUpstreamSecret, upstreamSecretFingerprint } from "../../lib/upstream-secret.js";
import { KSYUN_MODELS } from "../../config/ksyun-model-catalog.js";
import { preserveRetailPrice } from "../billing/trial-pricing.js";
import { probeCpa, upstreamHeaders, upstreamUrl } from "./upstream-request.js";

type NodeInput = {
  name: string;
  internalUrl: string;
  internalApiKey: string;
  maxConcurrent?: number;
  adapter?: string;
  authType?: string;
  probePath?: string;
  probeTimeoutMs?: number;
};

function publicNode<T extends Record<string, any>>(node: T) {
  const { internalApiKey: _secret, ...safe } = node;
  return { ...safe, apiKeyMasked: node.keyPrefix || "••••••••" };
}

export class ChannelService {
  constructor(private prisma: PrismaClient) {}

  async list(opts?: { page?: number; pageSize?: number }) {
    const page = opts?.page ?? 1;
    const pageSize = Math.min(opts?.pageSize ?? 20, 100);
    const [items, total] = await Promise.all([
      this.prisma.channel.findMany({
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize, take: pageSize,
        include: { nodes: true },
      }),
      this.prisma.channel.count(),
    ]);
    return { items: items.map((channel) => ({ ...channel, nodes: channel.nodes.map(publicNode) })), total, page, pageSize };
  }

  async get(id: bigint) {
    const ch = await this.prisma.channel.findUnique({ where: { id }, include: { nodes: true } });
    if (!ch) throw notFound("Channel not found");
    return { ...ch, nodes: ch.nodes.map(publicNode) };
  }

  async create(data: { name: string; type: string; models: string[]; priority?: number; weight?: number }) {
    return this.prisma.channel.create({ data: {
      name: data.name, type: data.type as any, models: data.models,
      priority: data.priority ?? 0, weight: data.weight ?? 1,
    }});
  }

  async update(id: bigint, data: Record<string, any>) {
    return this.prisma.channel.update({ where: { id }, data });
  }

  async delete(id: bigint) {
    await this.prisma.channelNode.deleteMany({ where: { channelId: id } });
    await this.prisma.modelRoute.deleteMany({ where: { channelId: id } });
    await this.prisma.channel.delete({ where: { id } });
  }

  // Node operations
  async addNode(channelId: bigint, data: NodeInput) {
    const ch = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!ch) throw notFound("Channel not found");
    const rawKey = data.internalApiKey.trim();
    const node = await this.prisma.channelNode.create({ data: {
      channelId, name: data.name, internalUrl: data.internalUrl,
      internalApiKey: encryptUpstreamSecret(rawKey),
      keyFingerprint: upstreamSecretFingerprint(rawKey),
      keyPrefix: maskUpstreamSecret(rawKey),
      adapter: data.adapter ?? "dario",
      authType: data.adapter === "cpa" ? "bearer" : data.authType ?? "x-api-key",
      probePath: data.adapter === "cpa" ? "/v1/models" : data.probePath,
      probeTimeoutMs: data.probeTimeoutMs ?? 5000,
      maxConcurrent: data.maxConcurrent ?? 5,
    }});
    return publicNode(node);
  }

  async updateNode(nodeId: bigint, data: Record<string, any>) {
    const update = { ...data };
    if (typeof update.internalApiKey === "string" && update.internalApiKey.trim()) {
      const rawKey = update.internalApiKey.trim();
      update.internalApiKey = encryptUpstreamSecret(rawKey);
      update.keyFingerprint = upstreamSecretFingerprint(rawKey);
      update.keyPrefix = maskUpstreamSecret(rawKey);
    } else {
      delete update.internalApiKey;
    }
    return publicNode(await this.prisma.channelNode.update({ where: { id: nodeId }, data: update }));
  }

  async bootstrapKsyun(data: { apiKeys: string[]; modelIds?: string[]; channelName?: string; maxConcurrent?: number }) {
    const keys = [...new Set(data.apiKeys.map((key) => key.trim()).filter(Boolean))];
    if (keys.length === 0) throw badRequest("At least one KSP API key is required");
    const selected = new Set(data.modelIds?.length ? data.modelIds : KSYUN_MODELS.map((model) => model.id));
    const models = KSYUN_MODELS.filter((model) => selected.has(model.id));
    if (models.length === 0) throw badRequest("Select at least one supported KSP model");
    const cnyPerUsd = Number(process.env.KSYUN_CNY_PER_USD || 7.2);
    const usd = (cny: number) => +(cny / cnyPerUsd).toFixed(6);

    const channel = await this.prisma.channel.findFirst({ where: { name: data.channelName || "金山云星流" } });
    const savedChannel = channel
      ? await this.prisma.channel.update({ where: { id: channel.id }, data: {
          type: "custom", status: "active", baseUrl: "https://kspmas.ksyun.com",
          models: models.map((model) => model.id), probeEnabled: true, testModel: models[0].id,
          retryPolicy: { rules: [401, 403, 408, 429, 500, 502, 503, 504].map((status) => ({ status, action: "continue-and-cooldown" })) },
        } })
      : await this.prisma.channel.create({ data: {
          name: data.channelName || "金山云星流", type: "custom", status: "active",
          baseUrl: "https://kspmas.ksyun.com", models: models.map((model) => model.id),
          priority: 50, weight: 1, billingMultiplier: 1, probeEnabled: true,
          testModel: models[0].id,
          retryPolicy: { rules: [401, 403, 408, 429, 500, 502, 503, 504].map((status) => ({ status, action: "continue-and-cooldown" })) },
        } });

    let addedKeys = 0;
    for (const [index, key] of keys.entries()) {
      const fingerprint = upstreamSecretFingerprint(key);
      const exists = await this.prisma.channelNode.findFirst({ where: { channelId: savedChannel.id, keyFingerprint: fingerprint } });
      if (exists) continue;
      await this.prisma.channelNode.create({ data: {
        channelId: savedChannel.id,
        name: `KSP Key ${String(index + 1).padStart(2, "0")}`,
        internalUrl: "https://kspmas.ksyun.com",
        internalApiKey: encryptUpstreamSecret(key),
        keyFingerprint: fingerprint,
        keyPrefix: maskUpstreamSecret(key),
        adapter: "ksyun",
        authType: "bearer",
        probePath: "/v1/models",
        probeTimeoutMs: 10000,
        maxConcurrent: data.maxConcurrent ?? 20,
      } });
      addedKeys++;
    }

    for (const [sortOrder, model] of models.entries()) {
      const existingPrice = await this.prisma.modelAlias.findUnique({ where: { alias: model.id } });
      const alias = await this.prisma.modelAlias.upsert({
        where: { alias: model.id },
        update: {
          displayName: model.displayName, provider: model.provider, inputPrice: usd(model.inputPrice),
          outputPrice: usd(model.outputPrice), cacheReadPrice: usd(model.cacheReadPrice ?? 0),
          description: model.description ?? null, category: model.category ?? "chat",
          maxContext: model.maxContext, supportsVision: model.supportsVision ?? false,
          supportsStream: model.supportsStream ?? true, supportsTools: model.supportsTools ?? true, status: "active",
          pricing: model.category === "video" ? Prisma.JsonNull : { currency: "USD", unit: "1M tokens", source: "KSP public pricing", cnyPerUsd, upstreamCny: { input: model.inputPrice, output: model.outputPrice, cacheRead: model.cacheReadPrice ?? 0 }, firstTier: true },
          ...preserveRetailPrice(existingPrice),
        },
        create: {
          alias: model.id, displayName: model.displayName, provider: model.provider,
          description: model.description ?? null,
          category: model.category ?? "chat", tags: [model.provider, model.category ?? "chat"],
          inputPrice: usd(model.inputPrice), outputPrice: usd(model.outputPrice),
          cacheReadPrice: usd(model.cacheReadPrice ?? 0), maxContext: model.maxContext,
          supportsVision: model.supportsVision ?? false, supportsStream: model.supportsStream ?? true,
          supportsTools: model.supportsTools ?? true, sortOrder: 1000 - sortOrder, status: "active",
          pricing: model.category === "video" ? Prisma.JsonNull : { currency: "USD", unit: "1M tokens", source: "KSP public pricing", cnyPerUsd, upstreamCny: { input: model.inputPrice, output: model.outputPrice, cacheRead: model.cacheReadPrice ?? 0 }, firstTier: true },
        },
      });
      const route = await this.prisma.modelRoute.findFirst({ where: { aliasId: alias.id, channelId: savedChannel.id } });
      if (route) {
        await this.prisma.modelRoute.update({ where: { id: route.id }, data: { upstreamModel: model.id, priority: 50, status: "active" } });
      } else {
        await this.prisma.modelRoute.create({ data: { aliasId: alias.id, channelId: savedChannel.id, upstreamModel: model.id, priority: 50, status: "active" } });
      }
    }

    return { channelId: savedChannel.id, addedKeys, totalSubmittedKeys: keys.length, models: models.map((model) => model.id) };
  }

  /** New discoveries remain inactive until pricing and compatibility are reviewed. */
  async syncCpaModels(channelId: bigint) {
    const channel = await this.prisma.channel.findUnique({ where: { id: channelId }, include: { nodes: true } });
    if (!channel) throw notFound("Channel not found");
    const nodes = channel.nodes.filter(n => n.adapter === "cpa");
    if (!nodes.length) throw badRequest("This channel has no CPA nodes");
    const results = await Promise.all(nodes.map(n => probeCpa(n)));
    if (results.some(r => !r.valid || !r.models.length)) throw badRequest("CPA model catalogue unavailable; no models changed");
    const models = [...new Map(results.flatMap(r => r.models).map(m => [m.id, m])).values()];
    return this.prisma.$transaction(async tx => {
      let addedModels = 0;
      let addedRoutes = 0;
      for (const model of models) {
        let alias = await tx.modelAlias.findUnique({ where: { alias: model.id } });
        if (!alias) {
          const image = /image/i.test(model.id);
          alias = await tx.modelAlias.create({ data: {
            alias: model.id, displayName: model.id, provider: model.owned_by?.slice(0, 32) || "OpenAI",
            category: image ? "image" : "chat", status: "inactive", supportsStream: !image,
            supportsTools: !image, description: "待审核：请确认模型能力、价格和调用兼容性后启用",
            pricing: { reviewRequired: true, source: "cpa-discovery" },
          } });
          addedModels++;
        }
        const route = await tx.modelRoute.findFirst({ where: { channelId, aliasId: alias.id } });
        if (!route) {
          await tx.modelRoute.create({ data: { channelId, aliasId: alias.id, upstreamModel: model.id, priority: 10, status: "inactive" } });
          addedRoutes++;
        }
      }
      await tx.channel.update({ where: { id: channelId }, data: { models: models.map(m => m.id) } });
      return { discovered: models.length, addedModels, addedRoutes, message: "新模型及路由已停用入库；请审核价格和兼容性后启用。已有价格和启用状态保持不变。" };
    });
  }

  async deleteNode(nodeId: bigint) {
    return this.prisma.channelNode.delete({ where: { id: nodeId } });
  }

  async healthCheck(nodeId: bigint) {
    const node = await this.prisma.channelNode.findUnique({ where: { id: nodeId } });
    if (!node) throw notFound("Node not found");

    try {
      if (node.adapter === "cpa") {
        const result = await probeCpa(node);
        await this.prisma.channelNode.update({ where: { id: nodeId }, data: {
          status: result.healthy ? "healthy" : "unhealthy", lastHealthCheck: new Date(),
          probeLatency: result.latency, healthStatus: { modelCount: result.models.length, httpStatus: result.status },
        } });
        return { healthy: result.healthy, latency: result.latency, data: { modelCount: result.models.length, httpStatus: result.status } };
      }
      const start = Date.now();
      const path = node.probePath || "/healthz";
      const res = await fetch(upstreamUrl(node.internalUrl, path), {
        signal: AbortSignal.timeout(node.probeTimeoutMs || 10000),
        headers: upstreamHeaders(node, path),
      });
      const latency = Date.now() - start;
      const body = await res.json();

      await this.prisma.channelNode.update({
        where: { id: nodeId },
        data: {
          status: res.ok ? "healthy" : "degraded",
          healthStatus: body,
          lastHealthCheck: new Date(),
        },
      });

      return { healthy: res.ok, latency, data: body };
    } catch (err: any) {
      await this.prisma.channelNode.update({
        where: { id: nodeId },
        data: { status: "unhealthy", lastHealthCheck: new Date() },
      });
      return { healthy: false, error: err.message };
    }
  }

  /**
   * Proxy the dario node's OAuth / account-pool status: /status (pool health,
   * token expiry) plus /accounts (per-account utilization), both key-gated.
   * Each part is best-effort so one failing endpoint doesn't hide the other.
   */
  async getOAuthStatus(nodeId: bigint) {
    const node = await this.prisma.channelNode.findUnique({ where: { id: nodeId } });
    if (!node) throw notFound("Node not found");
    if (node.adapter !== "dario") return { node: node.name, status: null, accounts: null, errors: { status: "OAuth status is only available for dario nodes" } };
    const headers = upstreamHeaders(node, "/status");

    const [status, accounts] = await Promise.allSettled([
      (async () => {
        const res = await fetch(`${node.internalUrl}/status`, {
          headers, signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })(),
      (async () => {
        const res = await fetch(`${node.internalUrl}/accounts`, {
          headers, signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })(),
    ]);

    return {
      node: node.name,
      status: status.status === "fulfilled" ? status.value : null,
      accounts: accounts.status === "fulfilled" ? accounts.value : null,
      errors: {
        status: status.status === "rejected" ? String(status.reason?.message ?? status.reason) : undefined,
        accounts: accounts.status === "rejected" ? String(accounts.reason?.message ?? accounts.reason) : undefined,
      },
    };
  }

  /**
   * One-click channel test: pick a healthy node in the channel, send a tiny
   * probe request with x-tokensea-probe:1 (relay skips billing/quota).
   */
  async testChannel(channelId: bigint, model?: string) {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      include: { nodes: { where: { status: "healthy" }, take: 1 } },
    });
    if (!channel) throw notFound("Channel not found");
    const node = channel.nodes[0];
    if (!node) return { ok: false, error: "no healthy node" };
    return this._probeNode(node, model ?? channel.testModel ?? (channel.models as string[])[0] ?? "gpt-5.5");
  }

  /**
   * Node-level test: force use this specific node regardless of status.
   */
  async testNode(channelId: bigint, nodeId: bigint, model?: string) {
    const node = await this.prisma.channelNode.findFirst({
      where: { id: nodeId, channelId },
    });
    if (!node) throw notFound("Node not found");
    const ch = await this.prisma.channel.findUnique({ where: { id: channelId } });
    return this._probeNode(node, model ?? ch?.testModel ?? ((ch?.models as string[]) ?? [])[0] ?? "gpt-5.5");
  }

  private async _probeNode(node: any, model: string) {
    const start = Date.now();
    try {
      const path = "/v1/chat/completions";
      const res = await fetch(upstreamUrl(node.internalUrl, path), {
        method: "POST",
        signal: AbortSignal.timeout(30_000),
        headers: {
          "Content-Type": "application/json",
          ...upstreamHeaders(node, path),
          "x-tokensea-probe": "1",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 5,
          stream: false,
        }),
      });
      const latency = Date.now() - start;
      const body = await res.json().catch(() => null);
      return {
        ok: res.ok,
        latencyMs: latency,
        status: res.status,
        modelEcho: body?.model ?? null,
        node: node.name,
        error: res.ok ? undefined : (body?.error?.message ?? `HTTP ${res.status}`),
      };
    } catch (err: any) {
      return { ok: false, latencyMs: Date.now() - start, error: err.message, node: node.name };
    }
  }
}
