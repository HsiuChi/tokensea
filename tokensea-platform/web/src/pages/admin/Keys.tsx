import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/services/api";
import { formatQuota, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

interface Token {
  id: string;
  keyPrefix: string;
  userId: string;
  name: string;
  status: string;
  quota: number;
  usedQuota: number;
  requestCount: number;
  createdAt: string;
}

interface TokenList {
  items: Token[];
  total: number;
}

export function AdminKeys() {
  const { t } = useTranslation();
  const [data, setData] = useState<TokenList>({ items: [], total: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(() => {
    setLoading(true);
    api.listTokens(page)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [page]);

  useEffect(() => { fetch(); }, [fetch]);

  const toggleStatus = async (id: string, status: string) => {
    await api.updateToken(id, { status: status === "active" ? "disabled" : "active" });
    fetch();
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("common.confirmDelete"))) return;
    await api.deleteToken(id);
    fetch();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("admin.keys.title")}</h1>
          <p className="text-muted-foreground">{t("admin.keys.totalKeys", { count: data.total })}</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("admin.keys.keyPrefix")}</TableHead>
                <TableHead>{t("admin.keys.user")}</TableHead>
                <TableHead>{t("admin.keys.name")}</TableHead>
                <TableHead>{t("admin.keys.status")}</TableHead>
                <TableHead>{t("admin.keys.quota")}</TableHead>
                <TableHead>{t("admin.keys.requests")}</TableHead>
                <TableHead>{t("common.created")}</TableHead>
                <TableHead>{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-5 w-20" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : data.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">{t("common.noData")}</TableCell>
                </TableRow>
              ) : (
                data.items.map((k) => (
                  <TableRow key={k.id}>
                    <TableCell className="font-mono font-medium">{k.keyPrefix}</TableCell>
                    <TableCell className="text-muted-foreground">{k.userId?.slice(0, 8)}...</TableCell>
                    <TableCell>{k.name}</TableCell>
                    <TableCell>
                      <Badge variant={k.status === "active" ? "success" : "destructive"}>
                        {k.status === "active" ? t("common.active") : t("common.disabled")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatQuota(k.usedQuota)} / {formatQuota(k.quota)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatNumber(Number(k.requestCount))}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{new Date(k.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant={k.status === "active" ? "outline" : "default"}
                          onClick={() => toggleStatus(k.id, k.status)}
                        >
                          {k.status === "active" ? t("common.disable") : t("common.enable")}
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => handleDelete(k.id)}>{t("common.delete")}</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t("common.prev")}</Button>
        <span className="text-sm text-muted-foreground px-2">{page} ({data.total})</span>
        <Button variant="outline" size="sm" disabled={data.items.length < 20} onClick={() => setPage(page + 1)}>{t("common.next")}</Button>
      </div>
    </div>
  );
}
