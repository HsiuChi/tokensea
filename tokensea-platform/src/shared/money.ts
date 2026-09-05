// Fixed trial conversion, not a live FX quote. Ledger remains micro-USD.
export const CNY_PER_USD = 7.2;
export const FX_VERSION = 'trial-2026-09-05';
export function moneyValue(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(Math.abs(n) >= 1 ? 2 : Math.abs(n) >= .01 ? 4 : 6).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
}
export function formatMoney(usd: number, rate = CNY_PER_USD): string {
  return `¥${moneyValue(usd * rate)} / $${moneyValue(usd)}`;
}
