import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/services/api";
import { formatQuota, formatLatency } from "@/lib/utils";
import { ModelName } from "@/components/ModelIcon";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

interface LogEntry {
  id: string;
  createdAt: string;
  userId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  latencyMs: number;
  status: string;
  nodeId: string;
}

interface AuditEntry {
  id: string;
  createdAt: string;
  operatorId: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: string;
}

interface LogList {
  items: LogEntry[];
  total: number;
}

interface AuditList {
  items: AuditEntry[];
  total: number;
}

export function AdminLogs() {
  const { t } = useTranslation();
  const [tab, setTab] = useState("requests");
  const [data, setData] = useState<LogList | AuditList>({ items: [], total: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState("");
  const [status, setStatus] = useState("");
  const [model, setModel] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const fetchRequests = useCallback(() => {
    setLoading(true);
    api.getLogs({
      page,
      userId: userId || undefined,
      status: status || undefined,
      requestedModel: model || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    })
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [page, userId, status, model, startDate, endDate]);

  const fetchAudit = useCallback(() => {
    setLoading(true);
    api.getAuditLogs(page)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [page]);

  useEffect(() => {
    if (tab === "requests") fetchRequests();
    else fetchAudit();
  }, [tab, fetchRequests, fetchAudit]);

  const handleClearFilters = () => {
    setUserId("");
    setStatus("");
    setModel("");
    setStartDate("");
    setEndDate("");
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("admin.logs.title")}</h1>
        <p className="text-muted-foreground">{t("admin.logs.subtitle")}</p>
      </div>

      <Tabs value={tab} onValueChange={(v) => { setTab(v); setPage(1); }}>
        <TabsList>
          <TabsTrigger value="requests">{t("admin.logs.requestLogs")}</TabsTrigger>
          <TabsTrigger value="audit">{t("admin.logs.auditLogs")}</TabsTrigger>
        </TabsList>

        <TabsContent value="requests" className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              className="max-w-[200px]"
              placeholder={t("admin.logs.filterByUserId")}
              value={userId}
              onChange={(e) => { setUserId(e.target.value); setPage(1); }}
            />
            <Select value={status} onValueChange={(v) => { setStatus(v === "__all__" ? "" : v); setPage(1); }}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder={t("admin.logs.allStatus")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t("admin.logs.allStatus")}</SelectItem>
                <SelectItem value="success">{t("common.success")}</SelectItem>
                <SelectItem value="failed">{t("common.failed")}</SelectItem>
                <SelectItem value="rate_limited">Rate Limited</SelectItem>
              </SelectContent>
            </Select>
            <Input
              className="max-w-[200px]"
              placeholder={t("admin.logs.filterByModel")}
              value={model}
              onChange={(e) => { setModel(e.target.value); setPage(1); }}
            />
            <div className="flex items-center gap-2">
              <Input
                type="date"
                className="w-[150px]"
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
                placeholder={t("admin.logs.startDate")}
              />
              <span className="text-muted-foreground text-sm">-</span>
              <Input
                type="date"
                className="w-[150px]"
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
                placeholder={t("admin.logs.endDate")}
              />
            </div>
            <Button variant="outline" size="sm" onClick={fetchRequests}>{t("common.refresh")}</Button>
            <Button variant="ghost" size="sm" onClick={handleClearFilters}>{t("common.clear")}</Button>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>{t("admin.logs.user")}</TableHead>
                    <TableHead>{t("admin.logs.model")}</TableHead>
                    <TableHead>{t("admin.logs.tokens")}</TableHead>
                    <TableHead>{t("admin.logs.cost")}</TableHead>
                    <TableHead>{t("admin.logs.latency")}</TableHead>
                    <TableHead>{t("common.status")}</TableHead>
                    <TableHead>{t("admin.logs.node")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 8 }).map((_, j) => (
                          <TableCell key={j}><Skeleton className="h-4 w-20" /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : (data as LogList).items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">{t("common.noData")}</TableCell>
                    </TableRow>
                  ) : (
                    (data as LogList).items.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="text-xs text-muted-foreground">{new Date(log.createdAt).toLocaleString()}</TableCell>
                        <TableCell className="text-xs">{log.userId?.slice(0, 8)}...</TableCell>
                        <TableCell><ModelName model={log.model} /></TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {log.promptTokens || 0}+{log.completionTokens || 0}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatQuota(log.cost)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{log.latencyMs ? formatLatency(log.latencyMs) : "---"}</TableCell>
                        <TableCell>
                          <Badge variant={log.status === "success" ? "success" : "destructive"}>{log.status}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{log.nodeId?.slice(0, 8) || "---"}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit" className="space-y-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>{t("admin.logs.operator")}</TableHead>
                    <TableHead>{t("admin.logs.action")}</TableHead>
                    <TableHead>{t("admin.logs.target")}</TableHead>
                    <TableHead>{t("admin.logs.detail")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 5 }).map((_, j) => (
                          <TableCell key={j}><Skeleton className="h-4 w-20" /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : (data as AuditList).items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">{t("common.noData")}</TableCell>
                    </TableRow>
                  ) : (
                    (data as AuditList).items.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="text-xs text-muted-foreground">{new Date(log.createdAt).toLocaleString()}</TableCell>
                        <TableCell className="text-xs">{log.operatorId?.slice(0, 8)}...</TableCell>
                        <TableCell><Badge variant="secondary">{log.action}</Badge></TableCell>
                        <TableCell className="text-xs">{log.targetType}:{log.targetId?.slice(0, 8)}</TableCell>
                        <TableCell className="max-w-[300px] truncate text-xs text-muted-foreground">{log.detail || "---"}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="flex items-center justify-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t("common.prev")}</Button>
        <span className="text-sm text-muted-foreground px-2">{page} ({data.total})</span>
        <Button variant="outline" size="sm" disabled={data.items.length < 20} onClick={() => setPage(page + 1)}>{t("common.next")}</Button>
      </div>
    </div>
  );
}
