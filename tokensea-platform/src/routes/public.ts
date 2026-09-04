import type { FastifyInstance } from "fastify";
import { z } from "zod";

export async function publicRoutes(app: FastifyInstance) {

  // Public, aggregate-only service quality data. No upstream URLs, keys, node
  // names, user data, prompts, or request identifiers are exposed here.
  app.get("/channel-status", async (request) => {
    const { period } = z.object({
      period: z.enum(["24h", "7d", "30d"]).default("7d"),
    }).parse(request.query);
    const periodMs = period === "24h" ? 86_400_000 : period === "30d" ? 30 * 86_400_000 : 7 * 86_400_000;
    const since = new Date(Date.now() - periodMs);

    const models = await app.prisma.modelAlias.findMany({
      where: { status: "active", category: "chat" },
      orderBy: [{ sortOrder: "desc" }, { displayName: "asc" }],
      select: {
        id: true,
        alias: true,
        displayName: true,
        provider: true,
        routes: {
          where: { status: "active" },
          orderBy: { priority: "desc" },
          select: {
            channel: {
              select: {
                status: true,
                nodes: { select: { id: true, status: true, probeLatency: true } },
              },
            },
          },
        },
      },
    });
    const logs = await app.prisma.requestLog.findMany({
      where: { requestedModel: { in: models.map((model) => model.alias) }, startedAt: { gte: since } },
      orderBy: { startedAt: "desc" },
      take: 5000,
      select: {
        requestedModel: true,
        status: true,
        httpStatus: true,
        errorCode: true,
        durationMs: true,
        startedAt: true,
      },
    });

    const data = models.map((model) => {
      const modelLogs = logs.filter((log) => log.requestedModel === model.alias);
      const nodesById = new Map<string, { status: string; probeLatency: number | null }>();
      for (const route of model.routes) {
        if (route.channel.status === "disabled") continue;
        for (const node of route.channel.nodes) nodesById.set(node.id.toString(), node);
      }
      const nodes = [...nodesById.values()];
      const qualityLogs = modelLogs.filter((log) => {
        const code = log.httpStatus ?? 0;
        return !(code >= 400 && code < 500 && code !== 408 && code !== 429);
      });
      const successful = qualityLogs.filter((log) => log.status === "succeeded" && (log.httpStatus ?? 200) < 400);
      const successfulWithLatency = modelLogs.filter((log) => log.status === "succeeded" && log.durationMs != null);
      const healthyNodes = nodes.filter((node) => node.status === "healthy").length;
      const degradedNodes = nodes.filter((node) => node.status === "degraded").length;
      const nodeLatencies = nodes.map((node) => node.probeLatency).filter((latency): latency is number => latency != null);
      const availability = qualityLogs.length > 0
        ? successful.length / qualityLogs.length * 100
        : nodes.length > 0 ? healthyNodes / nodes.length * 100 : 0;
      const latencyMs = successfulWithLatency.length > 0
        ? Math.round(successfulWithLatency.reduce((sum, log) => sum + (log.durationMs ?? 0), 0) / successfulWithLatency.length)
        : null;
      const pingMs = nodeLatencies.length > 0
        ? Math.round(nodeLatencies.reduce((sum, latency) => sum + latency, 0) / nodeLatencies.length)
        : null;
      const rateLimited = modelLogs.filter((log) => log.httpStatus === 429).length;
      const serverErrors = modelLogs.filter((log) => (log.httpStatus ?? 0) >= 500).length;
      const timeouts = modelLogs.filter((log) => log.httpStatus === 408 || /timeout/i.test(log.errorCode ?? "")).length;
      const state = healthyNodes === 0
        ? "outage"
        : availability < 95 || degradedNodes > 0 || rateLimited > 0 || serverErrors > 0
          ? "degraded"
          : "operational";

      return {
        id: model.id.toString(),
        name: model.displayName,
        alias: model.alias,
        provider: model.provider,
        state,
        availability: Number(availability.toFixed(2)),
        latencyMs,
        pingMs,
        totalRequests: modelLogs.length,
        rateLimited,
        serverErrors,
        timeouts,
        nodes: { healthy: healthyNodes, degraded: degradedNodes, total: nodes.length },
        recent: modelLogs.slice(0, 60).reverse().map((log) => ({
          status: log.httpStatus ?? (log.status === "succeeded" ? 200 : 500),
          durationMs: log.durationMs,
          at: log.startedAt.toISOString(),
        })),
      };
    });

    const operational = data.filter((channel) => channel.state === "operational").length;
    return {
      data,
      summary: {
        state: data.some((channel) => channel.state === "outage") ? "outage" : data.some((channel) => channel.state === "degraded") ? "degraded" : "operational",
        operational,
        total: data.length,
      },
      period,
      updatedAt: new Date().toISOString(),
    };
  });

  // Public: list active announcements
  app.get("/announcements", async () => {
    const announcements = await app.prisma.announcement.findMany({
      where: { status: "active" },
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      take: 20,
    });
    return { data: announcements };
  });

  // Public: list models for marketplace
  app.get("/models", async (request) => {
    const query = z.object({
      category: z.string().optional(),
      search: z.string().optional(),
      provider: z.string().optional(),
    }).parse(request.query);

    const where: any = { status: "active" };
    if (query.category) where.category = query.category;
    if (query.provider) where.provider = query.provider;
    if (query.search) {
      where.OR = [
        { alias: { contains: query.search, mode: "insensitive" } },
        { displayName: { contains: query.search, mode: "insensitive" } },
        { description: { contains: query.search, mode: "insensitive" } },
      ];
    }

    const models = await app.prisma.modelAlias.findMany({
      where,
      orderBy: [{ sortOrder: "desc" }, { displayName: "asc" }],
      select: {
        id: true,
        alias: true,
        displayName: true,
        provider: true,
        description: true,
        category: true,
        tags: true,
        iconUrl: true,
        inputPrice: true,
        outputPrice: true,
        cacheWrite5mPrice: true,
        cacheWrite1hPrice: true,
        cacheReadPrice: true,
        pricing: true,
        supportsStream: true,
        supportsTools: true,
        supportsVision: true,
        maxContext: true,
        sortOrder: true,
      },
    });

    // Get distinct categories for filter sidebar
    const categories = await app.prisma.modelAlias.findMany({
      where: { status: "active" },
      select: { category: true },
      distinct: ["category"],
      orderBy: { category: "asc" },
    });

    // Get distinct providers for filter sidebar
    const providers = await app.prisma.modelAlias.findMany({
      where: { status: "active" },
      select: { provider: true },
      distinct: ["provider"],
      orderBy: { provider: "asc" },
    });

    return {
      data: models,
      categories: categories.map((c) => c.category),
      providers: providers.map((p) => p.provider),
    };
  });

  // Public: single model detail
  app.get("/models/:alias", async (request) => {
    const { alias } = z.object({ alias: z.string() }).parse(request.params);

    const model = await app.prisma.modelAlias.findUnique({
      where: { alias, status: "active" },
      include: { routes: { where: { status: "active" }, orderBy: { priority: "desc" } } },
    });

    if (!model) return { data: null };

    return { data: model };
  });
}
