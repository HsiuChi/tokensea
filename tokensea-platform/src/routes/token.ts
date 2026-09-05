import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { validIpRule } from "../lib/ip-policy.js";
import { TokenService } from "../services/token/token-service.js";
import { userAuthHook } from "../middleware/user-auth.js";

export async function tokenRoutes(app: FastifyInstance) {
  const tokenService = new TokenService(app.prisma);

  app.get("/", { preHandler: userAuthHook }, async (request) => {
    const query = z.object({
      page: z.coerce.number().min(1).default(1),
      pageSize: z.coerce.number().min(1).max(100).default(20),
    }).parse(request.query);

    const result = await tokenService.list(request.userId!, query);
    return { data: result };
  });

  app.post("/", { preHandler: userAuthHook }, async (request, reply) => {
    const body = z.object({
      name: z.string().min(1).max(64),
      quota: z.coerce.bigint().min(-1n).optional(),
      maxCalls: z.coerce.bigint().min(-1n).optional(),
      models: z.array(z.string().min(1).max(64)).max(500).optional(),
      expiresAt: z.string().datetime().optional(),
      dailyLimit: z.coerce.bigint().min(-1n).optional(),
      tokenLimit: z.coerce.bigint().min(-1n).optional(),
      allowedIps: z.array(z.string().refine(validIpRule, "Invalid IP or CIDR")).max(100).optional(),
    }).parse(request.body);

    const { apiKey, rawKey } = await tokenService.create(request.userId!, {
      ...body,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
    });

    reply.code(201).send({
      data: {
        apiKey,
        key: rawKey,  // Only returned once at creation
      },
    });
  });

  app.put("/:id", { preHandler: userAuthHook }, async (request) => {
    const params = z.object({ id: z.coerce.bigint() }).parse(request.params);
    const body = z.object({
      name: z.string().min(1).max(64).optional(),
      status: z.enum(["active", "disabled"]).optional(),
      quota: z.coerce.bigint().min(-1n).optional(),
      maxCalls: z.coerce.bigint().min(-1n).optional(),
      models: z.array(z.string().min(1).max(64)).max(500).optional(),
      expiresAt: z.string().datetime().nullable().optional(),
      dailyLimit: z.coerce.bigint().min(-1n).optional(),
      tokenLimit: z.coerce.bigint().min(-1n).optional(),
      allowedIps: z.array(z.string().refine(validIpRule, "Invalid IP or CIDR")).max(100).nullable().optional(),
    }).parse(request.body);

    const apiKey = await tokenService.update(request.userId!, params.id, {
      ...body,
      expiresAt: body.expiresAt === null ? null : body.expiresAt ? new Date(body.expiresAt) : undefined,
    });

    return { data: apiKey };
  });

  app.delete("/:id", { preHandler: userAuthHook }, async (request) => {
    const params = z.object({ id: z.coerce.bigint() }).parse(request.params);
    await tokenService.delete(request.userId!, params.id);
    return { data: { message: "API key deleted" } };
  });
}
