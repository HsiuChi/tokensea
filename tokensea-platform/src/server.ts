import { buildApp } from "./app.js";
import { startHealthProbeWorker } from "./services/channel/health-probe-worker.js";

async function main() {
  const { app, env, prisma, redis } = await buildApp();

  // Start the channel-node health probe worker (decoupled from request path).
  const probeWorker = startHealthProbeWorker(prisma, redis);
  app.log.info("health-probe worker started");

  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    app.log.info(`TokenSea platform running on http://0.0.0.0:${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  const shutdown = async () => {
    app.log.info("shutting down...");
    probeWorker.stop();
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
