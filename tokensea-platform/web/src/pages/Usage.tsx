import { useEffect, useState, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/services/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatQuota } from "@/lib/utils"
import { ModelIcon } from "@/components/ModelIcon"
import { DollarSign, Zap, Coins, Activity, ChevronLeft, ChevronRight } from "lucide-react"

const MODEL_COLORS = [
  "bg-orange-500", "bg-emerald-500", "bg-blue-500", "bg-violet-500",
  "bg-pink-500", "bg-cyan-500", "bg-amber-500", "bg-rose-500",
  "bg-teal-500", "bg-indigo-500",
]

export function UsagePage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [stats, setStats] = useState<any>(null)
  const [logs, setLogs] = useState<any>({ items: [], total: 0 })
  const [page, setPage] = useState(1)
  const [period, setPeriod] = useState("7d")
  const [customStart, setCustomStart] = useState("")
  const [customEnd, setCustomEnd] = useState("")

  const fetchStats = () => {
    if (customStart || customEnd) {
      api.getSelfStats({ period: "30d", startDate: customStart || undefined, endDate: customEnd || undefined }).then(setStats).catch(console.error)
    } else {
      api.getSelfStats({ period }).then(setStats).catch(console.error)
    }
  }

  useEffect(() => { fetchStats() }, [period])
  useEffect(() => {
    if (customStart || customEnd) fetchStats()
  }, [customStart, customEnd])

  useEffect(() => {
    api.getSelfLogs({ page }).then(setLogs).catch(console.error)
  }, [page])

  const dailyData = stats?.daily || []
  const modelBreakdown = stats?.modelBreakdown || []
  const totalTokens = (stats?.totals?.inputTokens || 0) + (stats?.totals?.outputTokens || 0)
  const totalCost = Number(stats?.totals?.billableUnits || 0)
  const totalRequests = stats?.totals?.billedRequests || 0

  // Today's requests from daily data
  const todayStr = new Date().toISOString().slice(0, 10)
  const todayData = dailyData.find((d: any) => d.date === todayStr)
  const todayRequests = todayData?.requests || 0
  const todayCost = Number(todayData?.cost || 0)

  const quotaUsed = Number(user?.usedQuota || 0)
  const quotaTotal = Number(user?.quota || 0)
  const quotaPercent = quotaTotal > 0 ? Math.min((quotaUsed / quotaTotal) * 100, 100) : 0

  // Build model color map from modelBreakdown
  const modelColorMap = useMemo(() => {
    const map = new Map<string, string>()
    modelBreakdown.forEach((m: any, i: number) => {
      map.set(m.model, MODEL_COLORS[i % MODEL_COLORS.length])
    })
    return map
  }, [modelBreakdown])

  // Find max cost for chart scaling
  const maxCost = Math.max(...dailyData.map((d: any) => Number(d.cost || 0)), 1)

  const handleCustomSearch = () => {
    if (customStart || customEnd) fetchStats()
  }

  const clearCustom = () => {
    setCustomStart("")
    setCustomEnd("")
    setPeriod("7d")
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("usage.title")}</h1>
          <p className="text-muted-foreground">{t("usage.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Quick period buttons */}
          {(["24h", "7d", "30d"] as const).map((p) => (
            <Button
              key={p}
              variant={period === p && !customStart && !customEnd ? "default" : "outline"}
              size="sm"
              onClick={() => { setPeriod(p); setCustomStart(""); setCustomEnd("") }}
            >
              {p === "24h" ? t("usage.last24h") : p === "7d" ? t("usage.last7d") : t("usage.last30d")}
            </Button>
          ))}
        </div>
      </div>

      {/* Custom date range */}
      <div className="flex items-center gap-2 flex-wrap">
        <Input type="date" className="w-[150px]" value={customStart} onChange={(e) => setCustomStart(e.target.value)} placeholder="Start" />
        <span className="text-muted-foreground text-sm">—</span>
        <Input type="date" className="w-[150px]" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} placeholder="End" />
        <Button variant="outline" size="sm" onClick={handleCustomSearch}>{t("common.refresh", { defaultValue: "Apply" })}</Button>
        {(customStart || customEnd) && (
          <Button variant="ghost" size="sm" onClick={clearCustom}>{t("common.clear", { defaultValue: "Clear" })}</Button>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-muted-foreground">
              <DollarSign className="h-4 w-4" />
              <span className="text-sm font-medium">{t("usage.totalUsed")}</span>
            </div>
            <div className="mt-2 text-2xl font-bold">{formatQuota(quotaUsed)}</div>
            <p className="text-xs text-muted-foreground mt-1">{t("usage.ofQuota", { quota: formatQuota(quotaTotal) })}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Coins className="h-4 w-4" />
              <span className="text-sm font-medium">{t("usage.periodCost")}</span>
            </div>
            <div className="mt-2 text-2xl font-bold">{formatQuota(totalCost)}</div>
            <p className="text-xs text-muted-foreground mt-1">{totalRequests} {t("usage.requests", { defaultValue: "requests" })}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Zap className="h-4 w-4" />
              <span className="text-sm font-medium">{t("usage.tokensUsed")}</span>
            </div>
            <div className="mt-2 text-2xl font-bold">{totalTokens.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {stats?.totals?.inputTokens || 0} in / {stats?.totals?.outputTokens || 0} out
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Activity className="h-4 w-4" />
              <span className="text-sm font-medium">Today</span>
            </div>
            <div className="mt-2 text-2xl font-bold">{todayRequests}</div>
            <p className="text-xs text-muted-foreground mt-1">{formatQuota(todayCost)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Activity className="h-4 w-4" />
              <span className="text-sm font-medium">{t("usage.quotaUsage")}</span>
            </div>
            <div className="mt-2 text-2xl font-bold">{quotaPercent.toFixed(1)}%</div>
            <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${quotaPercent}%` }} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Daily stacked bar chart — cost by model */}
      {dailyData.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">{period === "7d" ? t("usage.weeklyCost", { defaultValue: "最近 7 天消费" }) : t("usage.dailyCost", { defaultValue: "每日消费" })}</CardTitle>
            {/* Model legend */}
            <div className="flex flex-wrap gap-3">
              {modelBreakdown.map((m: any) => (
                <div key={m.model} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <div className={`h-2.5 w-2.5 rounded-sm ${modelColorMap.get(m.model)}`} />
                  <span className="max-w-[100px] truncate">{m.model}</span>
                </div>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-[3px] h-40">
              {dailyData.map((d: any, i: number) => {
                const dayCost = Number(d.cost || 0)
                const height = Math.max(2, (dayCost / maxCost) * 100)
                const models: { model: string; cost: string }[] = d.models || []
                const sorted = [...models].sort((a, b) => Number(b.cost) - Number(a.cost))
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-0.5 group relative">
                    <span className="text-[9px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                      {dayCost > 0 ? formatQuota(dayCost) : "$0"}
                    </span>
                    {/* Stacked bar */}
                    <div className="w-full rounded-t overflow-hidden flex flex-col-reverse" style={{ height: `${height}%`, minHeight: dayCost > 0 ? 2 : 0 }}>
                      {sorted.map((md: any, mi: number) => {
                        const mdCost = Number(md.cost || 0)
                        const segHeight = dayCost > 0 ? (mdCost / dayCost) * 100 : 0
                        return (
                          <div
                            key={mi}
                            className={`${modelColorMap.get(md.model) || "bg-slate-300"} transition-all`}
                            style={{ height: `${segHeight}%`, minHeight: segHeight > 0 ? 1 : 0 }}
                            title={`${md.model}: ${formatQuota(mdCost)}`}
                          />
                        )
                      })}
                    </div>
                    <span className="text-[8px] text-muted-foreground truncate w-full text-center">
                      {d.date?.slice(5)}
                    </span>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Model breakdown */}
      {modelBreakdown.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-lg">{t("usage.modelBreakdown")}</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("usage.model")}</TableHead>
                  <TableHead>{t("common.count")}</TableHead>
                  <TableHead>{t("usage.tokens")}</TableHead>
                  <TableHead>{t("usage.cost")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {modelBreakdown.map((m: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <ModelIcon model={m.model} size={4} />
                        <span className="font-mono text-sm">{m.model}</span>
                      </div>
                    </TableCell>
                    <TableCell>{m.requestCount}</TableCell>
                    <TableCell>{((m.promptTokens || 0) + (m.completionTokens || 0)).toLocaleString()}</TableCell>
                    <TableCell>{formatQuota(m.cost || 0)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Recent requests */}
      <Card>
        <CardHeader><CardTitle className="text-lg">{t("usage.recentRequests")}</CardTitle></CardHeader>
        <CardContent className="p-0">
          {logs.items?.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("usage.time")}</TableHead>
                  <TableHead>{t("usage.model")}</TableHead>
                  <TableHead>{t("usage.tokens")}</TableHead>
                  <TableHead>{t("usage.cost")}</TableHead>
                  <TableHead>{t("usage.latency")}</TableHead>
                  <TableHead>{t("common.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.items.map((log: any) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-xs text-muted-foreground">{new Date(log.startedAt || log.createdAt).toLocaleString()}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <ModelIcon model={log.requestedModel || log.model} size={4} />
                        <span className="font-mono text-xs">{log.requestedModel || log.model}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">{(log.inputTokens || log.promptTokens || 0) + (log.outputTokens || log.completionTokens || 0)}</TableCell>
                    <TableCell className="text-xs">{formatQuota(log.billableUnits || log.cost)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{log.durationMs || log.latencyMs ? `${log.durationMs || log.latencyMs}ms` : "—"}</TableCell>
                    <TableCell>
                      <Badge variant={log.status === "succeeded" || log.status === "success" ? "success" : "destructive"}>{log.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="py-12 text-center text-muted-foreground">{t("usage.noLogs")}</div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {logs.total > 0 && (
        <div className="flex items-center justify-center gap-4">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            <ChevronLeft className="h-4 w-4 mr-1" /> {t("common.prev")}
          </Button>
          <span className="text-sm text-muted-foreground">{t("common.page")} {page} ({logs.total} {t("common.items")})</span>
          <Button variant="outline" size="sm" disabled={logs.items?.length < 20} onClick={() => setPage(page + 1)}>
            {t("common.next")} <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  )
}
