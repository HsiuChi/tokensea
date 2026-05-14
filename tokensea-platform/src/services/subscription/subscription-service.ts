import type { PrismaClient } from "@prisma/client";
import { randomBytes } from "crypto";
import { notFound, badRequest, forbidden } from "../../lib/errors.js";
import { PlanService } from "../plan/plan-service.js";

export class SubscriptionService {
  private planService: PlanService;

  constructor(private prisma: PrismaClient) {
    this.planService = new PlanService(prisma);
  }

  /** Subscribe to a plan — creates order, binding, and grants quota */
  async subscribe(userId: bigint, planId: bigint, paymentMethod = "balance", durationDays = 30) {
    const plan = await this.planService.get(planId);
    if (!plan.isSubscription) throw badRequest("This plan does not support subscription");

    // Check if user already has an active binding for this plan
    const existing = await this.prisma.userPlanBinding.findFirst({
      where: { userId, planId, status: "active", endAt: { gt: new Date() } },
    });
    if (existing) throw badRequest("Already subscribed to this plan");

    const price = plan.price;
    const quota = plan.billableUnitLimit;
    const tradeNo = `SUB${Date.now()}${randomBytes(4).toString("hex").toUpperCase()}`;

    // For balance payment, check sufficient funds
    if (paymentMethod === "balance") {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw notFound("User not found");
      const available = user.quota - user.usedQuota;
      if (price > 0 && available < BigInt(price)) {
        throw badRequest("Insufficient balance for subscription");
      }
    }

    const now = new Date();
    const endAt = new Date(now.getTime() + durationDays * 86400000);

    const result = await this.prisma.$transaction(async (tx) => {
      // Create binding
      const binding = await tx.userPlanBinding.create({
        data: {
          userId, planId,
          startAt: now, endAt,
          status: "active",
          autoRenew: paymentMethod === "balance",
          quotaGranted: quota,
          quotaUsed: 0n,
        },
      });

      // Create subscription order
      const order = await tx.subscriptionOrder.create({
        data: {
          userId, planId, bindingId: binding.id,
          tradeNo, paymentMethod,
          amount: quota, money: price,
          durationDays, status: "success",
        },
      });

      // Deduct from balance if payment is balance
      if (paymentMethod === "balance" && price > 0) {
        await tx.user.update({
          where: { id: userId },
          data: { usedQuota: { increment: BigInt(price) } },
        });
      }

      // Grant plan quota to user
      if (quota > 0n) {
        await tx.user.update({
          where: { id: userId },
          data: { quota: { increment: quota } },
        });
      }

      return { binding, order };
    });

    return result;
  }

  /** Renew an existing subscription */
  async renew(userId: bigint, bindingId: bigint, paymentMethod = "balance") {
    const binding = await this.prisma.userPlanBinding.findUnique({
      where: { id: bindingId },
      include: { plan: true },
    });
    if (!binding) throw notFound("Subscription not found");
    if (binding.userId !== userId) throw forbidden("Not your subscription");
    if (binding.status !== "active") throw badRequest("Subscription is not active");

    const plan = binding.plan;
    const price = plan.price;
    const quota = plan.billableUnitLimit;
    const tradeNo = `SUB${Date.now()}${randomBytes(4).toString("hex").toUpperCase()}`;

    // For balance payment, check funds
    if (paymentMethod === "balance") {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw notFound("User not found");
      const available = user.quota - user.usedQuota;
      if (price > 0 && available < BigInt(price)) {
        throw badRequest("Insufficient balance for renewal");
      }
    }

    const durationDays = plan.billingCycleType === "yearly" ? 365 : 30;
    const newEndAt = new Date(Math.max(binding.endAt.getTime(), Date.now()) + durationDays * 86400000);

    const result = await this.prisma.$transaction(async (tx) => {
      // Extend binding
      const updated = await tx.userPlanBinding.update({
        where: { id: bindingId },
        data: {
          endAt: newEndAt,
          quotaGranted: { increment: quota },
        },
      });

      // Create order
      const order = await tx.subscriptionOrder.create({
        data: {
          userId, planId: plan.id, bindingId,
          tradeNo, paymentMethod,
          amount: quota, money: price,
          durationDays, status: "success",
        },
      });

      // Deduct balance
      if (paymentMethod === "balance" && price > 0) {
        await tx.user.update({
          where: { id: userId },
          data: { usedQuota: { increment: BigInt(price) } },
        });
      }

      // Grant quota
      if (quota > 0n) {
        await tx.user.update({
          where: { id: userId },
          data: { quota: { increment: quota } },
        });
      }

      return { binding: updated, order };
    });

    return result;
  }

  /** Cancel a subscription */
  async cancel(userId: bigint, bindingId: bigint) {
    const binding = await this.prisma.userPlanBinding.findUnique({ where: { id: bindingId } });
    if (!binding) throw notFound("Subscription not found");
    if (binding.userId !== userId) throw forbidden("Not your subscription");
    if (binding.status !== "active") throw badRequest("Subscription is not active");

    return this.prisma.userPlanBinding.update({
      where: { id: bindingId },
      data: { autoRenew: false, cancelledAt: new Date() },
    });
  }

  /** Scan and expire subscriptions past their endAt — called by cron */
  async expireSubscriptions() {
    const now = new Date();

    const expired = await this.prisma.userPlanBinding.findMany({
      where: { status: "active", endAt: { lte: now } },
      include: { plan: true },
    });

    let count = 0;
    for (const binding of expired) {
      await this.prisma.$transaction(async (tx) => {
        // Mark binding as expired
        await tx.userPlanBinding.update({
          where: { id: binding.id },
          data: { status: "expired" },
        });

        // Disable API keys bound to this plan
        await tx.apiKey.updateMany({
          where: { userId: binding.userId, planId: binding.planId, status: "active" },
          data: { status: "disabled" },
        });
      });
      count++;
    }

    return { expired: count };
  }

  /** Get user's subscriptions */
  async listSubscriptions(userId: bigint) {
    return this.prisma.userPlanBinding.findMany({
      where: { userId },
      include: { plan: { select: { id: true, name: true, displayName: true, tier: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  /** Get subscription orders */
  async listOrders(userId: bigint, page = 1, pageSize = 20) {
    const [items, total] = await Promise.all([
      this.prisma.subscriptionOrder.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.subscriptionOrder.count({ where: { userId } }),
    ]);
    return { items, total, page, pageSize };
  }
}
