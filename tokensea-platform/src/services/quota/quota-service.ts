import type { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { redisKeys } from "../../lib/redis-keys.js";

export class QuotaService {
  constructor(
    private prisma: PrismaClient,
    private redis: Redis,
  ) {}

  async checkUserQuota(userId: bigint): Promise<{ quota: bigint; used: bigint; remaining: bigint; exceeded: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return { quota: 0n, used: 0n, remaining: 0n, exceeded: true };

    const remaining = user.quota - user.usedQuota;
    return {
      quota: user.quota,
      used: user.usedQuota,
      remaining,
      exceeded: user.quota > 0n && remaining <= 0n,
    };
  }

  async getDailySpending(userId: bigint, date: string): Promise<number> {
    const key = redisKeys.userDailySpending(userId, date);
    const val = await this.redis.get(key);
    return val ? Number(val) : 0;
  }

  async getPeriodUsage(userId: bigint, period: string) {
    const ledgers = await this.prisma.usageLedger.findMany({
      where: { userId, billingPeriod: period },
    });

    return ledgers.reduce((acc, l) => ({
      billedRequests: acc.billedRequests + l.billedRequests,
      inputTokens: acc.inputTokens + l.inputTokens,
      outputTokens: acc.outputTokens + l.outputTokens,
      billableUnits: acc.billableUnits + l.billableUnits,
    }), { billedRequests: 0, inputTokens: 0, outputTokens: 0, billableUnits: 0n });
  }
}
