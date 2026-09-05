import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/services/api";
import { formatQuota } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

interface Redemption {
  id: string;
  code: string;
  name: string;
  quota: number;
  durationDays: number;
  status: string;
  redeemedBy: string;
  createdAt: string;
}

interface RedemptionList {
  items: Redemption[];
  total: number;
}

interface CreateForm {
  name: string;
  quota: string;
  durationDays: string;
}

interface BatchForm {
  name: string;
  quota: string;
  count: string;
  durationDays: string;
}

const emptyCreateForm: CreateForm = { name: "", quota: "", durationDays: "30" };
const emptyBatchForm: BatchForm = { name: "", quota: "", count: "10", durationDays: "30" };

export function AdminRedemptions() {
  const { t } = useTranslation();
  const [data, setData] = useState<RedemptionList>({ items: [], total: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showBatch, setShowBatch] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>({ ...emptyCreateForm });
  const [batchForm, setBatchForm] = useState<BatchForm>({ ...emptyBatchForm });

  const fetch = useCallback(() => {
    setLoading(true);
    api.listRedemptions(page)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [page]);

  useEffect(() => { fetch(); }, [fetch]);

  const handleCreate = async () => {
    await api.createRedemption({
      name: createForm.name,
      quota: createForm.quota ? BigInt(Math.round(Number(createForm.quota) * 100)) : BigInt(0),
      durationDays: Number(createForm.durationDays),
    });
    setShowCreate(false);
    setCreateForm({ ...emptyCreateForm });
    fetch();
  };

  const handleBatchCreate = async () => {
    await api.batchCreateRedemptions({
      name: batchForm.name,
      quota: batchForm.quota ? BigInt(Math.round(Number(batchForm.quota) * 100)) : BigInt(0),
      count: Number(batchForm.count),
      durationDays: Number(batchForm.durationDays),
    });
    setShowBatch(false);
    setBatchForm({ ...emptyBatchForm });
    fetch();
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("admin.redemptions.deleteConfirm"))) return;
    await api.deleteRedemption(id);
    fetch();
  };

  const statusBadge = (status: string) => {
    if (status === "unused") return <Badge variant="success">{t("admin.redemptions.unused")}</Badge>;
    if (status === "redeemed") return <Badge variant="secondary">{t("admin.redemptions.redeemed")}</Badge>;
    return <Badge variant="destructive">{status}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("admin.redemptions.title")}</h1>
          <p className="text-muted-foreground">{t("admin.redemptions.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setBatchForm({ ...emptyBatchForm }); setShowBatch(true); }}>
            {t("admin.redemptions.batchCreate")}
          </Button>
          <Button onClick={() => { setCreateForm({ ...emptyCreateForm }); setShowCreate(true); }}>
            {t("admin.redemptions.createCode")}
          </Button>
        </div>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.redemptions.createCodeTitle")}</DialogTitle>
            <DialogDescription>{t("admin.redemptions.createCodeDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>{t("admin.redemptions.namePrefix")}</Label>
              <Input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>{t("admin.plans.quotaYuan")}</Label>
              <Input type="number" value={createForm.quota} onChange={(e) => setCreateForm({ ...createForm, quota: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>{t("admin.plans.durationDays")}</Label>
              <Input type="number" value={createForm.durationDays} onChange={(e) => setCreateForm({ ...createForm, durationDays: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleCreate}>{t("common.create")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showBatch} onOpenChange={setShowBatch}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.redemptions.batchCreateTitle")}</DialogTitle>
            <DialogDescription>{t("admin.redemptions.batchCreateDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>{t("admin.redemptions.namePrefix")}</Label>
              <Input value={batchForm.name} onChange={(e) => setBatchForm({ ...batchForm, name: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>{t("admin.redemptions.quotaPerCode")}</Label>
              <Input type="number" value={batchForm.quota} onChange={(e) => setBatchForm({ ...batchForm, quota: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>{t("admin.redemptions.numberOfCodes")}</Label>
              <Input type="number" value={batchForm.count} onChange={(e) => setBatchForm({ ...batchForm, count: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>{t("admin.plans.durationDays")}</Label>
              <Input type="number" value={batchForm.durationDays} onChange={(e) => setBatchForm({ ...batchForm, durationDays: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBatch(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleBatchCreate}>{t("admin.redemptions.createCount", { count: Number(batchForm.count) || 0 })}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("admin.redemptions.code")}</TableHead>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("common.quota")}</TableHead>
                <TableHead>{t("admin.redemptions.duration")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead>{t("admin.redemptions.usedBy")}</TableHead>
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
                data.items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono font-medium text-xs">{r.code}</TableCell>
                    <TableCell>{r.name}</TableCell>
                    <TableCell className="text-muted-foreground">{formatQuota(r.quota)}</TableCell>
                    <TableCell className="text-muted-foreground">{r.durationDays} {t("admin.plans.days")}</TableCell>
                    <TableCell>{statusBadge(r.status)}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{r.redeemedBy || "—"}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{new Date(r.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="destructive" onClick={() => handleDelete(r.id)}>{t("common.delete")}</Button>
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
