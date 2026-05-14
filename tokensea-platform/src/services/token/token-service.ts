import type { PrismaClient, ApiKey } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { generateApiKey, hashApiKey } from "../../lib/crypto.js";
import { badRequest, notFound, forbidden } from "../../lib/errors.js";

const UNLIMITED = -1n;

export class TokenService {
  constructor(private prisma: PrismaClient) {}

  async list(userId: bigint, opts?: { page?: number; pageSize?: number }) {
    const page = opts?.page ?? 1;
    const pageSize = Math.min(opts?.pageSize ?? 20, 100);
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.prisma.apiKey.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
        select: {
          id: true,
          keyPrefix: true,
          keyPlain: true,
          name: true,
          status: true,
          quota: true,
          usedQuota: true,
          maxCalls: true,
          usedCalls: true,
          models: true,
          planId: true,
          expiresAt: true,
          lastUsedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.apiKey.count({ where: { userId } }),
    ]);

    return { items, total, page, pageSize };
  }

  async create(userId: bigint, input: {
    name: string;
    quota?: bigint;
    maxCalls?: bigint;
    models?: string[];
    planId?: bigint;
    expiresAt?: Date;
    dailyLimit?: bigint;
    tokenLimit?: bigint;
    allowedIps?: string[];
  }): Promise<{ apiKey: ApiKey; rawKey: string }> {
    // Verify user exists and is active
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw notFound("User not found");
    if (user.status === "disabled") throw forbidden("Account is disabled");

    // Check user has available quota (unlimited quota = -1 is always ok)
    if (user.quota >= 0n && user.usedQuota >= user.quota) {
      throw forbidden("Insufficient quota to create API key");
    }

    const { raw, prefix, hash } = generateApiKey();

    const apiKey = await this.prisma.apiKey.create({
      data: {
        userId,
        keyPrefix: prefix,
        keyHash: hash,
        keyPlain: raw,
        name: input.name,
        status: "active",
        quota: input.quota ?? UNLIMITED,
        usedQuota: 0n,
        maxCalls: input.maxCalls ?? UNLIMITED,
        usedCalls: 0n,
        dailyLimit: input.dailyLimit ?? UNLIMITED,
        tokenLimit: input.tokenLimit ?? UNLIMITED,
        models: input.models ?? Prisma.JsonNull,
        planId: input.planId ?? null,
        expiresAt: input.expiresAt ?? null,
        allowedIps: input.allowedIps ?? Prisma.JsonNull,
      },
    });

    return { apiKey, rawKey: raw };
  }

  async update(userId: bigint, apiKeyId: bigint, data: {
    name?: string;
    status?: "active" | "disabled";
    quota?: bigint;
    maxCalls?: bigint;
    models?: string[];
    planId?: bigint;
    expiresAt?: Date | null;
    dailyLimit?: bigint;
    tokenLimit?: bigint;
    allowedIps?: string[] | null;
  }) {
    const existing = await this.prisma.apiKey.findFirst({
      where: { id: apiKeyId, userId },
    });
    if (!existing) throw notFound("API key not found");

    const updateData: Record<string, any> = {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.status !== undefined && { status: data.status }),
      ...(data.quota !== undefined && { quota: data.quota }),
      ...(data.maxCalls !== undefined && { maxCalls: data.maxCalls }),
      ...(data.models !== undefined && { models: data.models }),
      ...(data.planId !== undefined && { planId: data.planId }),
      ...(data.expiresAt !== undefined && { expiresAt: data.expiresAt }),
      ...(data.dailyLimit !== undefined && { dailyLimit: data.dailyLimit }),
      ...(data.tokenLimit !== undefined && { tokenLimit: data.tokenLimit }),
      ...(data.allowedIps !== undefined && { allowedIps: data.allowedIps === null ? Prisma.JsonNull : data.allowedIps }),
    };

    return this.prisma.apiKey.update({
      where: { id: apiKeyId },
      data: updateData as any,
    });
  }

  async delete(userId: bigint, apiKeyId: bigint) {
    const existing = await this.prisma.apiKey.findFirst({
      where: { id: apiKeyId, userId },
    });
    if (!existing) throw notFound("API key not found");

    await this.prisma.$transaction(async (tx) => {
      await tx.requestLog.deleteMany({ where: { apiKeyId } });
      await tx.usageLedger.deleteMany({ where: { apiKeyId } });
      await tx.apiKey.delete({ where: { id: apiKeyId } });
    });
  }

  async findByKeyHash(keyHash: string) {
    return this.prisma.apiKey.findUnique({
      where: { keyHash },
      include: { user: true, plan: true },
    });
  }
}
