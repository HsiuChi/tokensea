import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { WebhookService, WEBHOOK_EVENTS } from "../services/notify/webhook-service.js";
import { adminAuthHook } from "../middleware/user-auth.js";

export async function webhookRoutes(app: FastifyInstance) {
  const svc = new WebhookService(app.prisma);

  app.get("/events", { preHandler: adminAuthHook }, async () => {
    return { data: WEBHOOK_EVENTS };
  });

  app.get("/", { preHandler: adminAuthHook }, async () => {
    return { data: await svc.list() };
  });

  app.post("/", { preHandler: adminAuthHook }, async (request) => {
    const body = z.object({
      url: z.string().url().max(512),
      events: z.array(z.string()).min(1),
      secret: z.string().max(128).optional(),
    }).parse(request.body);
    return { data: await svc.create(body) };
  });

  app.put("/:id", { preHandler: adminAuthHook }, async (request) => {
    const { id } = z.object({ id: z.coerce.bigint() }).parse(request.params);
    const body = z.object({ url: z.string().url().max(512).optional(), events: z.array(z.string()).min(1).optional(), secret: z.string().max(128).optional(), status: z.enum(["active","disabled"]).optional() }).parse(request.body);
    return { data: await svc.update(id, body) };
  });

  app.delete("/:id", { preHandler: adminAuthHook }, async (request) => {
    const { id } = z.object({ id: z.coerce.bigint() }).parse(request.params);
    await svc.delete(id);
    return { data: { message: "Webhook deleted" } };
  });

  app.post("/:id/test", { preHandler: adminAuthHook }, async (request) => {
    const { id } = z.object({ id: z.coerce.bigint() }).parse(request.params);
    return { data: await svc.test(id) };
  });
}
