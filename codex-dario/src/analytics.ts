/**
 * Token analytics for codex-dario.
 *
 * Simplified version of dario's analytics — adapted for OpenAI's
 * rate limit headers and billing model.
 */

export interface RequestRecord {
  timestamp: number;
  account: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  status: number;
  isStream: boolean;
}

export class Analytics {
  private records: RequestRecord[] = [];
  private maxRecords: number;

  constructor(maxRecords: number = 10_000) {
    this.maxRecords = maxRecords;
  }

  record(r: RequestRecord): void {
    this.records.push(r);
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }
  }

  summary(windowMinutes: number = 60): {
    window: { minutes: number; requests: number; totalInputTokens: number; totalOutputTokens: number; avgLatencyMs: number; errorRate: number };
    allTime: { requests: number; totalInputTokens: number; totalOutputTokens: number };
    perAccount: Record<string, { requests: number; inputTokens: number; outputTokens: number }>;
    perModel: Record<string, { requests: number; avgInputTokens: number; avgOutputTokens: number }>;
  } {
    const cutoff = Date.now() - windowMinutes * 60_000;
    const recent = this.records.filter(r => r.timestamp >= cutoff);
    const allTime = this.records;

    return {
      window: {
        minutes: windowMinutes,
        requests: recent.length,
        totalInputTokens: recent.reduce((s, r) => s + r.inputTokens, 0),
        totalOutputTokens: recent.reduce((s, r) => s + r.outputTokens, 0),
        avgLatencyMs: recent.length > 0 ? Math.round(recent.reduce((s, r) => s + r.latencyMs, 0) / recent.length) : 0,
        errorRate: recent.length > 0 ? Math.round(recent.filter(r => r.status >= 400).length / recent.length * 10000) / 10000 : 0,
      },
      allTime: {
        requests: allTime.length,
        totalInputTokens: allTime.reduce((s, r) => s + r.inputTokens, 0),
        totalOutputTokens: allTime.reduce((s, r) => s + r.outputTokens, 0),
      },
      perAccount: this.perAccountStats(recent),
      perModel: this.perModelStats(recent),
    };
  }

  private perAccountStats(records: RequestRecord[]): Record<string, { requests: number; inputTokens: number; outputTokens: number }> {
    const grouped: Record<string, RequestRecord[]> = {};
    for (const r of records) {
      (grouped[r.account] ??= []).push(r);
    }
    const result: Record<string, { requests: number; inputTokens: number; outputTokens: number }> = {};
    for (const [account, recs] of Object.entries(grouped)) {
      result[account] = {
        requests: recs.length,
        inputTokens: recs.reduce((s, r) => s + r.inputTokens, 0),
        outputTokens: recs.reduce((s, r) => s + r.outputTokens, 0),
      };
    }
    return result;
  }

  private perModelStats(records: RequestRecord[]): Record<string, { requests: number; avgInputTokens: number; avgOutputTokens: number }> {
    const grouped: Record<string, RequestRecord[]> = {};
    for (const r of records) {
      (grouped[r.model] ??= []).push(r);
    }
    const result: Record<string, { requests: number; avgInputTokens: number; avgOutputTokens: number }> = {};
    for (const [model, recs] of Object.entries(grouped)) {
      result[model] = {
        requests: recs.length,
        avgInputTokens: Math.round(recs.reduce((s, r) => s + r.inputTokens, 0) / recs.length),
        avgOutputTokens: Math.round(recs.reduce((s, r) => s + r.outputTokens, 0) / recs.length),
      };
    }
    return result;
  }
}
