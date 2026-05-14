import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RedemptionService } from "../services/redemption/redemption-service.js";
import { adminAuthHook, userAuthHook } from "../middleware/user-auth.js";

export async function redemptionRoutes(app: FastifyInstance) {
  const redemptionService = new RedemptionService(app.prisma);

  // Admin: list redemptions
  app.get("/", { preHandler: adminAuthHook }, async (request) => {
    const query = z.object({ page: z.coerce.number().min(1).default(1), pageSize: z.coerce.number().min(1).max(100).default(20), status: z.string().optional() }).parse(request.query);
    return { data: await redemptionService.list(query) };
  });

  // Admin: create redemption
  app.post("/", { preHandler: adminAuthHook }, async (request) => {
    const body = z.object({
      name: z.string().min(1).max(64),
      type: z.enum(["quota", "key"]).optional(),
      quota: z.coerce.bigint().optional(),
      count: z.number().int().min(1).default(1),
      keyQuota: z.coerce.bigint().optional(),
      keyModels: z.array(z.string()).optional(),
      keyMaxCalls: z.coerce.bigint().optional(),
      keyName: z.string().optional(),
      keyDailyLimit: z.coerce.bigint().optional(),
      keyTokenLimit: z.coerce.bigint().optional(),
    }).parse(request.body);

    return { data: await redemptionService.create(body, request.userId!) };
  });

  // Admin: batch create
  app.post("/batch", { preHandler: adminAuthHook }, async (request) => {
    const body = z.object({
      name: z.string().min(1).max(64),
      count: z.number().int().min(1).max(100),
      quota: z.coerce.bigint(),
      batchCount: z.number().int().min(1).max(100).default(10),
    }).parse(request.body);

    return { data: await redemptionService.batchCreate(body, request.userId!, body.batchCount) };
  });

  // Admin: delete
  app.delete("/:id", { preHandler: adminAuthHook }, async (request) => {
    const { id } = z.object({ id: z.coerce.bigint() }).parse(request.params);
    await redemptionService.delete(id);
    return { data: { message: "Redemption code deleted" } };
  });

  // User: redeem code
  app.post("/redeem", { preHandler: userAuthHook }, async (request) => {
    const body = z.object({ code: z.string().min(1) }).parse(request.body);
    return { data: await redemptionService.redeem(request.userId!, body.code) };
  });
}
