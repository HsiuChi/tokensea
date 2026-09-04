import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { KeyGroupService } from "../services/keygroup/keygroup-service.js";
import { adminAuthHook } from "../middleware/user-auth.js";

export async function keyGroupRoutes(app: FastifyInstance) {
  const svc = new KeyGroupService(app.prisma);

  app.get("/", { preHandler: adminAuthHook }, async (request) => {
    const q = z.object({ page: z.coerce.number().min(1).default(1), pageSize: z.coerce.number().min(1).max(100).default(20) }).parse(request.query);
    return { data: await svc.list(q) };
  });

  app.get("/:id", { preHandler: adminAuthHook }, async (request) => {
    const { id } = z.object({ id: z.coerce.bigint() }).parse(request.params);
    return { data: await svc.get(id) };
  });

  app.post("/", { preHandler: adminAuthHook }, async (request) => {
    const body = z.object({
      name: z.string().min(1).max(64),
      userId: z.coerce.bigint(),
      models: z.array(z.string()).optional(),
      quota: z.coerce.bigint().optional(),
      priority: z.number().int().optional(),
    }).parse(request.body);
    return { data: await svc.create(body) };
  });

  app.put("/:id", { preHandler: adminAuthHook }, async (request) => {
    const { id } = z.object({ id: z.coerce.bigint() }).parse(request.params);
    const body = request.body as Record<string, any>;
    return { data: await svc.update(id, body) };
  });

  app.delete("/:id", { preHandler: adminAuthHook }, async (request) => {
    const { id } = z.object({ id: z.coerce.bigint() }).parse(request.params);
    await svc.delete(id);
    return { data: { message: "Key group deleted" } };
  });
}
