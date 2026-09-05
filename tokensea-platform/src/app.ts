import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { envSchema, type Env } from "./config/env.js";
import { ZodError } from "zod";
import { AppError } from "./lib/errors.js";
import { registerRoutes } from "./routes/index.js";

declare module "fastify" {
  interface FastifyInstance {
    env: Env;
    prisma: PrismaClient;
    redis: Redis;
  }
  interface FastifyRequest {
    userId?: bigint;
    userRole?: string;
  }
}

export async function buildApp() {
  const env = envSchema.parse(process.env) as Env;

  const prisma = new PrismaClient({
    datasources: { db: { url: env.DATABASE_URL } },
  });

  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });

  const app = Fastify({
    trustProxy: process.env.TRUSTED_PROXY_CIDRS?.split(",").filter(Boolean) ?? false,
    logger: {
      level: env.NODE_ENV === "production" ? "info" : "debug",
    },
  });

  // Decorate
  app.decorate("env", env);
  app.decorate("prisma", prisma);
  app.decorate("redis", redis);

  // BigInt JSON serialization
  (BigInt.prototype as any).toJSON = function () {
    return this.toString();
  };

  // CORS
  await app.register(cors, { origin: true, credentials: true });

  // Multipart (for image edits)
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });

  // Error handler
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      const response: Record<string, unknown> = {
        error: { code: error.code, message: error.message },
      };
      const headers: Record<string, string> = {};
      if ("retryAfter" in error && typeof error.retryAfter === "number") {
        headers["retry-after"] = String(error.retryAfter);
      }
      reply.headers(headers).code(error.statusCode).send(response);
      return;
    }

    if (error instanceof ZodError) {
      reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ") } });
      return;
    }
    if ((error as any).validation) {
      reply.code(400).send({
        error: { code: "VALIDATION_ERROR", message: (error as Error).message },
      });
      return;
    }

    app.log.error(error);
    reply.code(500).send({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  });

  // Routes
  await registerRoutes(app);

  // Serve frontend SPA in production
  if (env.NODE_ENV === "production") {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const webDist = path.join(__dirname, "..", "web", "dist");
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: "/",
      wildcard: true,
      decorateReply: false,
    });
    app.setNotFoundHandler((request, reply) => {
      if (!request.url.startsWith("/api/") && !request.url.startsWith("/v1/")) {
        const html = fs.readFileSync(path.join(webDist, "index.html"), "utf-8");
        reply.type("text/html").send(html);
      } else {
        reply.code(404).send({ error: { code: "NOT_FOUND", message: "Not found" } });
      }
    });
  }

  // Graceful shutdown
  const close = async () => {
    app.log.info("Shutting down...");
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
  };

  process.on("SIGINT", close);
  process.on("SIGTERM", close);

  return { app, env, prisma, redis };
}
