import { useCallback, useEffect, useState } from "react"
import { api } from "@/services/api"
import { Skeleton } from "@/components/ui/skeleton"
import { VendorIcon } from "@/components/VendorIcon"
import { Activity, AlertTriangle, Clock3, Gauge, RefreshCw, Server, ShieldCheck } from "lucide-react"

type Period = "24h" | "7d" | "30d"
interface RecentRequest { status: number; durationMs: number | null; at: string }
interface ChannelQuality {
  id: string
  name: string
  alias: string
  provider: string
  state: "operational" | "degraded" | "outage"
  availability: number
  latencyMs: number | null
  pingMs: number | null
  totalRequests: number
  rateLimited: number
  serverErrors: number
  timeouts: number
  nodes: { healthy: number; degraded: number; total: number }
  recent: RecentRequest[]
}

const PERIODS: Array<{ value: Period; label: string }> = [
  { value: "24h", label: "24 小时" },
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
]
const STATE_STYLE = {
  operational: { label: "畅通", dot: "bg-emerald-500", badge: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" },
  degraded: { label: "有波动", dot: "bg-amber-500", badge: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300" },
  outage: { label: "不可用", dot: "bg-rose-500", badge: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300" },
}

function requestColor(status: number) {
  if (status === 429) return "bg-amber-400"
  if (status >= 500 || status === 408) return "bg-rose-500"
  if (status >= 400) return "bg-orange-300"
  return "bg-emerald-500"
}
function availabilityColor(value: number) {
  if (value >= 99) return "text-emerald-600 dark:text-emerald-400"
  if (value >= 95) return "text-amber-600 dark:text-amber-400"
  return "text-rose-600 dark:text-rose-400"
}
function ChannelLogo({ alias }: { alias: string }) { return <VendorIcon name={alias} size={24} /> }

export function ChannelStatusPage() {
  const [channels, setChannels] = useState<ChannelQuality[]>([])
  const [summary, setSummary] = useState({ state: "operational", operational: 0, total: 0 })
  const [period, setPeriod] = useState<Period>("7d")
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [countdown, setCountdown] = useState(60)

  const load = useCallback(async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true)
    try {
      const result = await api.getChannelStatus(period)
      setChannels(result.data ?? [])
      setSummary(result.summary ?? { state: "operational", operational: 0, total: 0 })
      setUpdatedAt(result.updatedAt ? new Date(result.updatedAt) : new Date())
      setCountdown(60)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [period])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const timer = window.setInterval(() => setCountdown((current) => {
      if (current <= 1) { load(true); return 60 }
      return current - 1
    }), 1000)
    return () => window.clearInterval(timer)
  }, [load])

  const overallStyle = STATE_STYLE[summary.state as keyof typeof STATE_STYLE] ?? STATE_STYLE.operational
  const total429 = channels.reduce((sum, channel) => sum + channel.rateLimited, 0)
  const averageAvailability = channels.length ? channels.reduce((sum, channel) => sum + channel.availability, 0) / channels.length : 0

  return <div className="space-y-6">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-[30px] font-black tracking-tight text-slate-950 dark:text-slate-100">渠道状态</h1>
          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold ${overallStyle.badge}`}><span className={`h-2 w-2 rounded-full ${overallStyle.dot}`} />{overallStyle.label}</span>
        </div>
        <p className="mt-2 text-sm font-medium text-slate-500 dark:text-slate-400">实时查看请求延迟、节点连通性、限流与错误情况</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {PERIODS.map((item) => <button key={item.value} onClick={() => setPeriod(item.value)} className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${period === item.value ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800"}`}>{item.label}</button>)}
        </div>
        <button onClick={() => load(true)} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 shadow-sm hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800">
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />{countdown}s 后刷新
        </button>
      </div>
    </div>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCard icon={<ShieldCheck className="h-5 w-5 text-emerald-500" />} label="畅通模型" value={`${summary.operational}/${summary.total}`} />
      <SummaryCard icon={<Gauge className="h-5 w-5 text-blue-500" />} label="平均可用率" value={loading ? "—" : `${averageAvailability.toFixed(2)}%`} />
      <SummaryCard icon={<AlertTriangle className="h-5 w-5 text-amber-500" />} label="429 限流" value={loading ? "—" : String(total429)} />
      <SummaryCard icon={<Clock3 className="h-5 w-5 text-indigo-500" />} label="最后更新" value={updatedAt ? updatedAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"} />
    </div>

    {loading ? <div className="grid gap-5 xl:grid-cols-3">{Array.from({ length: 3 }).map((_, index) => <div key={index} className="rounded-[22px] border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><Skeleton className="h-56 w-full" /></div>)}</div>
      : <div className="grid gap-5 xl:grid-cols-3">{channels.map((channel) => <ChannelCard key={channel.id} channel={channel} period={period} />)}</div>}

    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-xs font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
      <span className="font-bold text-slate-700 dark:text-slate-300">状态说明</span>
      <Legend color="bg-emerald-500" label="成功" /><Legend color="bg-amber-400" label="429 限流" /><Legend color="bg-orange-300" label="其他 4xx" /><Legend color="bg-rose-500" label="5xx / 超时" />
      <span className="ml-auto">可用率计算会排除由请求参数导致的普通 4xx</span>
    </div>
  </div>
}

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.035)] dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center gap-2 text-xs font-bold text-slate-500 dark:text-slate-400">{icon}{label}</div><p className="mt-3 text-2xl font-black tracking-tight text-slate-900 dark:text-slate-100">{value}</p></div>
}

function ChannelCard({ channel, period }: { channel: ChannelQuality; period: Period }) {
  const style = STATE_STYLE[channel.state]
  const emptySlots = Math.max(0, 30 - channel.recent.length)
  return <article className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-[0_12px_38px_rgba(15,23,42,0.045)] dark:border-slate-800 dark:bg-slate-900">
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-50 ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700"><ChannelLogo alias={channel.alias} /></div><div className="min-w-0"><h2 className="truncate font-extrabold text-slate-900 dark:text-slate-100">{channel.name}</h2><p className="mt-0.5 truncate font-mono text-xs text-slate-500 dark:text-slate-400">{channel.alias} · {channel.nodes.healthy}/{channel.nodes.total} 节点健康</p></div></div>
      <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${style.badge}`}><span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />{style.label}</span>
    </div>
    <div className="mt-5 grid grid-cols-2 gap-3"><Metric icon={<Activity className="h-3.5 w-3.5" />} label="对话延迟" hint="该模型成功请求从发出到完成的平均耗时" value={channel.latencyMs == null ? "暂无" : `${channel.latencyMs} ms`} /><Metric icon={<Server className="h-3.5 w-3.5" />} label="节点 PING" hint="健康检查访问上游探测接口的网络往返时间，不含模型生成" value={channel.pingMs == null ? "暂无" : `${channel.pingMs} ms`} /></div>
    <div className="mt-4 flex items-end justify-between border-t border-slate-100 pt-4 dark:border-slate-800">
      <div><p className="text-[11px] font-semibold text-slate-400">可用率 · {period === "24h" ? "24 小时" : period === "30d" ? "30 天" : "7 天"}</p><p className={`mt-1 text-3xl font-black tracking-tight ${availabilityColor(channel.availability)}`}>{channel.availability.toFixed(2)}%</p></div>
      <div className="flex gap-1.5 text-[10px] font-bold"><span className="rounded-md bg-amber-50 px-2 py-1 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">429 {channel.rateLimited}</span><span className="rounded-md bg-rose-50 px-2 py-1 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">5xx {channel.serverErrors}</span><span className="rounded-md bg-slate-100 px-2 py-1 text-slate-600 dark:bg-slate-800 dark:text-slate-300">超时 {channel.timeouts}</span></div>
    </div>
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between text-[10px] font-bold text-slate-400"><span>最近 {Math.min(channel.recent.length, 60)} 次请求</span><span>{channel.totalRequests} 次 / 周期</span></div>
      <div className="flex h-8 items-end gap-1 overflow-hidden">
        {Array.from({ length: emptySlots }).map((_, index) => <span key={`empty-${index}`} className="h-4 min-w-1 flex-1 rounded-sm bg-slate-100 dark:bg-slate-800" />)}
        {channel.recent.map((request, index) => <span key={`${request.at}-${index}`} title={`${request.status} · ${request.durationMs == null ? "无耗时" : `${request.durationMs} ms`} · ${new Date(request.at).toLocaleString("zh-CN")}`} className={`min-w-1 flex-1 rounded-sm ${requestColor(request.status)} ${request.status >= 400 ? "h-7" : "h-5"}`} />)}
      </div>
      <div className="mt-1 flex justify-between text-[9px] font-bold uppercase tracking-widest text-slate-300 dark:text-slate-600"><span>Past</span><span>Now</span></div>
    </div>
  </article>
}

function Metric({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint: string }) {
  return <div title={hint} className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/30"><p className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400">{icon}{label}</p><p className="mt-2 text-lg font-black text-slate-900 dark:text-slate-100">{value}</p></div>
}
function Legend({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-sm ${color}`} />{label}</span>
}
