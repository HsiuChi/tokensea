import type { FastifyInstance } from "fastify";
import { z } from "zod";

export async function publicRoutes(app: FastifyInstance) {

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
