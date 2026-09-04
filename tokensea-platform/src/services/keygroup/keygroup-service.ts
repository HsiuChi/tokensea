import type { PrismaClient } from "@prisma/client";
import { notFound } from "../../lib/errors.js";

export class KeyGroupService {
  constructor(private prisma: PrismaClient) {}

  async list(opts?: { page?: number; pageSize?: number }) {
    const page = opts?.page ?? 1;
    const pageSize = Math.min(opts?.pageSize ?? 20, 100);
    const [items, total] = await Promise.all([
      this.prisma.keyGroup.findMany({
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize, take: pageSize,
        include: { _count: { select: { apiKeys: true } } },
      }),
      this.prisma.keyGroup.count(),
    ]);
    return { items, total, page, pageSize };
  }

  async get(id: bigint) {
    const g = await this.prisma.keyGroup.findUnique({
      where: { id },
      include: { apiKeys: { select: { id: true, name: true, keyPrefix: true, status: true, usedQuota: true } } },
    });
    if (!g) throw notFound("Key group not found");
    return g;
  }

  async create(data: { name: string; userId: bigint; models?: string[]; quota?: bigint; priority?: number }) {
    return this.prisma.keyGroup.create({ data: {
      name: data.name, userId: data.userId,
      models: data.models ?? undefined,
      quota: data.quota ?? -1n,
      priority: data.priority ?? 0,
    }});
  }

  async update(id: bigint, data: Record<string, any>) {
    return this.prisma.keyGroup.update({ where: { id }, data });
  }

  async delete(id: bigint) {
    // unlink keys first
    await this.prisma.apiKey.updateMany({ where: { keyGroupId: id }, data: { keyGroupId: null } });
    return this.prisma.keyGroup.delete({ where: { id } });
  }

  /** Decrement group quota atomically; returns true if enough quota. */
  async deductQuota(groupId: bigint, amount: bigint): Promise<boolean> {
    const g = await this.prisma.keyGroup.findUnique({ where: { id: groupId } });
    if (!g) return false;
    if (g.quota === -1n) return true; // unlimited
    if (g.usedQuota + amount > g.quota) return false;
    await this.prisma.keyGroup.update({
      where: { id: groupId },
      data: { usedQuota: { increment: amount } },
    });
    return true;
  }
}
