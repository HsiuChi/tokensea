import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { LogService } from "../services/log/log-service.js";
import { adminAuthHook, userAuthHook } from "../middleware/user-auth.js";

export async function logRoutes(app: FastifyInstance) {
  const logService = new LogService(app.prisma);

  // User: own request logs
  app.get("/self", { preHandler: userAuthHook }, async (request) => {
    const query = z.object({
      page: z.coerce.number().min(1).default(1),
      pageSize: z.coerce.number().min(1).max(100).default(20),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      status: z.enum(["succeeded", "failed", "rate_limited", "timeout"]).optional(),
      requestedModel: z.string().optional(),
    }).parse(request.query);

    return { data: await logService.listRequestLogs({ ...query, userId: request.userId! }) };
  });

  // User: own usage stats
  app.get("/self/stats", { preHandler: userAuthHook }, async (request) => {
    const query = z.object({
      period: z.string().default(new Date().toISOString().slice(0, 7).replace("-", "")),
      status: z.enum(["succeeded", "failed", "rate_limited", "timeout"]).optional(),
      requestedModel: z.string().max(64).optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }).parse(request.query);
    return { data: await logService.getUsageStats(request.userId!, query.period, query.startDate, query.endDate, query) };
  });

  app.get("/self/export", { preHandler: userAuthHook }, async (request) => {
    const query = z.object({ startDate: z.string().optional(), endDate: z.string().optional(), status: z.enum(["succeeded", "failed", "rate_limited", "timeout"]).optional(), requestedModel: z.string().max(64).optional() }).parse(request.query);
    return { data: await logService.exportRequests(request.userId!, query) };
  });
  app.get("/self/:requestId", { preHandler: userAuthHook }, async (request) => {
    const { requestId } = z.object({ requestId: z.string().uuid() }).parse(request.params);
    return { data: await logService.requestDetail(request.userId!, requestId) };
  });

  // Admin: all request logs
  app.get("/", { preHandler: adminAuthHook }, async (request) => {
    const query = z.object({
      page: z.coerce.number().min(1).default(1),
      pageSize: z.coerce.number().min(1).max(100).default(20),
      userId: z.coerce.bigint().optional(),
      apiKeyId: z.coerce.bigint().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      status: z.enum(["succeeded", "failed", "rate_limited", "timeout"]).optional(),
      requestedModel: z.string().optional(),
    }).parse(request.query);

    return { data: await logService.listRequestLogs(query) };
  });

  // Admin: global stats
  app.get("/stats", { preHandler: adminAuthHook }, async () => {
    return { data: await logService.getGlobalStats() };
  });

  // Admin: audit logs
  app.get("/audit", { preHandler: adminAuthHook }, async (request) => {
    const query = z.object({
      page: z.coerce.number().min(1).default(1),
      pageSize: z.coerce.number().min(1).max(100).default(20),
      actorId: z.coerce.bigint().optional(),
    }).parse(request.query);

    return { data: await logService.listAuditLogs(query) };
  });
}
