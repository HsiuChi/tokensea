import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/services/api";
import { formatQuota } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

interface Plan {
  id: string;
  name: string;
  description: string;
  price: number;
  quota: number;
  durationDays: number;
  maxKeys: number;
  maxRequestsPerDay: number | null;
  models: string[];
  status: string;
}

interface PlanForm {
  name: string;
  description: string;
  price: string;
  quota: string;
  durationDays: string;
  maxKeys: string;
  maxRequestsPerDay: string;
  models: string;
}

const emptyForm: PlanForm = {
  name: "", description: "", price: "", quota: "",
  durationDays: "30", maxKeys: "5", maxRequestsPerDay: "", models: "",
};

export function AdminPlans() {
  const { t } = useTranslation();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<PlanForm>({ ...emptyForm });

  const fetch = useCallback(() => {
    setLoading(true);
    api.listPlans()
      .then(setPlans)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const handleCreate = async () => {
    await api.createPlan({
      name: form.name,
      description: form.description,
      price: form.price ? BigInt(Math.round(Number(form.price) * 100)) : BigInt(0),
      quota: form.quota ? BigInt(Math.round(Number(form.quota) * 100)) : BigInt(0),
      durationDays: Number(form.durationDays),
      maxKeys: Number(form.maxKeys),
      maxRequestsPerDay: form.maxRequestsPerDay ? Number(form.maxRequestsPerDay) : null,
      models: form.models ? form.models.split(",").map((s) => s.trim()) : [],
    });
    setShowCreate(false);
    setForm({ ...emptyForm });
    fetch();
  };

  const handleUpdate = async () => {
    await api.updatePlan(editId!, {
      name: form.name,
      description: form.description,
      price: form.price ? BigInt(Math.round(Number(form.price) * 100)) : BigInt(0),
      quota: form.quota ? BigInt(Math.round(Number(form.quota) * 100)) : BigInt(0),
      durationDays: Number(form.durationDays),
      maxKeys: Number(form.maxKeys),
      maxRequestsPerDay: form.maxRequestsPerDay ? Number(form.maxRequestsPerDay) : null,
      models: form.models ? form.models.split(",").map((s) => s.trim()) : [],
    });
    setEditId(null);
    setForm({ ...emptyForm });
    fetch();
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("admin.plans.deleteConfirm"))) return;
    await api.deletePlan(id);
    fetch();
  };

  const startEdit = (p: Plan) => {
    setEditId(p.id);
    setForm({
      name: p.name || "",
      description: p.description || "",
      price: (Number(p.price) / 100).toString(),
      quota: (Number(p.quota) / 100).toString(),
      durationDays: p.durationDays?.toString() || "30",
      maxKeys: p.maxKeys?.toString() || "5",
      maxRequestsPerDay: p.maxRequestsPerDay?.toString() || "",
      models: p.models?.join(", ") || "",
    });
  };

  const openCreate = () => {
    setForm({ ...emptyForm });
    setEditId(null);
    setShowCreate(true);
  };

  const dialogOpen = showCreate || editId !== null;
  const setDialogOpen = (open: boolean) => {
    if (!open) {
      setShowCreate(false);
      setEditId(null);
      setForm({ ...emptyForm });
    }
  };

  const fields: { key: keyof PlanForm; label: string; type: string }[] = [
    { key: "name", label: t("admin.plans.planName"), type: "text" },
    { key: "description", label: t("admin.plans.description"), type: "text" },
    { key: "price", label: t("admin.plans.priceYuan"), type: "number" },
    { key: "quota", label: t("admin.plans.quotaYuan"), type: "number" },
    { key: "durationDays", label: t("admin.plans.durationDays"), type: "number" },
    { key: "maxKeys", label: t("admin.plans.maxKeys"), type: "number" },
    { key: "maxRequestsPerDay", label: t("admin.plans.maxRequestsPerDay"), type: "number" },
    { key: "models", label: t("admin.plans.models"), type: "text" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("admin.plans.title")}</h1>
          <p className="text-muted-foreground">{t("admin.plans.subtitle")}</p>
        </div>
        <Button onClick={openCreate}>{t("admin.plans.createPlan")}</Button>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editId ? t("admin.plans.editPlan") : t("admin.plans.createPlanTitle")}</DialogTitle>
            <DialogDescription>{editId ? t("admin.plans.editPlanDesc") : t("admin.plans.createPlanDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {fields.map((f) => (
              <div key={f.key} className="grid gap-2">
                <Label>{f.label}</Label>
                <Input
                  type={f.type}
                  value={form[f.key]}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={editId ? handleUpdate : handleCreate}>
              {editId ? t("common.update") : t("common.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}><CardContent className="p-6"><Skeleton className="h-40" /></CardContent></Card>
          ))}
        </div>
      ) : plans.length === 0 ? (
        <div className="py-10 text-center text-muted-foreground">{t("common.noData")}</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((p) => (
            <Card key={p.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{p.name}</CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">{p.description || ""}</p>
                  </div>
                  <Badge variant={p.status === "active" ? "success" : "destructive"}>
                    {p.status === "active" ? t("common.active") : t("common.disabled")}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tracking-tight mb-3">
                  {formatQuota(p.price)}
                  <span className="text-sm font-normal text-muted-foreground"> / {p.durationDays} {t("admin.plans.days")}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground mb-4">
                  <div>{t("common.quota")}: {formatQuota(p.quota)}</div>
                  <div>{t("admin.plans.maxKeys")}: {p.maxKeys}</div>
                  <div>{t("admin.plans.maxReqDay")}: {p.maxRequestsPerDay || t("common.unlimited")}</div>
                  <div>{t("admin.plans.models")}: {p.models?.length || 0}</div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => startEdit(p)}>{t("common.edit")}</Button>
                  <Button size="sm" variant="destructive" onClick={() => handleDelete(p.id)}>{t("common.delete")}</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
