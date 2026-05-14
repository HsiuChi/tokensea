import type { PrismaClient, Plan, UserPlanBinding } from "@prisma/client";
import { notFound, forbidden } from "../../lib/errors.js";

export interface ActivePlan {
  id: bigint;
  name: string;
  quotaMode: string;
  requestLimit: bigint;
  tokenLimit: bigint;
  billableUnitLimit: bigint;
  dailyBillableUnitLimit: bigint;
  qpsLimit: number;
  rpmLimit: number;
  tpmLimit: number;
  maxTokensPerRequest: number;
  allowedModelAliases: string[];
  billingCycleType: string;
  billingMultiplier: number;
}

export class PlanService {
  constructor(private prisma: PrismaClient) {}

  async list(opts?: { publicOnly?: boolean }) {
    return this.prisma.plan.findMany({
      where: opts?.publicOnly ? { isPublic: true } : undefined,
      orderBy: { sortOrder: "asc" },
    });
  }

  async get(id: bigint) {
    const plan = await this.prisma.plan.findUnique({ where: { id } });
    if (!plan) throw notFound("Plan not found");
    return plan;
  }

  async create(data: {
    name: string; displayName: string; description?: string; tier: string;
    quotaMode?: string; requestLimit?: bigint; tokenLimit?: bigint;
    billableUnitLimit?: bigint; dailyBillableUnitLimit?: bigint;
    qpsLimit?: number; rpmLimit?: number; tpmLimit?: number;
    maxTokensPerRequest?: number; allowedModelAliases: string[];
    billingCycleType?: string; billingMultiplier?: number; price?: number;
    isPublic?: boolean; isSubscription?: boolean; sortOrder?: number;
  }) {
    return this.prisma.plan.create({ data: {
      name: data.name,
      displayName: data.displayName,
      description: data.description,
      tier: data.tier as any,
      quotaMode: (data.quotaMode ?? "mixed") as any,
      requestLimit: data.requestLimit ?? -1n,
      tokenLimit: data.tokenLimit ?? -1n,
      billableUnitLimit: data.billableUnitLimit ?? -1n,
      dailyBillableUnitLimit: data.dailyBillableUnitLimit ?? -1n,
      qpsLimit: data.qpsLimit ?? 5,
      rpmLimit: data.rpmLimit ?? 60,
      tpmLimit: data.tpmLimit ?? 100000,
      maxTokensPerRequest: data.maxTokensPerRequest ?? 128000,
      allowedModelAliases: data.allowedModelAliases,
      billingCycleType: data.billingCycleType ?? "monthly",
      billingMultiplier: data.billingMultiplier ?? 1.0,
      price: data.price ?? 0,
      isPublic: data.isPublic ?? true,
      isSubscription: data.isSubscription ?? true,
      sortOrder: data.sortOrder ?? 0,
    }});
  }

  async update(id: bigint, data: Record<string, any>) {
    const plan = await this.prisma.plan.findUnique({ where: { id } });
    if (!plan) throw notFound("Plan not found");
    return this.prisma.plan.update({ where: { id }, data });
  }

  async delete(id: bigint) {
    const bindings = await this.prisma.userPlanBinding.count({ where: { planId: id, status: "active" } });
    if (bindings > 0) throw forbidden("Cannot delete plan with active bindings");
    await this.prisma.plan.delete({ where: { id } });
  }

  async loadActivePlanForUser(userId: bigint): Promise<ActivePlan> {
    const now = new Date();
    const binding = await this.prisma.userPlanBinding.findFirst({
      where: { userId, status: "active", startAt: { lte: now }, endAt: { gt: now } },
      include: { plan: true },
      orderBy: { startAt: "desc" },
    });
    if (!binding) throw forbidden("No active plan subscription");
    return this.planToActivePlan(binding.plan);
  }

  async bindUserToPlan(userId: bigint, planId: bigint, durationDays = 30) {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) throw notFound("Plan not found");
    const now = new Date();
    return this.prisma.userPlanBinding.create({
      data: {
        userId, planId,
        startAt: now,
        endAt: new Date(now.getTime() + durationDays * 86400000),
        status: "active",
      },
    });
  }

  private planToActivePlan(plan: Plan): ActivePlan {
    return {
      id: plan.id,
      name: plan.name,
      quotaMode: plan.quotaMode,
      requestLimit: plan.requestLimit,
      tokenLimit: plan.tokenLimit,
      billableUnitLimit: plan.billableUnitLimit,
      dailyBillableUnitLimit: plan.dailyBillableUnitLimit,
      qpsLimit: plan.qpsLimit,
      rpmLimit: plan.rpmLimit,
      tpmLimit: plan.tpmLimit,
      maxTokensPerRequest: plan.maxTokensPerRequest,
      allowedModelAliases: plan.allowedModelAliases as string[],
      billingCycleType: plan.billingCycleType,
      billingMultiplier: plan.billingMultiplier,
    };
  }
}
