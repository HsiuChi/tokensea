import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { VChart } from "@visactor/react-vchart"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/services/api"
import { formatLatency, formatNumber, formatQuota } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { ModelName } from "@/components/ModelIcon"
import {
  Activity, ArrowRight, CheckCircle2, CircleDollarSign, Copy,
  KeyRound, Plus, ShieldCheck, Sparkles, TerminalSquare, TrendingUp, WalletCards,
} from "lucide-react"

type Period = "7d" | "30d"

interface DashboardLog {
  id: string
  startedAt: string
  requestedModel: string
  actualUpstreamModel?: string
  status: string
  durationMs?: number
  inputTokens: number
  outputTokens: number
  billableUnits: string
}

const cardClass = "rounded-2xl border border-slate-200/80 bg-white shadow-[0_8px_28px_rgba(15,23,42,0.035)] dark:border-slate-800 dark:bg-slate-900/70"

export function DashboardPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [period, setPeriod] = useState<Period>("7d")
  const [stats, setStats] = useState<any>(null)
  const [dayStats, setDayStats] = useState<any>(null)
  const [models, setModels] = useState<any[]>([])
  const [apiKeys, setApiKeys] = useState<any[]>([])
  const [logs, setLogs] = useState<DashboardLog[]>([])
  const [loading, setLoading] = useState(true)
  const [copiedItem, setCopiedItem] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      api.getSelfStats({ period }).then((data) => setStats(data?.data ?? data)).catch(() => setStats(null)),
      api.getSelfStats({ period: "24h" }).then((data) => setDayStats(data?.data ?? data)).catch(() => setDayStats(null)),
      api.getSelfLogs({ page: 1 }).then((data) => setLogs((data?.items ?? data?.data?.items ?? []).slice(0, 5))).catch(() => setLogs([])),
      api.listModels().then((data) => setModels(Array.isArray(data) ? data : data?.data ?? [])).catch(() => setModels([])),
      api.listTokens(1, 20).then((data) => setApiKeys(data?.items ?? data?.data?.items ?? [])).catch(() => setApiKeys([])),
    ]).finally(() => setLoading(false))
  }, [period])

  const totals = stats?.totals ?? {}
  const totalTokens = Number(totals.inputTokens || 0) + Number(totals.outputTokens || 0)
  const succeeded = logs.filter((log) => log.status === "succeeded").length
  const successRate = logs.length ? (succeeded / logs.length) * 100 : 100
  const avgLatency = logs.length ? Math.round(logs.reduce((sum, log) => sum + Number(log.durationMs || 0), 0) / logs.length) : 0

  const chartData = useMemo(() => {
    const daily = stats?.daily ?? []
    if (daily.length) return daily
    const days = period === "7d" ? 7 : 14
    return Array.from({ length: days }, (_, index) => {
      const date = new Date()
      date.setDate(date.getDate() - (days - index - 1))
      return { date: `${date.getMonth() + 1}/${date.getDate()}`, requests: 0, tokens: 0, cost: "0" }
    })
  }, [stats, period])

  const chartSpec: any = {
    type: "area",
    data: { values: chartData },
    xField: "date",
    yField: "requests",
    point: { visible: true, style: { size: 5, fill: "#fff", stroke: "#2563eb", lineWidth: 2 } },
    area: { style: { fill: { gradient: "linear", x0: 0, y0: 0, x1: 0, y1: 1, stops: [{ offset: 0, color: "rgba(37,99,235,.22)" }, { offset: 1, color: "rgba(37,99,235,.02)" }] } } },
    line: { style: { stroke: "#2563eb", lineWidth: 2.5 } },
    axes: [
      { orient: "bottom", label: { style: { fontSize: 11, fill: "#64748b" } }, grid: { visible: false } },
      { orient: "left", label: { style: { fontSize: 11, fill: "#64748b" } }, grid: { style: { lineDash: [4, 4], stroke: "#dbe5f1" } } },
    ],
    tooltip: { mark: { content: [{ key: "请求数", value: (d: any) => d.requests }] } },
    padding: { top: 16, right: 14, bottom: 24, left: 46 },
    height: 250,
  }

  const providerStatus = useMemo(() => {
    const names = models.map((model) => `${model.owned_by || ""} ${model.id || ""}`.toLowerCase())
    return [
      { name: "OpenAI", ready: names.some((name) => /openai|gpt|o[134]/.test(name)) },
      { name: "Anthropic", ready: names.some((name) => /anthropic|claude/.test(name)) },
      { name: "Google", ready: names.some((name) => /google|gemini/.test(name)) },
    ]
  }, [models])

  const cards = [
    { label: "请求数", value: formatNumber(Number(totals.billedRequests || 0)), sub: period === "7d" ? "近 7 天" : "近 30 天", icon: Activity, color: "blue" },
    { label: "总 Tokens", value: formatNumber(totalTokens), sub: `输入 ${formatNumber(Number(totals.inputTokens || 0))}`, icon: Sparkles, color: "cyan" },
    { label: "本期费用", value: formatQuota(totals.billableUnits || 0), sub: period === "7d" ? "近 7 天" : "近 30 天", icon: CircleDollarSign, color: "indigo" },
    { label: "成功率", value: `${successRate.toFixed(2)}%`, sub: logs.length ? `最近 ${logs.length} 次请求` : "暂无失败请求", icon: ShieldCheck, color: "emerald" },
  ]

  const iconTone: Record<string, string> = {
    blue: "bg-blue-600 text-white", cyan: "bg-cyan-500 text-white", indigo: "bg-indigo-600 text-white", emerald: "bg-emerald-500 text-white",
  }

  const baseUrl = "https://api.tokensea.dev/v1"
  const activeKey = apiKeys.find((key) => key.status === "active") ?? apiKeys[0]
  const rawKey = activeKey?.keyPlain ?? ""
  const maskedKey = rawKey
    ? `${rawKey.slice(0, 8)}${"•".repeat(12)}${rawKey.slice(-4)}`
    : activeKey?.keyPrefix ? `${activeKey.keyPrefix}${"•".repeat(16)}` : "尚未创建 API 密钥"
  const defaultModel = models[0]?.id ?? "gpt-5.6-sol"
  const curlPreview = `curl ${baseUrl}/chat/completions \\\n+  -H "Authorization: Bearer ${maskedKey}" \\\n+  -H "Content-Type: application/json" \\\n+  -d '{"model":"${defaultModel}","messages":[{"role":"user","content":"你好"}]}'`
  const curlCommand = rawKey ? curlPreview.replace(maskedKey, rawKey) : curlPreview
  const remainingQuota = Math.max(Number(user?.quota || 0) - Number(user?.usedQuota || 0), 0)
  const dayTotals = dayStats?.totals ?? {}

  function copyText(value: string, item: string) {
    navigator.clipboard.writeText(value)
    setCopiedItem(item)
    window.setTimeout(() => setCopiedItem(null), 1600)
  }

  return <div className="space-y-4 pb-4">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[26px] font-extrabold tracking-tight text-slate-950 dark:text-white">{t("dashboard.greeting", { name: user?.name || user?.username || "" })}</h1>
          <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-600 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-400">用户控制台</span>
        </div>
        <p className="mt-1 text-sm font-medium text-slate-500 dark:text-slate-400">实时监控您的 API 使用与成本</p>
      </div>
      <div className="flex items-center gap-2">
        <select value={period} onChange={(event) => setPeriod(event.target.value as Period)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
          <option value="7d">近 7 天</option><option value="30d">近 30 天</option>
        </select>
        <button onClick={() => navigate("/app/keys")} className="inline-flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white shadow-lg shadow-blue-500/20 hover:bg-blue-700"><Plus className="h-4 w-4" />创建 API 密钥</button>
      </div>
    </div>

    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => <div key={card.label} className={`${cardClass} p-5`}>
        {loading ? <Skeleton className="h-[88px] w-full" /> : <>
          <div className="flex items-start justify-between">
            <div><p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{card.label}</p><p className="mt-2 text-[28px] font-extrabold tracking-tight text-slate-950 dark:text-white">{card.value}</p></div>
            <span className={`flex h-10 w-10 items-center justify-center rounded-full ${iconTone[card.color]}`}><card.icon className="h-5 w-5" /></span>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs font-medium text-slate-500"><span>{card.sub}</span><span className="inline-flex items-center gap-1 text-emerald-600"><TrendingUp className="h-3.5 w-3.5" />实时</span></div>
        </>}
      </div>)}
    </section>

    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className={`${cardClass} min-w-0 p-5`}>
        <div className="flex items-center justify-between"><div><h2 className="font-extrabold text-slate-950 dark:text-white">调用趋势</h2><p className="mt-1 text-xs text-slate-500">按天统计 API 请求数</p></div><span className="flex items-center gap-2 text-xs font-semibold text-slate-500"><i className="h-2 w-2 rounded-full bg-blue-600" />请求数</span></div>
        <div className="mt-2 h-[250px]">{loading ? <Skeleton className="h-full w-full" /> : <VChart spec={chartSpec} />}</div>
      </div>
      <div className="space-y-4">
        <div className={`${cardClass} p-5`}>
          <div className="flex items-center justify-between"><h2 className="font-extrabold text-slate-950 dark:text-white">网关状态</h2><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-600 dark:bg-emerald-500/10">运行正常</span></div>
          <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60"><div><p className="text-xs text-slate-500">P95 延迟</p><p className="mt-1 font-bold">{avgLatency ? formatLatency(avgLatency) : "—"}</p></div><div><p className="text-xs text-slate-500">错误率</p><p className="mt-1 font-bold">{(100 - successRate).toFixed(2)}%</p></div></div>
          <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">{providerStatus.map((provider) => <div key={provider.name} className="flex items-center justify-between py-2 text-sm"><span className="font-semibold text-slate-700 dark:text-slate-300">{provider.name}</span><span className={provider.ready ? "text-emerald-600" : "text-slate-400"}>{provider.ready ? "可用" : "未配置"}</span></div>)}</div>
          <button onClick={() => navigate("/app/channels")} className="mt-2 inline-flex items-center gap-1 text-sm font-bold text-blue-600">查看渠道状态<ArrowRight className="h-4 w-4" /></button>
        </div>
        <div className={`${cardClass} p-5`}>
          <div className="flex items-center justify-between"><div><h2 className="font-extrabold text-slate-950 dark:text-white">账户余额</h2><p className="mt-1 text-xs text-slate-500">余额与近 24 小时消耗</p></div><span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-500/10"><WalletCards className="h-4.5 w-4.5" /></span></div>
          <p className="mt-4 text-3xl font-extrabold tracking-tight text-slate-950 dark:text-white">{formatQuota(remainingQuota)}</p>
          <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60"><div><p className="text-xs text-slate-500">24h 请求</p><p className="mt-1 font-bold">{formatNumber(Number(dayTotals.billedRequests || 0))}</p></div><div><p className="text-xs text-slate-500">24h 消耗</p><p className="mt-1 font-bold">{formatQuota(dayTotals.billableUnits || 0)}</p></div></div>
          <button onClick={() => navigate("/app/topup")} className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-blue-600">余额与充值<ArrowRight className="h-4 w-4" /></button>
        </div>
      </div>
    </section>

    <section className={`${cardClass} overflow-hidden`}>
      <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800"><div><div className="flex items-center gap-2"><TerminalSquare className="h-5 w-5 text-blue-600" /><h2 className="font-extrabold text-slate-950 dark:text-white">快速接入</h2></div><p className="mt-1 text-xs text-slate-500">复制配置或示例代码，立即发起第一次请求</p></div><div className="flex gap-2"><button onClick={() => navigate("/app/keys")} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"><KeyRound className="h-3.5 w-3.5" />管理密钥</button><button onClick={() => navigate("/app/docs")} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-blue-600 px-3 text-xs font-bold text-white hover:bg-blue-700">接入文档<ArrowRight className="h-3.5 w-3.5" /></button></div></div>
      <div className="grid gap-5 p-5 xl:grid-cols-[minmax(280px,.72fr)_minmax(0,1.28fr)]">
        <div className="space-y-4">
          <div><div className="mb-2 flex items-center justify-between"><p className="text-xs font-bold text-slate-500">Base URL</p><span className="text-[11px] font-semibold text-emerald-600">OpenAI 兼容</span></div><button onClick={() => copyText(baseUrl, "baseUrl")} className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-left font-mono text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"><span className="truncate">{baseUrl}</span>{copiedItem === "baseUrl" ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : <Copy className="h-4 w-4 shrink-0 text-slate-400" />}</button></div>
          <div><div className="mb-2 flex items-center justify-between"><p className="text-xs font-bold text-slate-500">API Key</p>{activeKey && <span className="max-w-[150px] truncate text-[11px] font-semibold text-slate-400">{activeKey.name}</span>}</div><button disabled={!rawKey} onClick={() => rawKey && copyText(rawKey, "apiKey")} className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-left font-mono text-xs font-semibold text-slate-700 disabled:cursor-not-allowed dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"><span className="truncate">{maskedKey}</span>{copiedItem === "apiKey" ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : <Copy className="h-4 w-4 shrink-0 text-slate-400" />}</button>{!activeKey && <p className="mt-2 text-xs text-amber-600">请先创建一个 API 密钥</p>}</div>
        </div>
        <div className="min-w-0"><div className="mb-2 flex items-center justify-between"><p className="text-xs font-bold text-slate-500">cURL 示例</p><button disabled={!rawKey} onClick={() => copyText(curlCommand, "curl")} className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 disabled:text-slate-400">{copiedItem === "curl" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copiedItem === "curl" ? "已复制" : "复制代码"}</button></div><pre className="min-h-[148px] overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-slate-950 p-4 font-mono text-xs leading-6 text-slate-200"><code>{curlPreview}</code></pre></div>
      </div>
    </section>

    <section className={`${cardClass} overflow-hidden`}>
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800"><h2 className="font-extrabold text-slate-950 dark:text-white">最近请求</h2><button onClick={() => navigate("/app/logs")} className="text-sm font-bold text-blue-600">查看全部</button></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-sm"><thead className="bg-slate-50/70 text-left text-xs font-semibold text-slate-500 dark:bg-slate-800/40"><tr><th className="px-5 py-3">时间</th><th className="px-5 py-3">模型</th><th className="px-5 py-3">状态</th><th className="px-5 py-3 text-right">延迟</th><th className="px-5 py-3 text-right">Tokens</th><th className="px-5 py-3 text-right">费用</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">
        {loading ? Array.from({ length: 4 }).map((_, i) => <tr key={i}>{Array.from({ length: 6 }).map((_, j) => <td key={j} className="px-5 py-3"><Skeleton className="h-4 w-20" /></td>)}</tr>) : logs.length ? logs.map((log) => <tr key={log.id} className="text-slate-700 dark:text-slate-300"><td className="whitespace-nowrap px-5 py-3 text-xs text-slate-500">{new Date(log.startedAt).toLocaleString()}</td><td className="px-5 py-3"><ModelName model={log.requestedModel} upstreamModel={log.actualUpstreamModel} /></td><td className="px-5 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${log.status === "succeeded" ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10" : "bg-amber-50 text-amber-600 dark:bg-amber-500/10"}`}>{log.status === "succeeded" ? "成功" : "异常"}</span></td><td className="px-5 py-3 text-right">{formatLatency(Number(log.durationMs || 0))}</td><td className="px-5 py-3 text-right">{formatNumber(Number(log.inputTokens || 0) + Number(log.outputTokens || 0))}</td><td className="px-5 py-3 text-right font-semibold">{formatQuota(log.billableUnits || 0)}</td></tr>) : <tr><td colSpan={6} className="h-24 text-center text-sm text-slate-400">暂无请求记录，创建 API 密钥后开始调用</td></tr>}
      </tbody></table></div>
    </section>
  </div>
}
