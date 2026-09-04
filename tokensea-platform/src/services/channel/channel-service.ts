import type { PrismaClient } from "@prisma/client";
import { notFound } from "../../lib/errors.js";

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
    return { items, total, page, pageSize };
  }

  async get(id: bigint) {
    const ch = await this.prisma.channel.findUnique({ where: { id }, include: { nodes: true } });
    if (!ch) throw notFound("Channel not found");
    return ch;
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
  async addNode(channelId: bigint, data: { name: string; internalUrl: string; internalApiKey: string; maxConcurrent?: number }) {
    const ch = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!ch) throw notFound("Channel not found");
    return this.prisma.channelNode.create({ data: {
      channelId, name: data.name, internalUrl: data.internalUrl,
      internalApiKey: data.internalApiKey, maxConcurrent: data.maxConcurrent ?? 5,
    }});
  }

  async updateNode(nodeId: bigint, data: Record<string, any>) {
    return this.prisma.channelNode.update({ where: { id: nodeId }, data });
  }

  async deleteNode(nodeId: bigint) {
    return this.prisma.channelNode.delete({ where: { id: nodeId } });
  }

  async healthCheck(nodeId: bigint) {
    const node = await this.prisma.channelNode.findUnique({ where: { id: nodeId } });
    if (!node) throw notFound("Node not found");

    try {
      const start = Date.now();
      const res = await fetch(`${node.internalUrl}/healthz`, { signal: AbortSignal.timeout(10000) });
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
      const res = await fetch(`${node.internalUrl}/v1/chat/completions`, {
        method: "POST",
        signal: AbortSignal.timeout(30_000),
        headers: {
          "Content-Type": "application/json",
          "x-api-key": node.internalApiKey,
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
