import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { TopupService } from "../services/topup/topup-service.js";
import { userAuthHook } from "../middleware/user-auth.js";

export async function topupRoutes(app: FastifyInstance) {
  const topupService = new TopupService(app.prisma, app.env);

  // Create top-up order
  app.post("/order", { preHandler: userAuthHook }, async (request) => {
    const body = z.object({
      paymentMethod: z.enum(["stripe", "alipay", "wechat", "paypal"]),
      amount: z.number().positive(),
    }).parse(request.body);

    return { data: await topupService.createOrder(request.userId!, body.paymentMethod, body.amount) };
  });

  // Stripe webhook (no auth - called by Stripe)
  app.post("/stripe/webhook", async (request, reply) => {
    const sig = request.headers["stripe-signature"] as string;
    if (!sig) return reply.code(400).send({ error: "Missing stripe-signature" });

    const payload = JSON.stringify(request.body);
    return { data: await topupService.handleStripeWebhook(payload, sig) };
  });

  // List own orders
  app.get("/orders", { preHandler: userAuthHook }, async (request) => {
    const query = z.object({
      page: z.coerce.number().min(1).default(1),
      pageSize: z.coerce.number().min(1).max(100).default(20),
    }).parse(request.query);

    return { data: await topupService.listOrders(request.userId!, query.page, query.pageSize) };
  });

  // Get specific order
  app.get("/orders/:id", { preHandler: userAuthHook }, async (request) => {
    const { id } = z.object({ id: z.coerce.bigint() }).parse(request.params);
    return { data: await topupService.getOrder(request.userId!, id) };
  });
}
