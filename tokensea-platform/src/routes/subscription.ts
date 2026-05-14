import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { SubscriptionService } from "../services/subscription/subscription-service.js";
import { userAuthHook, adminAuthHook } from "../middleware/user-auth.js";

export async function subscriptionRoutes(app: FastifyInstance) {
  const subService = new SubscriptionService(app.prisma);

  // Subscribe to a plan
  app.post("/subscribe", { preHandler: userAuthHook }, async (request) => {
    const body = z.object({
      planId: z.coerce.bigint(),
      paymentMethod: z.enum(["balance", "stripe", "alipay", "wechat"]).default("balance"),
      durationDays: z.number().int().min(1).max(365).default(30),
    }).parse(request.body);

    const result = await subService.subscribe(request.userId!, body.planId, body.paymentMethod, body.durationDays);
    return { data: result };
  });

  // Renew a subscription
  app.post("/renew", { preHandler: userAuthHook }, async (request) => {
    const body = z.object({
      bindingId: z.coerce.bigint(),
      paymentMethod: z.enum(["balance", "stripe", "alipay", "wechat"]).default("balance"),
    }).parse(request.body);

    const result = await subService.renew(request.userId!, body.bindingId, body.paymentMethod);
    return { data: result };
  });

  // Cancel a subscription
  app.post("/cancel", { preHandler: userAuthHook }, async (request) => {
    const body = z.object({ bindingId: z.coerce.bigint() }).parse(request.body);
    const binding = await subService.cancel(request.userId!, body.bindingId);
    return { data: binding };
  });

  // List own subscriptions
  app.get("/list", { preHandler: userAuthHook }, async (request) => {
    const bindings = await subService.listSubscriptions(request.userId!);
    return { data: bindings };
  });

  // List subscription orders
  app.get("/orders", { preHandler: userAuthHook }, async (request) => {
    const query = z.object({
      page: z.coerce.number().min(1).default(1),
      pageSize: z.coerce.number().min(1).max(100).default(20),
    }).parse(request.query);

    return { data: await subService.listOrders(request.userId!, query.page, query.pageSize) };
  });

  // Cron: expire subscriptions (admin or internal)
  app.post("/expire", { preHandler: adminAuthHook }, async () => {
    const result = await subService.expireSubscriptions();
    return { data: result };
  });
}
