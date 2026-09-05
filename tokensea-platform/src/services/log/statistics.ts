import { badRequest } from "../../lib/errors.js";

export function timeRange(period: string, startDate?: string, endDate?: string, now = new Date()) {
  let start: Date, end: Date;
  if (startDate || endDate) {
    start = startDate ? new Date(startDate) : new Date(now.getTime() - 30 * 86400000);
    end = endDate ? new Date(endDate) : now;
    if (endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) end = new Date(end.getTime() + 86400000);
  } else if (/^\d{4}(0[1-9]|1[0-2])$/.test(period)) {
    start = new Date(`${period.slice(0, 4)}-${period.slice(4)}-01T00:00:00Z`);
    end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  } else if (["24h", "7d", "30d"].includes(period)) {
    start = new Date(now.getTime() - ({ "24h": 1, "7d": 7, "30d": 30 }[period]! * 86400000));
    end = now;
  } else throw badRequest("Invalid statistics period");
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || start >= end || +end - +start > 366 * 86400000) throw badRequest("Invalid date range (maximum 366 days)");
  return { gte: start, lt: end };
}

export function qualityStats(logs: { status: string; durationMs: number | null; httpStatus: number | null }[]) {
  const successful = logs.filter(l => l.status === "succeeded");
  const latencies = successful.map(l => l.durationMs).filter((n): n is number => n !== null && n >= 0).sort((a,b) => a-b);
  return {
    totalRequests: logs.length, successfulRequests: successful.length,
    successRate: logs.length ? successful.length / logs.length * 100 : null,
    avgLatencyMs: latencies.length ? Math.round(latencies.reduce((a,b)=>a+b,0) / latencies.length) : null,
    p95LatencyMs: latencies.length ? latencies[Math.ceil(latencies.length * .95) - 1] : null,
    latencySamples: latencies.length,
    rateLimited: logs.filter(l=>l.httpStatus === 429).length,
    serverErrors: logs.filter(l=>(l.httpStatus ?? 0) >= 500).length,
  };
}
