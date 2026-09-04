import { PrismaClient, UserRole, UserStatus, PlanTier, QuotaMode, ChannelType, ChannelStatus, NodeStatus, RouteStatus } from "@prisma/client";
import { hashPassword } from "../src/lib/password.js";
import { generateInviteCode } from "../src/lib/crypto.js";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // 1. Create root user
  const rootPasswordHash = await hashPassword("tokensea2026");
  const root = await prisma.user.upsert({
    where: { username: "root" },
    update: {},
    create: {
      username: "root",
      passwordHash: rootPasswordHash,
      email: "root@tokensea.dev",
      emailVerified: true,
      name: "Root Admin",
      role: UserRole.root,
      status: UserStatus.active,
      quota: 999999999999n,
      usedQuota: 0n,
      inviteCode: generateInviteCode(),
    },
  });
  console.log(`Root user: ${root.username} (id: ${root.id})`);

  // 2. Create default plans
  const freePlan = await prisma.plan.upsert({
    where: { name: "free" },
    update: {},
    create: {
      name: "free",
      displayName: "Free",
      description: "Try TokenSea with limited access",
      tier: PlanTier.free,
      quotaMode: QuotaMode.mixed,
      requestLimit: 1000n,
      tokenLimit: 500000n,
      billableUnitLimit: 5000n,
      dailyBillableUnitLimit: 1000n,
      qpsLimit: 2,
      rpmLimit: 20,
      tpmLimit: 40000,
      maxTokensPerRequest: 64000,
      allowedModelAliases: ["claude-sonnet-4-6", "claude-haiku-4-5"],
      billingCycleType: "monthly",
      billingMultiplier: 1.0,
      price: 0,
      isPublic: true,
      isSubscription: false,
      sortOrder: 0,
    },
  });

  const starterPlan = await prisma.plan.upsert({
    where: { name: "starter" },
    update: {},
    create: {
      name: "starter",
      displayName: "Starter",
      description: "For individual developers",
      tier: PlanTier.starter,
      quotaMode: QuotaMode.mixed,
      requestLimit: 10000n,
      tokenLimit: 2000000n,
      billableUnitLimit: 50000n,
      dailyBillableUnitLimit: 10000n,
      qpsLimit: 5,
      rpmLimit: 60,
      tpmLimit: 100000,
      maxTokensPerRequest: 128000,
      allowedModelAliases: ["claude-sonnet-4-6", "claude-haiku-4-5"],
      billingCycleType: "monthly",
      billingMultiplier: 1.0,
      price: 4900,
      isPublic: true,
      isSubscription: true,
      sortOrder: 1,
    },
  });

  const proPlan = await prisma.plan.upsert({
    where: { name: "pro" },
    update: {},
    create: {
      name: "pro",
      displayName: "Pro",
      description: "For professional developers and small teams",
      tier: PlanTier.pro,
      quotaMode: QuotaMode.mixed,
      requestLimit: -1n,
      tokenLimit: 10000000n,
      billableUnitLimit: -1n,
      dailyBillableUnitLimit: 50000n,
      qpsLimit: 10,
      rpmLimit: 120,
      tpmLimit: 200000,
      maxTokensPerRequest: 200000,
      allowedModelAliases: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5"],
      billingCycleType: "monthly",
      billingMultiplier: 1.0,
      price: 19900,
      isPublic: true,
      isSubscription: true,
      sortOrder: 2,
    },
  });

  const maxPlan = await prisma.plan.upsert({
    where: { name: "max" },
    update: {},
    create: {
      name: "max",
      displayName: "Max",
      description: "For power users and teams with unlimited needs",
      tier: PlanTier.max,
      quotaMode: QuotaMode.mixed,
      requestLimit: -1n,
      tokenLimit: -1n,
      billableUnitLimit: -1n,
      dailyBillableUnitLimit: -1n,
      qpsLimit: 20,
      rpmLimit: 300,
      tpmLimit: 500000,
      maxTokensPerRequest: 200000,
      allowedModelAliases: [],  // Empty = all models
      billingCycleType: "monthly",
      billingMultiplier: 1.0,
      price: 49900,
      isPublic: true,
      isSubscription: true,
      sortOrder: 3,
    },
  });

  console.log("Plans created: free, starter, pro, max");

  // 3. Create default model aliases
  const models = [
    { alias: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6", provider: "claude", inputPrice: 3, outputPrice: 15, supportsTools: true, supportsVision: true, maxContext: 200000 },
    { alias: "claude-opus-4-6", displayName: "Claude Opus 4.6", provider: "claude", inputPrice: 15, outputPrice: 75, supportsTools: true, supportsVision: true, maxContext: 200000 },
    { alias: "claude-haiku-4-5", displayName: "Claude Haiku 4.5", provider: "claude", inputPrice: 1, outputPrice: 5, supportsTools: true, supportsVision: true, maxContext: 200000 },
  ];

  for (const m of models) {
    await prisma.modelAlias.upsert({
      where: { alias: m.alias },
      update: {},
      create: m,
    });
  }
  console.log(`Model aliases created: ${models.length}`);

  // 4. Create default Claude channel + node (for local dev)
  const claudeChannel = await prisma.channel.upsert({
    where: { id: 1n },
    update: {},
    create: {
      name: "Claude Max Pool",
      type: ChannelType.claude,
      status: ChannelStatus.active,
      models: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5"],
      priority: 10,
      weight: 1,
    },
  });

  const codexChannel = await prisma.channel.upsert({
    where: { id: 2n },
    update: {},
    create: {
      name: "OpenAI Codex Pool",
      type: ChannelType.codex,
      status: ChannelStatus.active,
      models: [],
      priority: 10,
      weight: 1,
    },
  });

  // Create demo nodes (will be replaced with real dario nodes)
  await prisma.channelNode.upsert({
    where: { id: 1n },
    update: {},
    create: {
      channelId: claudeChannel.id,
      name: "dario-1",
      internalUrl: "http://dario-1:3456",
      internalApiKey: "dario-internal-key-1",
      status: NodeStatus.healthy,
      maxConcurrent: 5,
    },
  });

  await prisma.channelNode.upsert({
    where: { id: 2n },
    update: {},
    create: {
      channelId: codexChannel.id,
      name: "codex-dario-1",
      internalUrl: "http://codex-dario-1:3457",
      internalApiKey: "codex-internal-key-1",
      status: NodeStatus.healthy,
      maxConcurrent: 5,
    },
  });
  console.log("Channels and nodes created");

  // 5. Create model routes
  const claudeModels = ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5"];
  const codexModels: string[] = [];

  for (const alias of claudeModels) {
    await prisma.modelRoute.upsert({
      where: { id: 0 },
      update: {},
      create: {
        alias: { connect: { alias } },
        channel: { connect: { id: claudeChannel.id } },
        upstreamModel: alias,
        priority: 10,
        status: RouteStatus.active,
      },
    });
  }

  for (const alias of codexModels) {
    await prisma.modelRoute.upsert({
      where: { id: 0 },
      update: {},
      create: {
        alias: { connect: { alias } },
        channel: { connect: { id: codexChannel.id } },
        upstreamModel: alias,
        priority: 10,
        status: RouteStatus.active,
      },
    });
  }
  console.log("Model routes created");

  // 6. Bind root to max plan
  await prisma.userPlanBinding.upsert({
    where: { id: 1n },
    update: {},
    create: {
      userId: root.id,
      planId: maxPlan.id,
      startAt: new Date(),
      endAt: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      status: "active",
    },
  });
  console.log("Root bound to Max plan");

  console.log("Seed complete!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
