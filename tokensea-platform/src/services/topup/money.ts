import { badRequest } from '../../lib/errors.js';
import { CNY_PER_USD } from '../../shared/money.js';
export const PAYMENT_UNIT_VERSION='micro-usd-v1';
// Requests are RMB yuan (at most two decimal places); Stripe settlement is USD cents.
// Round settlement cents first so the credited micro-USD equals the actual charge.
export function paymentQuote(amount:number) {
  if(!Number.isFinite(amount)||amount<1||amount>10000||Math.abs(amount*100-Math.round(amount*100))>1e-7)
    throw badRequest('充值金额须为 1–10000 元，最多两位小数');
  const cents=Math.round(Math.round(amount*100)/CNY_PER_USD);
  return {paymentMinor:cents,amount:BigInt(cents)*10000n,money:cents/100,currency:'usd',
    unitVersion:PAYMENT_UNIT_VERSION,fxRate:CNY_PER_USD};
}
