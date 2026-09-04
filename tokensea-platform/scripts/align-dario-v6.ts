// One-shot: align tokensea-platform DB with dario v6 infra.
// - Fix codex node to point at dario-1 (codex-dario retired)
// - Add gpt-5.6-sol/terra/luna + gpt-5.5 aliases + routes to Codex channel
// - Add Claude 5 family aliases to Claude channel
// - Issue root a full-access API key
import { PrismaClient, ChannelType, ChannelStatus, NodeStatus, RouteStatus, ApiKeyStatus, UserRole } from "@prisma/client";
import { generateApiKey } from "../src/lib/crypto.js";

const prisma = new PrismaClient();

async function main() {
  // 1. Fix codex node (id=2): point at dario v6 single container
  await prisma.channelNode.update({
    where: { id: 2n },
    data: {
      name: "dario-1-codex",
      internalUrl: "http://dario-1:3456",
      internalApiKey: "ts-codex-internal-1",
      status: NodeStatus.healthy,
    },
  });
  console.log("✓ codex node → dario-1:3456 + ts-codex-internal-1");

  // Also align dario-1 node's internalApiKey with config.yaml (ts-internal-1)
  await prisma.channelNode.update({
    where: { id: 1n },
    data: { internalApiKey: "ts-internal-1" },
  });
  console.log("✓ claude node dario-1 internalApiKey → ts-internal-1");

  // 2. New model aliases (Claude 5 family + GPT 5.6)
  const newModels = [
    // Claude 5 family (from dario v6 baked list)
    { alias: "claude-fable-5",   displayName: "Claude Fable 5",   provider: "claude", inputPrice: 5,  outputPrice: 25, supportsVision: true, maxContext: 1000000, sortOrder: 0 },
    { alias: "claude-opus-5",    displayName: "Claude Opus 5",    provider: "claude", inputPrice: 15, outputPrice: 75, supportsVision: true, maxContext: 1000000, sortOrder: 1 },
    { alias: "claude-sonnet-5",  displayName: "Claude Sonnet 5",  provider: "claude", inputPrice: 3,  outputPrice: 15, supportsVision: true, maxContext: 200000,  sortOrder: 2 },
    // GPT 5.6 family (from dario v6 baked list, just verified working)
    { alias: "gpt-5.6-sol",      displayName: "GPT-5.6 Sol",      provider: "openai", inputPrice: 5,  outputPrice: 15, supportsVision: true, maxContext: 272000,  sortOrder: 10 },
    { alias: "gpt-5.6-terra",    displayName: "GPT-5.6 Terra",    provider: "openai", inputPrice: 5,  outputPrice: 15, supportsVision: true, maxContext: 272000,  sortOrder: 11 },
    { alias: "gpt-5.6-luna",     displayName: "GPT-5.6 Luna",      provider: "openai", inputPrice: 5,  outputPrice: 15, supportsVision: true, maxContext: 272000,  sortOrder: 12 },
    { alias: "gpt-5.5",          displayName: "GPT-5.5",           provider: "openai", inputPrice: 2,  outputPrice: 8,  supportsVision: true, maxContext: 128000,  sortOrder: 13 },
  ];

  for (const m of newModels) {
    await prisma.modelAlias.upsert({
      where: { alias: m.alias },
      update: { status: RouteStatus.active },
      create: { ...m, status: RouteStatus.active },
    });
  }
  console.log(`✓ upserted ${newModels.length} new model aliases`);

  // 3. Routes: Claude 5 → channel 1 (claude), GPT 5.6/5.5 → channel 2 (codex)
  const claudeChannelId = 1n;
  const codexChannelId = 2n;
  const claudeNew = ["claude-fable-5", "claude-opus-5", "claude-sonnet-5"];
  const codexNew  = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5"];

  for (const alias of claudeNew) {
    const a = await prisma.modelAlias.findUnique({ where: { alias } });
    if (!a) continue;
    const existing = await prisma.modelRoute.findFirst({
      where: { aliasId: a.id, channelId: claudeChannelId },
    });
    if (!existing) {
      await prisma.modelRoute.create({
        data: { aliasId: a.id, channelId: claudeChannelId, upstreamModel: alias, priority: 10, status: RouteStatus.active },
      });
    }
  }
  for (const alias of codexNew) {
    const a = await prisma.modelAlias.findUnique({ where: { alias } });
    if (!a) continue;
    const existing = await prisma.modelRoute.findFirst({
      where: { aliasId: a.id, channelId: codexChannelId },
    });
    if (!existing) {
      await prisma.modelRoute.create({
        data: { aliasId: a.id, channelId: codexChannelId, upstreamModel: alias, priority: 10, status: RouteStatus.active },
      });
    }
  }
  console.log(`✓ created routes for ${claudeNew.length} claude + ${codexNew.length} codex models`);

  // 4. Update channel.models arrays to include new models
  await prisma.channel.update({
    where: { id: 1n },
    data: { models: ["claude-fable-5","claude-opus-5","claude-sonnet-5","claude-sonnet-4-6","claude-opus-4-6","claude-haiku-4-5"] },
  });
  await prisma.channel.update({
    where: { id: 2n },
    data: { models: ["gpt-5.6-sol","gpt-5.6-terra","gpt-5.6-luna","gpt-5.5","gpt-4.1","gpt-4.1-mini","gpt-4.1-nano","o4-mini"] },
  });
  console.log("✓ channel.models arrays updated");

  // 5. Issue root a full-access API key
  const root = await prisma.user.findUnique({ where: { username: "root" } });
  if (!root) throw new Error("root user not found");

  const existingKey = await prisma.apiKey.findFirst({ where: { userId: root.id, name: "root-full-access" } });
  let rawKey: string;
  if (existingKey) {
    // regenerate: create a new one and disable old
    await prisma.apiKey.update({ where: { id: existingKey.id }, data: { status: ApiKeyStatus.disabled } });
  }
  const gen = generateApiKey();
  rawKey = gen.raw;
  await prisma.apiKey.create({
    data: {
      userId: root.id,
      keyPrefix: gen.prefix,
      keyHash: gen.hash,
      keyPlain: rawKey,
      name: "root-full-access",
      status: ApiKeyStatus.active,
      quota: -1n,
      maxCalls: -1n,
      dailyLimit: -1n,
      tokenLimit: -1n,
      models: [], // empty = all models
    },
  });
  console.log(`✓ root API key: ${rawKey}`);
  console.log("  (models: [] = all models allowed)");
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
