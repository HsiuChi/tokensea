import type { PrismaClient } from "@prisma/client";
import { notFound } from "../../lib/errors.js";
import { errorExplanation, csvCell } from "./request-detail.js";
import { timeRange, qualityStats } from "./statistics.js";

export class LogService {
  constructor(private prisma: PrismaClient) {}

  async listRequestLogs(opts: {
    userId?: bigint; apiKeyId?: bigint; page?: number; pageSize?: number;
    startDate?: string; endDate?: string; status?: string; requestedModel?: string;
  }) {
    const page = opts.page ?? 1;
    const pageSize = Math.min(opts.pageSize ?? 20, 100);
    const where: any = {};
    if (opts.userId) where.userId = opts.userId;
    if (opts.apiKeyId) where.apiKeyId = opts.apiKeyId;
    if (opts.status) where.status = opts.status;
    if (opts.requestedModel) where.requestedModel = { contains: opts.requestedModel, mode: "insensitive" };
    if (opts.startDate || opts.endDate) {
      where.startedAt = timeRange("30d", opts.startDate, opts.endDate);
    }

    const [items, total] = await Promise.all([
      this.prisma.requestLog.findMany({ where, orderBy: { startedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.requestLog.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async getUsageStats(userId: bigint, period: string, startDate?: string, endDate?: string, filters?: { status?: string; requestedModel?: string }) {
    const range = timeRange(period, startDate, endDate);
    const logWhere: any = { userId, startedAt: range };
    if (filters?.status) logWhere.status = filters.status;
    if (filters?.requestedModel) logWhere.requestedModel = { contains: filters.requestedModel, mode: "insensitive" };
    const totals = { billedRequests: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, billableUnits: 0n };
    // Daily breakdown with per-model detail from request logs
    const dailyMap = new Map<string, { requests: number; tokens: number; cost: bigint; models: Map<string, { requests: number; cost: bigint }> }>();
    const logs = await this.prisma.requestLog.findMany({
      where: logWhere,
      orderBy: { startedAt: "asc" },
    });

    for (const log of logs) {
      {
        totals.billedRequests++;
        totals.inputTokens += log.inputTokens;
        totals.outputTokens += log.outputTokens;
        totals.cacheCreationTokens += (log as any).cacheCreationTokens ?? 0;
        totals.cacheReadTokens += (log as any).cacheReadTokens ?? 0;
        totals.billableUnits += log.billableUnits;
      }
      const day = log.startedAt.toISOString().slice(0, 10);
      const existing = dailyMap.get(day) ?? { requests: 0, tokens: 0, cost: 0n, models: new Map<string, { requests: number; cost: bigint }>() };
      existing.requests++;
      existing.tokens += log.inputTokens + log.outputTokens;
      existing.cost += log.billableUnits;
      // Per-model within this day
      const m = log.requestedModel;
      const me = existing.models.get(m) ?? { requests: 0, cost: 0n };
      me.requests++;
      me.cost += log.billableUnits;
      existing.models.set(m, me);
      dailyMap.set(day, existing);
    }

    const daily = Array.from(dailyMap.entries()).map(([date, data]) => ({
      date,
      requests: data.requests,
      tokens: data.tokens,
      cost: data.cost.toString(),
      models: Array.from(data.models.entries()).map(([model, md]) => ({
        model,
        requests: md.requests,
        cost: md.cost.toString(),
      })),
    }));

    // Model breakdown
    const modelMap = new Map<string, { requestCount: number; promptTokens: number; completionTokens: number; cacheCreationTokens: number; cacheReadTokens: number; cost: bigint }>();
    for (const log of logs) {
      const model = log.requestedModel;
      const existing = modelMap.get(model) ?? { requestCount: 0, promptTokens: 0, completionTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, cost: 0n };
      existing.requestCount++;
      existing.promptTokens += log.inputTokens;
      existing.completionTokens += log.outputTokens;
      existing.cacheCreationTokens += (log as any).cacheCreationTokens ?? 0;
      existing.cacheReadTokens += (log as any).cacheReadTokens ?? 0;
      existing.cost += log.billableUnits;
      modelMap.set(model, existing);
    }
    const modelBreakdown = Array.from(modelMap.entries()).map(([model, data]) => ({
      model,
      requestCount: data.requestCount,
      promptTokens: data.promptTokens,
      completionTokens: data.completionTokens,
      cacheCreationTokens: data.cacheCreationTokens,
      cacheReadTokens: data.cacheReadTokens,
      cost: data.cost.toString(),
    }));

    return {
      period,
      range: { start: range.gte.toISOString(), end: range.lt.toISOString(), timezone: "UTC" },
      quality: qualityStats(logs),
      totals: { ...totals, billableUnits: totals.billableUnits.toString() },
      daily,
      modelBreakdown,
    };
  }

  async requestDetail(userId: bigint, requestId: string) {
    const log = await this.prisma.requestLog.findFirst({ where: { requestId, userId } });
    if (!log) throw notFound("Request not found");
    const { nodeId, channelId, ...safe } = log;
    return { ...safe, errorExplanation: errorExplanation(log), billingExplanation: log.pricingDetail
      ? "按请求发生时记录的 Token 用量 × 单价 × 倍率结算，金额四舍五入到 0.000001 美元；下方为当时的计费快照。"
      : log.billableUnits === 0n ? "此请求未扣费；没有保存计费快照。" : "历史记录缺少计费快照，不使用当前价格反推历史费用。" };
  }

  async exportRequests(userId: bigint, opts: { startDate?: string; endDate?: string; status?: string; requestedModel?: string }) {
    const where: any = { userId, startedAt: timeRange("30d", opts.startDate, opts.endDate) };
    if (opts.status) where.status = opts.status;
    if (opts.requestedModel) where.requestedModel = { contains: opts.requestedModel, mode: "insensitive" };
    const rows = await this.prisma.requestLog.findMany({ where, orderBy: [{ startedAt: "desc" }, { id: "desc" }], take: 10001 });
    const truncated = rows.length > 10000;
    const header = ["请求 ID", "时间 UTC", "模型", "接口", "状态", "HTTP", "错误代码", "输入 Tokens", "输出 Tokens", "缓存读取", "缓存写入", "耗时 ms", "费用 USD", "计费快照"];
    const csv = "\uFEFF" + [header, ...rows.slice(0,10000).map(l => [l.requestId, l.startedAt.toISOString(), l.requestedModel, l.endpoint, l.status, l.httpStatus, l.errorCode, l.inputTokens, l.outputTokens, l.cacheReadTokens, l.cacheCreationTokens, l.durationMs, (Number(l.billableUnits)/1e6).toFixed(6), JSON.stringify(l.pricingDetail)])].map(row => row.map(csvCell).join(",")).join("\r\n");
    return { csv, count: Math.min(rows.length,10000), truncated, message: truncated ? "最多导出 10000 条，请缩小时间范围导出其余记录。" : "" };
  }

  async listAuditLogs(opts?: { page?: number; pageSize?: number; actorId?: bigint }) {
    const page = opts?.page ?? 1;
    const pageSize = Math.min(opts?.pageSize ?? 20, 100);
    const where: any = {};
    if (opts?.actorId) where.actorId = opts.actorId;

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async writeAuditLog(data: { actorId?: bigint; actorName?: string; action: string; targetType: string; targetId?: string; detail?: any; ip?: string }) {
    return this.prisma.auditLog.create({ data });
  }

  // Global admin stats
  async getGlobalStats() {
    const [totalUsers, activeUsers, totalKeys, activeKeys, totalRequests, todayRequests] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: "active" } }),
      this.prisma.apiKey.count(),
      this.prisma.apiKey.count({ where: { status: "active" } }),
      this.prisma.requestLog.count(),
      this.prisma.requestLog.count({
        where: { startedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
      }),
    ]);

    const totalRevenue = await this.prisma.usageLedger.aggregate({ _sum: { billableUnits: true } });
    const nodes = await this.prisma.channelNode.findMany({ include: { channel: true } });

    // Aggregations by model and channel (last 30 days)
    const since = new Date(Date.now() - 30 * 86400_000);
    const byModel = await this.prisma.requestLog.groupBy({
      by: ["requestedModel"],
      where: { startedAt: { gte: since }, status: "succeeded" },
      _sum: { inputTokens: true, outputTokens: true, billableUnits: true },
      _count: true,
      orderBy: { _sum: { billableUnits: "desc" } },
      take: 20,
    });
    const byChannel = await this.prisma.requestLog.groupBy({
      by: ["channelId"],
      where: { startedAt: { gte: since }, status: "succeeded", channelId: { not: null } },
      _sum: { inputTokens: true, outputTokens: true, billableUnits: true },
      _count: true,
      orderBy: { _sum: { billableUnits: "desc" } },
      take: 20,
    });
    // resolve channel names
    const channelIds = byChannel.map((b) => b.channelId!).filter(Boolean);
    const channels = channelIds.length > 0
      ? await this.prisma.channel.findMany({ where: { id: { in: channelIds } } })
      : [];
    const channelMap = new Map(channels.map((c) => [c.id.toString(), c.name]));

    // Daily trend (last 14 days)
    const trendRows = await this.prisma.requestLog.groupBy({
      by: ["startedAt"],
      where: { startedAt: { gte: new Date(Date.now() - 14 * 86400_000) }, status: "succeeded" },
      _sum: { billableUnits: true, inputTokens: true, outputTokens: true },
      _count: true,
    });
    // bucket by day
    const byDay = new Map<string, { date: string; requests: number; billableUnits: bigint; inputTokens: number; outputTokens: number }>();
    for (const r of trendRows) {
      const day = r.startedAt.toISOString().slice(0, 10);
      const prev = byDay.get(day) ?? { date: day, requests: 0, billableUnits: 0n, inputTokens: 0, outputTokens: 0 };
      prev.requests += r._count;
      prev.billableUnits += r._sum.billableUnits ?? 0n;
      prev.inputTokens += r._sum.inputTokens ?? 0;
      prev.outputTokens += r._sum.outputTokens ?? 0;
      byDay.set(day, prev);
    }

    return {
      totalUsers, activeUsers, totalKeys, activeKeys,
      totalRequests, todayRequests,
      totalRevenue: (totalRevenue._sum.billableUnits ?? 0n).toString(),
      nodes: nodes.map(n => ({
        id: n.id.toString(), name: n.name, channel: n.channel.name,
        status: n.status, currentLoad: n.currentLoad, maxConcurrent: n.maxConcurrent,
      })),
      byModel: byModel.map((b) => ({
        model: b.requestedModel, requests: b._count,
        inputTokens: b._sum.inputTokens ?? 0, outputTokens: b._sum.outputTokens ?? 0,
        billableUnits: (b._sum.billableUnits ?? 0n).toString(),
      })),
      byChannel: byChannel.map((b) => ({
        channelId: b.channelId?.toString() ?? "", channel: channelMap.get(b.channelId?.toString() ?? "") ?? "unknown",
        requests: b._count, inputTokens: b._sum.inputTokens ?? 0, outputTokens: b._sum.outputTokens ?? 0,
        billableUnits: (b._sum.billableUnits ?? 0n).toString(),
      })),
      byDay: [...byDay.values()].sort((a, b) => a.date < b.date ? -1 : 1).map((d) => ({
        ...d, billableUnits: d.billableUnits.toString(),
      })),
    };
  }
}
