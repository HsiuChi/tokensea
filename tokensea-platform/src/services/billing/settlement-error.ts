import { AppError } from "../../lib/errors.js";

/** Accounting failures must never enter upstream failover or zero-usage fallback. */
export class SettlementError extends AppError {
  constructor(requestId: string) {
    super(503, "BILLING_REVIEW_REQUIRED", "计费结果正在核对，请勿重复提交。请求 ID：" + requestId);
  }
}
