import { useEffect, useState, useCallback } from "react"
import { useTranslation } from "react-i18next"
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

  const period = new Date().toISOString().slice(0, 7).replace("-", "")

  const fetchLogs = useCallback(() => {
    setLoading(true)
    api.getSelfLogs({
      page,
      status: status || undefined,
      requestedModel: model || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
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
    api.getSelfStats({ period })
      .then((data: any) => {
        setStats(data.data ?? data)
      })
      .catch(console.error)
      .finally(() => setStatsLoading(false))
  }, [period])

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
              {loading ? <Skeleton className="h-8 w-20" /> : (
                logs.items.length > 0
                  ? formatLatency(
                      Math.round(
                        logs.items.reduce((sum, l) => sum + (l.durationMs || 0), 0) / logs.items.length
                      )
                    )
                  : "---"
              )}
            </div>
            <p className="text-xs text-muted-foreground">{t("logs.last20", { defaultValue: "Last 20 requests" })}</p>
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

        <Button variant="outline" size="sm" onClick={fetchLogs}>{t("common.refresh", { defaultValue: "Refresh" })}</Button>
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
                      <TableCell className="text-xs text-muted-foreground">{log.endpoint}</TableCell>
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
