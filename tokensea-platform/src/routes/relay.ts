import type { FastifyInstance } from "fastify";
import { RelayService } from "../services/relay/relay-service.js";

export async function relayRoutes(app: FastifyInstance) {
  const relayService = new RelayService(app.prisma, app.redis);

  // Start periodic node health polling (every 10s)
  const healthInterval = relayService.startHealthPolling(10_000);
  app.addHook('onClose', () => clearInterval(healthInterval));

  // Anthropic Messages API
  app.post("/v1/messages", async (request, reply) => {
    await relayService.handleRequest(request, reply);
  });

  // OpenAI Chat Completions API
  app.post("/v1/chat/completions", async (request, reply) => {
    await relayService.handleRequest(request, reply);
  });

  // OpenAI Responses API (used by Codex CLI, etc.)
  app.post("/v1/responses", async (request, reply) => {
    await relayService.handleRequest(request, reply);
  });

  // OpenAI Images Generations API
  app.post("/v1/images/generations", async (request, reply) => {
    await relayService.handleImageGeneration(request, reply);
  });

  // OpenAI Images Edits API (image-to-image)
  app.post("/v1/images/edits", async (request, reply) => {
    await relayService.handleImageEdit(request, reply);
  });

  // Provider-compatible async video APIs through the TokenSea key pool.
  // Example: /v1/video/seedance-2.5/v3/contents/generations/tasks
  app.route({
    method: ["GET", "POST"],
    url: "/v1/video/:model/*",
    handler: async (request, reply) => {
      await relayService.handleMediaRequest(request, reply);
    },
  });

  // Models list
  app.get("/v1/models", async (request, reply) => {
    // Public endpoint - returns available models
    const models = await app.prisma.modelAlias.findMany({
      where: { status: "active" },
      select: {
        alias: true,
        displayName: true,
        provider: true,
        description: true,
        category: true,
        tags: true,
        iconUrl: true,
        supportsStream: true,
        supportsTools: true,
        supportsVision: true,
        maxContext: true,
        inputPrice: true,
        outputPrice: true,
      },
      orderBy: [{ sortOrder: "desc" }, { displayName: "asc" }],
    });

    const data = models.map((m) => ({
      id: m.alias,
      object: "model",
      created: Math.floor(Date.now() / 1000),
      owned_by: m.provider,
      display_name: m.displayName,
      description: m.description,
      category: m.category,
      tags: m.tags,
      icon_url: m.iconUrl,
      capabilities: {
        stream: m.supportsStream,
        tools: m.supportsTools,
        vision: m.supportsVision,
      },
      max_context: m.maxContext,
      pricing: {
        currency: 'USD',
        input_per_1m: m.inputPrice,
        output_per_1m: m.outputPrice,
        input_per_1k: m.inputPrice / 1000,
        output_per_1k: m.outputPrice / 1000,
      },
    }));

    reply.send({ object: "list", data });
  });
}
