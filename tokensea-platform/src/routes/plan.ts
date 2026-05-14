import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PlanService } from "../services/plan/plan-service.js";
import { adminAuthHook } from "../middleware/user-auth.js";

export async function planRoutes(app: FastifyInstance) {
  const planService = new PlanService(app.prisma);

  // Public: list plans
  app.get("/public", async () => {
    const plans = await planService.list({ publicOnly: true });
    return { data: plans };
  });

  // Admin: list all plans
  app.get("/", { preHandler: adminAuthHook }, async () => {
    const plans = await planService.list();
    return { data: plans };
  });

  // Admin: get plan
  app.get("/:id", { preHandler: adminAuthHook }, async (request) => {
    const { id } = z.object({ id: z.coerce.bigint() }).parse(request.params);
    return { data: await planService.get(id) };
  });

  // Admin: create plan
  app.post("/", { preHandler: adminAuthHook }, async (request) => {
    const body = z.object({
      name: z.string().min(1).max(64),
      displayName: z.string().min(1).max(64),
      description: z.string().max(512).optional(),
      tier: z.enum(["free", "starter", "pro", "max"]),
      quotaMode: z.enum(["request_count", "token_count", "mixed"]).optional(),
      requestLimit: z.coerce.bigint().optional(),
      tokenLimit: z.coerce.bigint().optional(),
      billableUnitLimit: z.coerce.bigint().optional(),
      dailyBillableUnitLimit: z.coerce.bigint().optional(),
      qpsLimit: z.number().int().optional(),
      rpmLimit: z.number().int().optional(),
      tpmLimit: z.number().int().optional(),
      maxTokensPerRequest: z.number().int().optional(),
      allowedModelAliases: z.array(z.string()),
      billingCycleType: z.string().optional(),
      billingMultiplier: z.number().optional(),
      price: z.number().int().optional(),
      isPublic: z.boolean().optional(),
      isSubscription: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
    }).parse(request.body);

    return { data: await planService.create(body) };
  });

  // Admin: update plan
  app.put("/:id", { preHandler: adminAuthHook }, async (request) => {
    const { id } = z.object({ id: z.coerce.bigint() }).parse(request.params);
    const body = request.body as Record<string, any>;
    return { data: await planService.update(id, body) };
  });

  // Admin: delete plan
  app.delete("/:id", { preHandler: adminAuthHook }, async (request) => {
    const { id } = z.object({ id: z.coerce.bigint() }).parse(request.params);
    await planService.delete(id);
    return { data: { message: "Plan deleted" } };
  });

  // Admin: bind user to plan
  app.post("/bind", { preHandler: adminAuthHook }, async (request) => {
    const body = z.object({
      userId: z.coerce.bigint(),
      planId: z.coerce.bigint(),
      durationDays: z.number().int().min(1).default(30),
    }).parse(request.body);

    return { data: await planService.bindUserToPlan(body.userId, body.planId, body.durationDays) };
  });
}
