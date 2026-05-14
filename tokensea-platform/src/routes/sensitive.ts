import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { SensitiveWordService } from "../services/sensitive/sensitive-service.js";
import { adminAuthHook } from "../middleware/user-auth.js";

export async function sensitiveRoutes(app: FastifyInstance) {
  const service = new SensitiveWordService(app.prisma, app.redis);

  // Admin: list sensitive words
  app.get("/", { preHandler: adminAuthHook }, async (request) => {
    const query = z.object({
      category: z.string().optional(),
      enabled: z.enum(["true", "false"]).transform(v => v === "true").optional(),
    }).parse(request.query);

    return { data: await service.list(query) };
  });

  // Admin: create sensitive word
  app.post("/", { preHandler: adminAuthHook }, async (request) => {
    const body = z.object({
      word: z.string().min(1).max(128),
      category: z.string().max(32).optional(),
      action: z.enum(["block", "replace"]).optional(),
    }).parse(request.body);

    const result = await service.create({
      ...body,
      createdBy: request.userId,
    });
    return { data: result };
  });

  // Admin: batch create sensitive words
  app.post("/batch", { preHandler: adminAuthHook }, async (request) => {
    const body = z.object({
      words: z.array(z.string().min(1).max(128)).min(1).max(500),
      category: z.string().max(32).optional(),
      action: z.enum(["block", "replace"]).optional(),
    }).parse(request.body);

    const result = await service.batchCreate(
      body.words, body.category, body.action, request.userId,
    );
    return { data: result };
  });

  // Admin: update sensitive word
  app.put("/:id", { preHandler: adminAuthHook }, async (request) => {
    const { id } = z.object({ id: z.coerce.bigint() }).parse(request.params);
    const body = z.object({
      word: z.string().min(1).max(128).optional(),
      category: z.string().max(32).optional(),
      action: z.enum(["block", "replace"]).optional(),
      enabled: z.boolean().optional(),
    }).parse(request.body);

    return { data: await service.update(id, body) };
  });

  // Admin: delete sensitive word
  app.delete("/:id", { preHandler: adminAuthHook }, async (request) => {
    const { id } = z.object({ id: z.coerce.bigint() }).parse(request.params);
    await service.delete(id);
    return { data: { message: "Deleted" } };
  });
}
