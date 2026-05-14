import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { notFound, badRequest } from "../../lib/errors.js";
import { generateRedemptionCode } from "../../lib/crypto.js";

export class RedemptionService {
  constructor(private prisma: PrismaClient) {}

  async list(opts?: { page?: number; pageSize?: number; status?: string }) {
    const page = opts?.page ?? 1;
    const pageSize = Math.min(opts?.pageSize ?? 20, 100);
    const where = opts?.status ? { status: opts.status as any } : {};

    const [items, total] = await Promise.all([
      this.prisma.redemption.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.redemption.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async create(data: {
    name: string; type?: string; quota?: bigint; count?: number;
    keyQuota?: bigint; keyModels?: string[]; keyMaxCalls?: bigint;
    keyName?: string; keyDailyLimit?: bigint; keyTokenLimit?: bigint;
    keyExpiresAt?: Date;
  }, createdBy: bigint) {
    const code = generateRedemptionCode();
    return this.prisma.redemption.create({
      data: {
        code,
        name: data.name,
        type: data.type ?? "quota",
        quota: data.quota ?? 0n,
        count: data.count ?? 1,
        keyQuota: data.keyQuota ?? -1n,
        keyModels: data.keyModels ?? Prisma.JsonNull,
        keyMaxCalls: data.keyMaxCalls ?? -1n,
        keyName: data.keyName ?? null,
        keyDailyLimit: data.keyDailyLimit ?? -1n,
        keyTokenLimit: data.keyTokenLimit ?? -1n,
        keyExpiresAt: data.keyExpiresAt ?? null,
        createdBy,
      },
    });
  }

  async batchCreate(data: { name: string; count: number; quota: bigint }, createdBy: bigint, batchCount = 10) {
    const results = [];
    for (let i = 0; i < batchCount; i++) {
      results.push(await this.create(data, createdBy));
    }
    return results;
  }

  async redeem(userId: bigint, code: string) {
    const redemption = await this.prisma.redemption.findUnique({ where: { code } });
    if (!redemption) throw notFound("Invalid redemption code");
    if (redemption.status !== "active") throw badRequest("Redemption code is no longer valid");
    if (redemption.usedCount >= redemption.count) throw badRequest("Redemption code has been fully used");

    await this.prisma.$transaction(async (tx) => {
      if (redemption.type === "quota") {
        await tx.user.update({
          where: { id: userId },
          data: { quota: { increment: redemption.quota } },
        });
      }

      // Mark usage
      const usedBy = (redemption.usedBy as any[]) ?? [];
      usedBy.push({ userId: userId.toString(), at: new Date().toISOString() });
      const newUsedCount = redemption.usedCount + 1;

      await tx.redemption.update({
        where: { id: redemption.id },
        data: {
          usedCount: newUsedCount,
          usedBy,
          status: newUsedCount >= redemption.count ? "used" : "active",
        },
      });
    });

    return { message: redemption.type === "quota" ? `Added ¥${(Number(redemption.quota) / 100).toFixed(2)} to your balance` : "Redeemed successfully" };
  }

  async delete(id: bigint) {
    await this.prisma.redemption.delete({ where: { id } });
  }
}
