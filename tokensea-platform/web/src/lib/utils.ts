import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { formatMoney,CNY_PER_USD } from "../../../src/shared/money"
export { formatMoney, CNY_PER_USD } from "../../../src/shared/money"
export const yuanToQuota=(yuan:number)=>Math.round(yuan/CNY_PER_USD*1_000_000)
export const quotaToYuan=(quota:number|string)=>Number(quota)/1_000_000*CNY_PER_USD

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatQuota(microdollars: number | string | bigint): string {
  const n = typeof microdollars === "bigint" ? Number(microdollars) : Number(microdollars)
  if (n < 0) return "Unlimited"
  const usd = n / 1_000_000
  return formatMoney(usd)
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}
