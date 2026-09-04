import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/services/api";
import { formatNumber, formatQuota } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { VChart } from "@visactor/react-vchart";

interface GlobalStats {
  totalUsers: number;
  activeUsers: number;
  totalKeys: number;
  activeKeys: number;
  totalRequests: number;
  todayRequests: number;
  totalRevenue: number;
  nodes: { id: string; name: string; channel: string; status: string; currentLoad: number; maxConcurrent: number }[];
  byModel?: { model: string; requests: number; inputTokens: number; outputTokens: number; billableUnits: string }[];
  byChannel?: { channelId: string; channel: string; requests: number; inputTokens: number; outputTokens: number; billableUnits: string }[];
  byDay?: { date: string; requests: number; billableUnits: string; inputTokens: number; outputTokens: number }[];
}

export function AdminDashboard() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.getGlobalStats()
      .then(setStats)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="mt-2 h-5 w-64" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="p-6"><Skeleton className="h-20" /></CardContent></Card>
          ))}
        </div>
        <Card><CardContent className="p-6"><Skeleton className="h-40" /></CardContent></Card>
      </div>
    );
  }

  if (error || !stats) {
    return <div className="p-10 text-center text-destructive">{t("common.failed")}</div>;
  }

  const statCards = [
    { label: t("admin.dashboard.totalUsers"), value: formatNumber(stats.totalUsers), sub: t("admin.dashboard.active", { count: stats.activeUsers }) },
    { label: t("admin.dashboard.apiKeys"), value: formatNumber(stats.totalKeys), sub: t("admin.dashboard.active", { count: stats.activeKeys }) },
    { label: t("admin.dashboard.totalRequests"), value: formatNumber(stats.totalRequests), sub: t("admin.dashboard.today", { count: stats.todayRequests }) },
    { label: t("admin.dashboard.totalRevenue"), value: formatQuota(stats.totalRevenue), sub: t("admin.dashboard.allTime") },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("admin.dashboard.title")}</h1>
        <p className="text-muted-foreground">{t("admin.dashboard.subtitle")}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{s.value}</div>
              <p className="text-xs text-muted-foreground">{s.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("admin.dashboard.upstreamNodes")}</CardTitle>
        </CardHeader>
        <CardContent>
          {stats.nodes?.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("admin.dashboard.noNodes")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("common.name")}</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>{t("common.status")}</TableHead>
                  <TableHead>{t("admin.dashboard.load")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.nodes?.map((n) => (
                  <TableRow key={n.id}>
                    <TableCell className="font-medium">{n.name}</TableCell>
                    <TableCell className="text-muted-foreground">{n.channel}</TableCell>
                    <TableCell>
                      <Badge variant={n.status === "healthy" ? "success" : n.status === "degraded" ? "warning" : "destructive"}>
                        {n.status === "healthy" ? t("common.healthy") : n.status === "degraded" ? t("common.degraded") : t("common.unhealthy")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{n.currentLoad}/{n.maxConcurrent}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Charts: by model / by channel / by day */}
      <div className="grid gap-4 lg:grid-cols-2">
        {stats.byModel && stats.byModel.length > 0 && (
          <Card>
            <CardHeader><CardTitle>{t("admin.dashboard.byModel") || "Requests by Model"}</CardTitle></CardHeader>
            <CardContent>
              <VChart
                spec={{
                  type: "pie",
                  data: [{ values: stats.byModel.map((m) => ({ name: m.model, value: m.requests })) }],
                  valueField: "value", categoryField: "name",
                  label: { visible: true },
                  legends: { visible: true, orient: "right" },
                  tooltip: { visible: true },
                  height: 280,
                }}
              />
            </CardContent>
          </Card>
        )}
        {stats.byChannel && stats.byChannel.length > 0 && (
          <Card>
            <CardHeader><CardTitle>{t("admin.dashboard.byChannel") || "Cost by Channel"}</CardTitle></CardHeader>
            <CardContent>
              <VChart
                spec={{
                  type: "bar",
                  data: [{ values: stats.byChannel.map((c) => ({ name: c.channel, cost: Number(c.billableUnits) / 1_000_000 })) }],
                  xField: "name", yField: "cost",
                  label: { visible: true },
                  tooltip: { visible: true },
                  height: 280,
                }}
              />
            </CardContent>
          </Card>
        )}
        {stats.byDay && stats.byDay.length > 0 && (
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>{t("admin.dashboard.trend") || "Daily Request Trend"}</CardTitle></CardHeader>
            <CardContent>
              <VChart
                spec={{
                  type: "line",
                  data: [{ values: stats.byDay.map((d) => ({ date: d.date, requests: d.requests })) }],
                  xField: "date", yField: "requests",
                  point: { visible: true },
                  tooltip: { visible: true },
                  height: 280,
                }}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
