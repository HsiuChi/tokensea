import { BillingBalance } from "@/components/BillingBalance";
import { useEffect, useState, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { api } from "@/services/api"
import { formatQuota, formatLatency } from "@/lib/utils"
import { ModelName } from "@/components/ModelIcon"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Activity,
  TrendingUp,
  Clock,
  Coins,
  FileText,
} from "lucide-react"

interface RequestLog {
  id: string
  requestId: string
  endpoint: string
  requestedModel: string
  actualUpstreamModel?: string
  status: string
  httpStatus?: number
  inputTokens: number
  outputTokens: number
  billableUnits: bigint | string
  startedAt: string
  finishedAt?: string
  durationMs?: number
  stream: boolean
}

interface LogList {
  items: RequestLog[]
  total: number
  page: number
  pageSize: number
}

interface UsageStats {
  period: string
  quality?: { avgLatencyMs: number | null }
  totals: {
    billedRequests: number
    inputTokens: number
    outputTokens: number
    billableUnits: string
  }
  daily: {
    date: string
    requests: number
    tokens: number
    cost: string
  }[]
}

export function LogsPage() {
  const { t } = useTranslation()
  const [logs, setLogs] = useState<LogList>({ items: [], total: 0, page: 1, pageSize: 20 })
  const [stats, setStats] = useState<UsageStats | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [statsLoading, setStatsLoading] = useState(true)
  const [status, setStatus] = useState("")
  const [model, setModel] = useState("")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")

  const [detail, setDetail] = useState<any>(null)
  const [exporting, setExporting] = useState(false)
  const viewDetail = async (id: string) => {
    try { setDetail(await api.getSelfLogDetail(id)) } catch (e: any) { alert(e.message) }
  }
  const exportLogs = async () => {
    setExporting(true)
    try {
      const params: Record<string,string> = {}
      if(startDate) params.startDate = new Date(startDate + "T00:00:00").toISOString()
      if(endDate) params.endDate = new Date(new Date(endDate + "T00:00:00").getTime() + 86400000).toISOString()
      if(status) params.status = status
      if(model) params.requestedModel = model
      const data = await api.exportSelfLogs(params)
      const url = URL.createObjectURL(new Blob([data.csv], {type:"text/csv;charset=utf-8"}))
      const a = document.createElement("a"); a.href = url; a.download = "tokensea-requests.csv"; a.click()
      setTimeout(()=>URL.revokeObjectURL(url),1000)
      if(data.truncated) alert(data.message)
    } catch(e: any) { alert(e.message) } finally { setExporting(false) }
  }
  const period = new Date().toISOString().slice(0, 7).replace("-", "")

  const fetchLogs = useCallback(() => {
    setLoading(true)
    api.getSelfLogs({
      page,
      status: status || undefined,
      requestedModel: model || undefined,
      startDate: startDate ? new Date(startDate + "T00:00:00").toISOString() : undefined,
      endDate: endDate ? new Date(new Date(endDate + "T00:00:00").getTime() + 86400000).toISOString() : undefined,
    })
      .then((data: any) => {
        const items = data.items || data.data?.items || []
        const total = data.total ?? data.data?.total ?? 0
        setLogs({ items, total, page, pageSize: 20 })
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [page, status, model, startDate, endDate])

  const fetchStats = useCallback(() => {
    setStatsLoading(true)
    api.getSelfStats({ period, startDate: startDate ? new Date(startDate + "T00:00:00").toISOString() : undefined, endDate: endDate ? new Date(new Date(endDate + "T00:00:00").getTime() + 86400000).toISOString() : undefined, status: status || undefined, requestedModel: model || undefined })
      .then((data: any) => {
        setStats(data.data ?? data)
      })
      .catch(console.error)
      .finally(() => setStatsLoading(false))
  }, [period, startDate, endDate, status, model])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  const handleClearFilters = () => {
    setStatus("")
    setModel("")
    setStartDate("")
    setEndDate("")
    setPage(1)
  }

  const totalTokens = stats
    ? stats.totals.inputTokens + stats.totals.outputTokens
    : 0

  return (
    <div className="space-y-6">
      <BillingBalance />
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("logs.title", { defaultValue: "Request Logs" })}</h1>
        <p className="text-muted-foreground">{t("logs.subtitle", { defaultValue: "View your API usage and request history" })}</p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("logs.totalRequests", { defaultValue: "Total Requests" })}</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {statsLoading ? <Skeleton className="h-8 w-20" /> : stats?.totals.billedRequests ?? 0}
            </div>
            <p className="text-xs text-muted-foreground">{stats?.period}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("logs.totalTokens", { defaultValue: "Total Tokens" })}</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {statsLoading ? <Skeleton className="h-8 w-20" /> : totalTokens.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">
              {stats ? `${stats.totals.inputTokens} in / ${stats.totals.outputTokens} out` : "---"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("logs.cost", { defaultValue: "Cost" })}</CardTitle>
            <Coins className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {statsLoading ? <Skeleton className="h-8 w-20" /> : formatQuota(stats?.totals.billableUnits ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground">{t("logs.thisPeriod", { defaultValue: "This period" })}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("logs.avgLatency", { defaultValue: "Avg Latency" })}</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {statsLoading ? <Skeleton className="h-8 w-20" /> : stats?.quality?.avgLatencyMs != null ? formatLatency(stats.quality.avgLatencyMs) : "—"}
            </div>
            <p className="text-xs text-muted-foreground">所选时段成功请求的完整耗时（非首字延迟）</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={status} onValueChange={(v) => { setStatus(v === "__all__" ? "" : v); setPage(1); }}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder={t("logs.allStatus", { defaultValue: "All Status" })} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t("logs.allStatus", { defaultValue: "All Status" })}</SelectItem>
            <SelectItem value="succeeded">{t("common.success", { defaultValue: "Success" })}</SelectItem>
            <SelectItem value="failed">{t("common.failed", { defaultValue: "Failed" })}</SelectItem>
            <SelectItem value="rate_limited">Rate Limited</SelectItem>
            <SelectItem value="timeout">Timeout</SelectItem>
          </SelectContent>
        </Select>

        <Input
          className="max-w-[200px]"
          placeholder={t("logs.filterByModel", { defaultValue: "Filter by model" })}
          value={model}
          onChange={(e) => { setModel(e.target.value); setPage(1); }}
        />

        <div className="flex items-center gap-2">
          <Input
            type="date"
            className="w-[150px]"
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
          />
          <span className="text-muted-foreground text-sm">-</span>
          <Input
            type="date"
            className="w-[150px]"
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
          />
        </div>

        <Button variant="outline" size="sm" disabled={exporting} onClick={exportLogs}>{exporting ? "导出中…" : "导出 CSV（默认近 30 天）"}</Button>
        <Button variant="outline" size="sm" onClick={()=>{fetchLogs();fetchStats()}}>{t("common.refresh", { defaultValue: "Refresh" })}</Button>
        <Button variant="ghost" size="sm" onClick={handleClearFilters}>{t("common.clear", { defaultValue: "Clear" })}</Button>
      </div>

      {/* Log Table */}
      <Card>
        <CardContent className="p-0">
          <ScrollArea className="h-[500px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[160px]">{t("logs.time", { defaultValue: "Time" })}</TableHead>
                  <TableHead>{t("logs.model", { defaultValue: "Model" })}</TableHead>
                  <TableHead>{t("logs.endpoint", { defaultValue: "Endpoint" })}</TableHead>
                  <TableHead className="text-right">{t("logs.tokens", { defaultValue: "Tokens" })}</TableHead>
                  <TableHead className="text-right">{t("logs.cost", { defaultValue: "Cost" })}</TableHead>
                  <TableHead className="text-right">{t("logs.latency", { defaultValue: "Latency" })}</TableHead>
                  <TableHead className="text-center">{t("common.status", { defaultValue: "Status" })}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 7 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-20" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : logs.items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                      <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      {t("common.noData", { defaultValue: "No data" })}
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.items.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(log.startedAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <ModelName model={log.requestedModel} upstreamModel={log.actualUpstreamModel} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{log.endpoint}<Button size="sm" variant="ghost" onClick={()=>viewDetail(log.requestId)}>详情</Button></TableCell>
                      <TableCell className="text-xs text-right text-muted-foreground">
                        {(log.inputTokens || 0) + (log.outputTokens || 0)}
                      </TableCell>
                      <TableCell className="text-xs text-right text-muted-foreground">
                        {formatQuota(log.billableUnits)}
                      </TableCell>
                      <TableCell className="text-xs text-right text-muted-foreground">
                        {log.durationMs ? formatLatency(log.durationMs) : "---"}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant={
                            log.status === "succeeded"
                              ? "success"
                              : log.status === "failed"
                                ? "destructive"
                                : "secondary"
                          }
                          className="text-[10px]"
                        >
                          {log.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>

      <Dialog open={!!detail} onOpenChange={open=>!open && setDetail(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>请求详情与计费明细</DialogTitle></DialogHeader>
          {detail && <div className="space-y-4 text-sm">
            <code className="block break-all text-xs">{detail.requestId}</code>
            <p>{detail.requestedModel} · {detail.endpoint} · HTTP {detail.httpStatus ?? "—"}</p>
            {detail.errorExplanation && <div className="rounded-xl bg-destructive/10 p-3 text-destructive">{detail.errorExplanation}<p className="mt-1 font-mono">{detail.errorCode ?? "未记录错误代码"}</p></div>}
            <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted p-4"><span>输入：{detail.inputTokens}</span><span>输出：{detail.outputTokens}</span><span>缓存读取：{detail.cacheReadTokens}</span><span>缓存写入：{detail.cacheCreationTokens}</span><span>耗时：{detail.durationMs ?? "—"} ms</span><span>扣费：$ {(Number(detail.billableUnits)/1e6).toFixed(6)}</span></div>
            <p className="text-muted-foreground">{detail.billingExplanation}</p>
            {detail.pricingDetail && <div className="space-y-2">
              {detail.pricingDetail.kind === "video" ? <>
                <p>视频计费：{detail.pricingDetail.unit === "second" ? "按秒" : detail.pricingDetail.unit === "video" ? "按视频档位" : "按视频 Tokens"} · 时长 {detail.pricingDetail.seconds} 秒</p>
                <p>基础费用：¥ {detail.pricingDetail.upstreamCny} · 折算汇率：{detail.pricingDetail.cnyPerUsd} CNY/USD</p>
                {detail.pricingDetail.videoTokens != null && <p>实际视频用量：{detail.pricingDetail.videoTokens} Tokens</p>}
              </> : <>
                <p>输入 / 输出单价：$ {detail.pricingDetail.inputPrice} / $ {detail.pricingDetail.outputPrice}（每百万 Tokens）</p>
                <p>缓存读取 / 写入单价：$ {detail.pricingDetail.cacheReadPrice} / $ {detail.pricingDetail.cacheWrite5mPrice}</p>
              </>}
              {detail.pricingDetail.reservedUsd != null && <p>提交时预占：$ {detail.pricingDetail.reservedUsd} · 最终扣费：$ {detail.pricingDetail.costUsd}（预占不重复扣除）</p>}
              <p>套餐倍率：{detail.pricingDetail.planMultiplier ?? "未记录"} · 渠道倍率：{detail.pricingDetail.channelMultiplier ?? "未记录"} · 总倍率：{detail.pricingDetail.billingMultiplier}</p>
              {detail.pricingDetail.longContext && <p>此请求适用长上下文价格。</p>}
              <details><summary className="cursor-pointer text-primary">完整计费快照（含图片用量）</summary><pre className="mt-2 overflow-auto rounded-xl bg-muted p-3 text-xs">{JSON.stringify(detail.pricingDetail,null,2)}</pre></details>
            </div>}
          </div>}
        </DialogContent>
      </Dialog>

      {/* Pagination */}
      <div className="flex items-center justify-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          {t("common.prev", { defaultValue: "Prev" })}
        </Button>
        <span className="text-sm text-muted-foreground px-2">
          {page} / {Math.max(1, Math.ceil(logs.total / logs.pageSize))} ({logs.total})
        </span>
        <Button variant="outline" size="sm" disabled={logs.items.length < logs.pageSize} onClick={() => setPage(page + 1)}>
          {t("common.next", { defaultValue: "Next" })}
        </Button>
      </div>
    </div>
  )
}
