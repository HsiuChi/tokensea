import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hashPassword } from "../lib/password.js";
import { adminAuthHook, rootAuthHook } from "../middleware/user-auth.js";
import { notFound, badRequest } from "../lib/errors.js";
import { LogService } from "../services/log/log-service.js";

export async function adminRoutes(app: FastifyInstance) {
  const logService = new LogService(app.prisma);

  function audit(request: any, action: string, targetType: string, targetId: string, detail?: any) {
    logService.writeAuditLog({
      actorId: request.userId,
      actorName: (request.user as any)?.username,
      action,
      targetType,
      targetId,
      detail,
      ip: request.ip,
    }).catch(() => {});
  }

  // ========== USER MANAGEMENT ==========

  app.get("/users", { preHandler: adminAuthHook }, async (request) => {
    const query = z.object({
      page: z.coerce.number().min(1).default(1),
      pageSize: z.coerce.number().min(1).max(100).default(20),
      search: z.string().optional(),
    }).parse(request.query);

    const where = query.search
      ? { OR: [{ username: { contains: query.search, mode: "insensitive" as const } }, { email: { contains: query.search, mode: "insensitive" as const } }] }
      : {};

    const [items, total] = await Promise.all([
      app.prisma.user.findMany({
        where, orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize, take: query.pageSize,
        select: { id: true, username: true, email: true, name: true, role: true, status: true, quota: true, usedQuota: true, requestCount: true, createdAt: true },
      }),
      app.prisma.user.count({ where }),
    ]);

    return { data: { items, total, page: query.page, pageSize: query.pageSize } };
  });

  app.get("/users/:id", { preHandler: adminAuthHook }, async (request) => {
    const { id } = z.object({ id: z.coerce.bigint() }).parse(request.params);
    const user = await app.prisma.user.findUnique({
      where: { id },
      select: { id: true, username: true, email: true, name: true, role: true, status: true, quota: true, usedQuota: true, inviteCode: true, requestCount: true, createdAt: true, updatedAt: true },
    });
    if (!user) throw notFound("User not found");
    return { data: user };
  });

  app.post("/users", { preHandler: adminAuthHook }, async (request) => {
    const body = z.object({
      username: z.string().min(3).max(32),
      password: z.string().min(8),
      email: z.string().email().optional(),
      name: z.string().optional(),
      role: z.enum(["user", "admin"]).default("user"),
      quota: z.coerce.bigint().optional(),
    }).parse(request.body);

    const existing = await app.prisma.user.findUnique({ where: { username: body.username } });
    if (existing) throw badRequest("Username already taken");

    const passwordHash = await hashPassword(body.password);
    const { generateInviteCode } = await import("../lib/crypto.js");

    const user = await app.prisma.user.create({
      data: {
        username: body.username, passwordHash, email: body.email,
        name: body.name, role: body.role, quota: body.quota ?? 0n, usedQuota: 0n,
        inviteCode: generateInviteCode(), createdBy: request.userId!, status: "active",
      },
    });

    audit(request, "create_user", "user", user.id.toString(), { username: body.username, role: body.role });
    return { data: user };
  });

  app.put("/users/:id", { preHandler: adminAuthHook }, async (request) => {
    const { id } = z.object({ id: z.coerce.bigint() }).parse(request.params);
    const body = z.object({
      name: z.string().optional(),
      email: z.string().email().optional(),
      role: z.enum(["user", "admin"]).optional(),
      status: z.enum(["active", "disabled"]).optional(),
      quota: z.coerce.bigint().optional(),
      remark: z.string().optional(),
    }).parse(request.body);

    const user = await app.prisma.user.update({ where: { id }, data: body });
    audit(request, "update_user", "user", id.toString(), body);
    return { data: user };
  });

  app.delete("/users/:id", { preHandler: rootAuthHook }, async (request) => {
    const { id } = z.object({ id: z.coerce.bigint() }).parse(request.params);
    if (id === request.userId!) throw badRequest("Cannot delete yourself");
    await app.prisma.apiKey.deleteMany({ where: { userId: id } });
    await app.prisma.user.delete({ where: { id } });
    audit(request, "delete_user", "user", id.toString());
    return { data: { message: "User deleted" } };
  });

  // Reset user password
  app.post("/users/:id/reset-password", { preHandler: adminAuthHook }, async (request) => {
    const { id } = z.object({ id: z.coerce.bigint() }).parse(request.params);
    const { password } = z.object({ password: z.string().min(8) }).parse(request.body);
    const passwordHash = await hashPassword(password);
    await app.prisma.user.update({ where: { id }, data: { passwordHash } });
    audit(request, "reset_user_password", "user", id.toString());
    return { data: { message: "Password reset" } };
  });

  // ========== MODEL MANAGEMENT ==========

  app.get("/models", { preHandler: adminAuthHook }, async () => {
    const models = await app.prisma.modelAlias.findMany({ include: { routes: { include: { channel: true } } }, orderBy: { displayName: "asc" } });
    return { data: models };
  });

  app.post("/models", { preHandler: adminAuthHook }, async (request) => {
    const body = z.object({
      alias: z.string().min(1).max(64),
      displayName: z.string().min(1).max(64),
      provider: z.string().min(1).max(32),
      description: z.string().max(512).optional(),
      category: z.string().max(32).default("chat"),
      tags: z.array(z.string()).optional(),
      iconUrl: z.string().max(512).optional(),
      inputPrice: z.number().default(0),
      outputPrice: z.number().default(0),
      cacheWrite5mPrice: z.number().default(0),
      cacheWrite1hPrice: z.number().default(0),
      cacheReadPrice: z.number().default(0),
      pricing: z.any().optional(),
      supportsStream: z.boolean().default(true),
      supportsTools: z.boolean().default(true),
      supportsVision: z.boolean().default(false),
      maxContext: z.number().default(200000),
      sortOrder: z.number().default(0),
    }).parse(request.body);

    const model = await app.prisma.modelAlias.create({ data: body as any });
    audit(request, "create_model", "model", model.id.toString(), { alias: body.alias });
    return { data: model };
  });

  app.put("/models/:id", { preHandler: adminAuthHook }, async (request) => {
    const { id } = z.object({ id: z.coerce.bigint() }).parse(request.params);
    const body = request.body as Record<string, any>;
    const model = await app.prisma.modelAlias.update({ where: { id }, data: body });
    audit(request, "update_model", "model", id.toString());
    return { data: model };
  });

  app.delete("/models/:id", { preHandler: adminAuthHook }, async (request) => {
    const { id } = z.object({ id: z.coerce.bigint() }).parse(request.params);
    await app.prisma.modelRoute.deleteMany({ where: { aliasId: id } });
    await app.prisma.modelAlias.delete({ where: { id } });
    audit(request, "delete_model", "model", id.toString());
    return { data: { message: "Model deleted" } };
  });

  // Model routes
  app.post("/models/:aliasId/routes", { preHandler: adminAuthHook }, async (request) => {
    const { aliasId } = z.object({ aliasId: z.coerce.bigint() }).parse(request.params);
    const body = z.object({
      channelId: z.coerce.bigint(),
      upstreamModel: z.string().min(1),
      priority: z.number().int().default(0),
    }).parse(request.body);

    const route = await app.prisma.modelRoute.create({ data: { aliasId, ...body, status: "active" } });
    audit(request, "create_model_route", "model_route", route.id.toString(), { aliasId: aliasId.toString() });
    return { data: route };
  });

  app.delete("/models/routes/:id", { preHandler: adminAuthHook }, async (request) => {
    const { id } = z.object({ id: z.coerce.bigint() }).parse(request.params);
    await app.prisma.modelRoute.delete({ where: { id } });
    audit(request, "delete_model_route", "model_route", id.toString());
    return { data: { message: "Route deleted" } };
  });

  // ========== SYSTEM OPTIONS ==========

  app.get("/options", { preHandler: adminAuthHook }, async () => {
    const options = await app.prisma.option.findMany();
    const map: Record<string, string> = {};
    for (const o of options) map[o.key] = o.value;
    return { data: map };
  });

  app.put("/options", { preHandler: rootAuthHook }, async (request) => {
    const body = z.record(z.string(), z.string()).parse(request.body);
    const ops = Object.entries(body).map(([key, value]) =>
      app.prisma.option.upsert({ where: { key }, update: { value }, create: { key, value } })
    );
    await Promise.all(ops);
    audit(request, "update_options", "system", "options", body);
    return { data: { message: "Options updated" } };
  });

  // ========== ANNOUNCEMENTS ==========

  app.get("/announcements", { preHandler: adminAuthHook }, async (request) => {
    const query = z.object({
      page: z.coerce.number().min(1).default(1),
      pageSize: z.coerce.number().min(1).max(100).default(20),
    }).parse(request.query);

    const [items, total] = await Promise.all([
      app.prisma.announcement.findMany({
        orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      app.prisma.announcement.count(),
    ]);

    return { data: { items, total, page: query.page, pageSize: query.pageSize } };
  });

  app.post("/announcements", { preHandler: adminAuthHook }, async (request) => {
    const body = z.object({
      title: z.string().min(1).max(128),
      content: z.string().min(1),
      type: z.enum(["info", "warning", "maintenance"]).default("info"),
      pinned: z.boolean().default(false),
    }).parse(request.body);

    const announcement = await app.prisma.announcement.create({ data: body });
    audit(request, "create_announcement", "announcement", announcement.id.toString(), { title: body.title });
    return { data: announcement };
  });

  app.put("/announcements/:id", { preHandler: adminAuthHook }, async (request) => {
    const { id } = z.object({ id: z.coerce.bigint() }).parse(request.params);
    const body = z.object({
      title: z.string().min(1).max(128).optional(),
      content: z.string().min(1).optional(),
      type: z.enum(["info", "warning", "maintenance"]).optional(),
      pinned: z.boolean().optional(),
      status: z.enum(["active", "archived"]).optional(),
    }).parse(request.body);

    const announcement = await app.prisma.announcement.update({ where: { id }, data: body });
    audit(request, "update_announcement", "announcement", id.toString());
    return { data: announcement };
  });

  app.delete("/announcements/:id", { preHandler: adminAuthHook }, async (request) => {
    const { id } = z.object({ id: z.coerce.bigint() }).parse(request.params);
    await app.prisma.announcement.delete({ where: { id } });
    audit(request, "delete_announcement", "announcement", id.toString());
    return { data: { message: "Announcement deleted" } };
  });
}
