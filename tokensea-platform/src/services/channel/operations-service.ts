import type { PrismaClient } from "@prisma/client";
import type Redis from "ioredis";
import { upstreamUrl } from "./upstream-request.js";
import { dispatchWebhookEvent } from "../notify/webhook-service.js";

export function quotaWindows(body: any) {
  const windows: any[] = [];
  const groups = [["调用", body?.rate_limit], ["代码审查", body?.code_review_rate_limit], ...(body?.additional_rate_limits ?? []).map((r: any) => [r.limit_name ?? r.metered_feature ?? "附加", r.rate_limit])];
  for (const [name, group] of groups) for (const [kind, w] of Object.entries(group ?? {})) {
    if (!w || typeof w !== "object") continue;
    const v = w as any;
    if (!("used_percent" in v)) continue;
    const used = typeof v.used_percent === "number" ? v.used_percent : null;
    windows.push({ name: name + " / " + kind, usedPercent: used, remainingPercent: used === null ? null : Math.max(0, Math.min(100,100-used)), resetAt: v.reset_at ?? null, windowSeconds: v.limit_window_seconds ?? null });
  }
  return windows;
}

/** Read-only, fixed-path CPA management adapter. Never exposes tokens or accepts arbitrary URLs. */
export class OperationsService {
  constructor(private prisma: PrismaClient, private redis: Redis) {}

  async cpaAccounts(node: any) {
    const cacheKey = "ops:cpa:" + node.id;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
    const secret = process.env.CPA_MANAGEMENT_KEY;
    if (new URL(node.internalUrl).origin !== new URL(process.env.CPA_MANAGEMENT_URL ?? "http://tokensea-infra-cpa:8080").origin) return { available: false, accounts: [], message: "此节点未配置独立管理连接" };
    if (!secret) return { available: false, message: "未配置 CPA 管理凭证；节点健康不代表内部账号额度充足。", accounts: [] };
    const call = async (path: string, body?: any) => {
      const r = await fetch(upstreamUrl(node.internalUrl, "/v0/management/" + path), { method: body ? "POST" : "GET", headers: { Authorization: "Bearer " + secret, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(12000) });
      if (!r.ok) throw new Error("CPA 管理接口 HTTP " + r.status);
      return r.json() as Promise<any>;
    };
    const lockKey = cacheKey + ":lock";
    if (!await this.redis.set(lockKey, "1", "EX", 300, "NX")) return { available: false, accounts: [], message: "账号额度正在刷新，请稍后重试" };
    try {
      const data = await call("auth-files");
      if (!Array.isArray(data.files)) throw new Error("CPA 账号格式无法识别");
      const accounts: any[] = [];
      // Bounded concurrency; all accounts listed, no silently truncated catalogue.
      for (let i=0; i<data.files.length; i+=4) {
        accounts.push(...await Promise.all(data.files.slice(i,i+4).map(async (f: any) => {
          const index = String(f.auth_index ?? "");
          const account: any = { id: index, name: String(f.email ?? f.name ?? f.label ?? "CPA 账号"), provider: f.provider ?? f.type, disabled: !!f.disabled, status: f.status ?? "unknown", unavailable: !!f.unavailable, windows: [], quotaMessage: "上游未提供额度", checkedAt: new Date().toISOString() };
          if (index && account.provider === "codex" && !account.disabled) {
            try {
              const header: Record<string,string> = { Authorization: "Bearer $TOKEN$", "Content-Type": "application/json" };
              const accountId = f.id_token?.chatgpt_account_id ?? f.account_id;
              if (typeof accountId === "string") header["Chatgpt-Account-Id"] = accountId;
              const result = await call("api-call", { authIndex: index, method: "GET", url: "https://chatgpt.com/backend-api/wham/usage", header });
              const status = result.status_code ?? result.statusCode;
              if (status < 200 || status >= 300 || !status) throw new Error("额度查询 HTTP " + (status ?? "未知"));
              const usage = typeof result.body === "string" ? JSON.parse(result.body) : result.body;
              account.windows = quotaWindows(usage);
              account.plan = usage?.plan_type ?? null;
              account.quotaMessage = account.windows.length ? "" : "上游未返回可识别额度窗口";
              if (account.windows.some((w:any)=>w.remainingPercent !== null && w.remainingPercent <= 10)) {
                const claimed = await this.redis.set("ops:low-quota:" + node.id + ":" + index, "1", "EX", 3600, "NX");
                if (claimed) dispatchWebhookEvent(this.prisma, "account.low_quota", { nodeId: node.id.toString(), account: account.name, windows: account.windows });
              }
            } catch(e: any) { account.quotaMessage = e.message?.startsWith("额度查询") ? e.message : "额度查询失败，未推断剩余额度"; }
          }
          return account;
        })));
      }
      const result = { available: true, checkedAt: new Date().toISOString(), accounts };
      await this.redis.set(cacheKey, JSON.stringify(result), "EX", 300);
      return result;
    } catch(e: any) { return { available: false, accounts: [], message: e.message?.startsWith("CPA") ? e.message : "CPA 管理查询失败" }; } finally { await this.redis.del(lockKey); }
  }

  async overview() {
    const since = new Date(Date.now() - 86400000);
    const channels = await this.prisma.channel.findMany({ include: { nodes: true }, orderBy: { id: "asc" } });
    const grouped = await this.prisma.requestLog.groupBy({ by: ["nodeId","httpStatus"], where: { startedAt: { gte: since } }, _count: true });
    const recentAlerts = await this.prisma.auditLog.findMany({ where: { targetType: { in: ["channel_alert", "webhook_delivery"] } }, orderBy: { createdAt: "desc" }, take: 50 });
    return { checkedAt: new Date().toISOString(), alerts: recentAlerts, channels: await Promise.all(channels.map(async c => ({
      id: c.id.toString(), name: c.name, status: c.status,
      nodes: await Promise.all(c.nodes.map(async n => {
        const rows = grouped.filter(r => r.nodeId === n.id);
        return { id: n.id.toString(), name: n.name, adapter: n.adapter, status: n.status, lastHealthCheck: n.lastHealthCheck, probeLatency: n.probeLatency,
          requests24h: rows.reduce((a,r)=>a+r._count,0),
          rateLimited24h: rows.filter(r=>r.httpStatus===429).reduce((a,r)=>a+r._count,0),
          authErrors24h: rows.filter(r=>r.httpStatus===401||r.httpStatus===403).reduce((a,r)=>a+r._count,0),
          cpa: n.adapter === "cpa" && c.status === "active" ? await this.cpaAccounts(n) : null,
          quotaMessage: n.adapter === "ksyun" ? "KSP 未接入余额查询；多把 Key 可能共享账户额度。" : null };
      }))
    }))) };
  }
}
