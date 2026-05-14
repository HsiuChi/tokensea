import type { PrismaClient } from "@prisma/client";

export class BillingService {
  constructor(private prisma: PrismaClient) {}

  async getLedgerSummary(userId: bigint, period: string) {
    const ledgers = await this.prisma.usageLedger.findMany({
      where: { userId, billingPeriod: period },
      orderBy: { createdAt: "desc" },
    });

    const totals = ledgers.reduce((acc, l) => ({
      billedRequests: acc.billedRequests + l.billedRequests,
      inputTokens: acc.inputTokens + l.inputTokens,
      outputTokens: acc.outputTokens + l.outputTokens,
      billableUnits: acc.billableUnits + l.billableUnits,
    }), { billedRequests: 0, inputTokens: 0, outputTokens: 0, billableUnits: 0n });

    return { period, totals: { ...totals, billableUnits: totals.billableUnits.toString() }, count: ledgers.length };
  }

  async getGlobalRevenue(period?: string) {
    const where = period ? { billingPeriod: period } : {};
    const result = await this.prisma.usageLedger.aggregate({
      where,
      _sum: { billableUnits: true, billedRequests: true },
    });

    return {
      totalBillableUnits: (result._sum.billableUnits ?? 0n).toString(),
      totalRequests: result._sum.billedRequests ?? 0,
    };
  }
}
