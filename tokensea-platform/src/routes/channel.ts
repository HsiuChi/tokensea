import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ChannelService } from "../services/channel/channel-service.js";
import { adminAuthHook } from "../middleware/user-auth.js";
import { KSYUN_MODELS } from "../config/ksyun-model-catalog.js";

export async function channelRoutes(app: FastifyInstance) {
  const channelService = new ChannelService(app.prisma);

  app.get("/", { preHandler: adminAuthHook }, async (request) => {
    const query = z.object({ page: z.coerce.number().min(1).default(1), pageSize: z.coerce.number().min(1).max(100).default(20) }).parse(request.query);
    return { data: await channelService.list(query) };
  });

  app.get("/ksyun/catalog", { preHandler: adminAuthHook }, async () => {
    return { data: KSYUN_MODELS };
  });

  app.post("/ksyun/bootstrap", { preHandler: adminAuthHook }, async (request) => {
    const body = z.object({
      apiKeys: z.array(z.string().min(8)).min(1).max(500),
      modelIds: z.array(z.string()).optional(),
      channelName: z.string().min(1).max(64).optional(),
      maxConcurrent: z.number().int().min(1).max(1000).optional(),
    }).parse(request.body);
    return { data: await channelService.bootstrapKsyun(body) };
  });

  app.get("/:id", { preHandler: adminAuthHook }, async (request) => {
    const { id } = z.object({ id: z.coerce.bigint() }).parse(request.params);
    return { data: await channelService.get(id) };
  });

  app.post("/", { preHandler: adminAuthHook }, async (request) => {
    const body = z.object({
      name: z.string().min(1).max(64),
      type: z.enum(["claude", "codex", "openai", "anthropic", "gemini", "deepseek", "custom"]),
      models: z.array(z.string()),
      priority: z.number().int().optional(),
      weight: z.number().int().optional(),
    }).parse(request.body);
    return { data: await channelService.create(body) };
  });

  app.put("/:id", { preHandler: adminAuthHook }, async (request) => {
    const { id } = z.object({ id: z.coerce.bigint() }).parse(request.params);
    const body = request.body as Record<string, any>;
    return { data: await channelService.update(id, body) };
  });

  app.delete("/:id", { preHandler: adminAuthHook }, async (request) => {
    const { id } = z.object({ id: z.coerce.bigint() }).parse(request.params);
    await channelService.delete(id);
    return { data: { message: "Channel deleted" } };
  });

  // Node operations
  app.post("/:id/nodes", { preHandler: adminAuthHook }, async (request) => {
    const { id } = z.object({ id: z.coerce.bigint() }).parse(request.params);
    const body = z.object({
      name: z.string().min(1).max(64),
      internalUrl: z.string().min(1),
      internalApiKey: z.string().min(1),
      maxConcurrent: z.number().int().optional(),
      adapter: z.enum(["dario", "openai-compatible", "ksyun"]).optional(),
      authType: z.enum(["x-api-key", "bearer", "both"]).optional(),
      probePath: z.string().max(64).optional(),
      probeTimeoutMs: z.number().int().min(1000).max(60000).optional(),
    }).parse(request.body);
    return { data: await channelService.addNode(id, body) };
  });

  app.put("/nodes/:nodeId", { preHandler: adminAuthHook }, async (request) => {
    const { nodeId } = z.object({ nodeId: z.coerce.bigint() }).parse(request.params);
    const body = request.body as Record<string, any>;
    return { data: await channelService.updateNode(nodeId, body) };
  });

  app.delete("/nodes/:nodeId", { preHandler: adminAuthHook }, async (request) => {
    const { nodeId } = z.object({ nodeId: z.coerce.bigint() }).parse(request.params);
    await channelService.deleteNode(nodeId);
    return { data: { message: "Node deleted" } };
  });

  // OAuth / account-pool status from the dario node (proxied /status + /accounts)
  app.get("/nodes/:nodeId/oauth", { preHandler: adminAuthHook }, async (request) => {
    const { nodeId } = z.object({ nodeId: z.coerce.bigint() }).parse(request.params);
    return { data: await channelService.getOAuthStatus(nodeId) };
  });

  // Health check
  app.post("/nodes/:nodeId/health", { preHandler: adminAuthHook }, async (request) => {
    const { nodeId } = z.object({ nodeId: z.coerce.bigint() }).parse(request.params);
    return { data: await channelService.healthCheck(nodeId) };
  });

  // One-click channel test (picks a healthy node, sends a tiny probe)
  app.post("/:id/test", { preHandler: adminAuthHook }, async (request) => {
    const { id } = z.object({ id: z.coerce.bigint() }).parse(request.params);
    const body = z.object({ model: z.string().optional() }).parse(request.body ?? {});
    return { data: await channelService.testChannel(id, body.model) };
  });

  // Node-level test (force use this node regardless of status)
  app.post("/:id/nodes/:nodeId/test", { preHandler: adminAuthHook }, async (request) => {
    const { id, nodeId } = z.object({ id: z.coerce.bigint(), nodeId: z.coerce.bigint() }).parse(request.params);
    const body = z.object({ model: z.string().optional() }).parse(request.body ?? {});
    return { data: await channelService.testNode(id, nodeId, body.model) };
  });
}
