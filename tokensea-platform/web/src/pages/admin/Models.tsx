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

interface Route {
  id: string;
  channelId: string;
  upstreamModel: string;
  weight: number;
  priority: number;
}

interface Model {
  id: string;
  alias: string;
  description: string;
  inputPrice: number;
  outputPrice: number;
  routes: Route[];
}

interface ModelForm {
  alias: string;
  displayName: string;
  provider: string;
  description: string;
  category: string;
  tags: string;
  inputPrice: string;
  outputPrice: string;
  supportsStream: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  maxContext: string;
  sortOrder: string;
}

interface RouteForm {
  channelId: string;
  upstreamModel: string;
  weight: string;
  priority: string;
}

const emptyModelForm: ModelForm = { alias: "", displayName: "", provider: "anthropic", description: "", category: "chat", tags: "", inputPrice: "", outputPrice: "", supportsStream: true, supportsTools: true, supportsVision: false, maxContext: "200000", sortOrder: "0" };
const emptyRouteForm: RouteForm = { channelId: "", upstreamModel: "", weight: "1", priority: "0" };

export function AdminModels() {
  const { t } = useTranslation();
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showRoute, setShowRoute] = useState<string | null>(null);
  const [modelForm, setModelForm] = useState<ModelForm>({ ...emptyModelForm });
  const [routeForm, setRouteForm] = useState<RouteForm>({ ...emptyRouteForm });

  const fetch = useCallback(() => {
    setLoading(true);
    api.listAdminModels()
      .then(setModels)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const handleCreate = async () => {
    await api.createModel({
      alias: modelForm.alias,
      displayName: modelForm.displayName || modelForm.alias,
      provider: modelForm.provider,
      description: modelForm.description || undefined,
      category: modelForm.category,
      tags: modelForm.tags ? modelForm.tags.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
      inputPrice: modelForm.inputPrice ? Number(modelForm.inputPrice) : 0,
      outputPrice: modelForm.outputPrice ? Number(modelForm.outputPrice) : 0,
      supportsStream: modelForm.supportsStream,
      supportsTools: modelForm.supportsTools,
      supportsVision: modelForm.supportsVision,
      maxContext: Number(modelForm.maxContext) || 200000,
      sortOrder: Number(modelForm.sortOrder) || 0,
    });
    setShowCreate(false);
    setModelForm({ ...emptyModelForm });
    fetch();
  };

  const handleAddRoute = async (aliasId: string) => {
    await api.createModelRoute(aliasId, {
      channelId: routeForm.channelId,
      upstreamModel: routeForm.upstreamModel,
      weight: Number(routeForm.weight),
      priority: Number(routeForm.priority),
    });
    setShowRoute(null);
    setRouteForm({ ...emptyRouteForm });
    fetch();
  };

  const handleDeleteRoute = async (id: string) => {
    if (!confirm(t("admin.models.deleteRoute"))) return;
    await api.deleteModelRoute(id);
    fetch();
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("admin.models.deleteModel"))) return;
    await api.deleteModel(id);
    fetch();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("admin.models.title")}</h1>
          <p className="text-muted-foreground">{t("admin.models.subtitle")}</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>{t("admin.models.addModel")}</Button>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.models.addModelAlias")}</DialogTitle>
            <DialogDescription>{t("admin.models.addModelDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>{t("admin.models.modelAlias")}</Label>
                <Input placeholder="e.g. claude-sonnet-4-20250514" value={modelForm.alias} onChange={(e) => setModelForm({ ...modelForm, alias: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Display Name</Label>
                <Input placeholder="e.g. Claude Sonnet 4" value={modelForm.displayName} onChange={(e) => setModelForm({ ...modelForm, displayName: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Provider</Label>
                <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm" value={modelForm.provider} onChange={(e) => setModelForm({ ...modelForm, provider: e.target.value })}>
                  <option value="anthropic">Anthropic</option>
                  <option value="openai">OpenAI</option>
                  <option value="google">Google</option>
                  <option value="deepseek">DeepSeek</option>
                  <option value="codex">Codex</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div className="grid gap-2">
                <Label>Category</Label>
                <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm" value={modelForm.category} onChange={(e) => setModelForm({ ...modelForm, category: e.target.value })}>
                  <option value="chat">Chat</option>
                  <option value="code">Code</option>
                  <option value="vision">Vision</option>
                  <option value="embedding">Embedding</option>
                  <option value="audio">Audio</option>
                  <option value="image">Image</option>
                </select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>{t("admin.models.description")}</Label>
              <Input placeholder="Brief description for marketplace" value={modelForm.description} onChange={(e) => setModelForm({ ...modelForm, description: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>Tags (comma separated)</Label>
              <Input placeholder="e.g. fast, cheap, reasoning" value={modelForm.tags} onChange={(e) => setModelForm({ ...modelForm, tags: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>{t("admin.models.inputPrice")}</Label>
                <Input type="number" placeholder="cents per 1K tokens" value={modelForm.inputPrice} onChange={(e) => setModelForm({ ...modelForm, inputPrice: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>{t("admin.models.outputPrice")}</Label>
                <Input type="number" placeholder="cents per 1K tokens" value={modelForm.outputPrice} onChange={(e) => setModelForm({ ...modelForm, outputPrice: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Max Context</Label>
                <Input type="number" value={modelForm.maxContext} onChange={(e) => setModelForm({ ...modelForm, maxContext: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Sort Order</Label>
                <Input type="number" value={modelForm.sortOrder} onChange={(e) => setModelForm({ ...modelForm, sortOrder: e.target.value })} />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={modelForm.supportsStream} onChange={(e) => setModelForm({ ...modelForm, supportsStream: e.target.checked })} /> Streaming
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={modelForm.supportsTools} onChange={(e) => setModelForm({ ...modelForm, supportsTools: e.target.checked })} /> Tool Use
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={modelForm.supportsVision} onChange={(e) => setModelForm({ ...modelForm, supportsVision: e.target.checked })} /> Vision
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleCreate}>{t("common.create")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showRoute !== null} onOpenChange={(open) => { if (!open) setShowRoute(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.models.addRouteTitle")}</DialogTitle>
            <DialogDescription>{t("admin.models.addRouteDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>{t("admin.models.channelId")}</Label>
              <Input value={routeForm.channelId} onChange={(e) => setRouteForm({ ...routeForm, channelId: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>{t("admin.models.upstreamModel")}</Label>
              <Input value={routeForm.upstreamModel} onChange={(e) => setRouteForm({ ...routeForm, upstreamModel: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>{t("admin.channels.weight")}</Label>
                <Input type="number" value={routeForm.weight} onChange={(e) => setRouteForm({ ...routeForm, weight: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>{t("admin.models.priority")}</Label>
                <Input type="number" value={routeForm.priority} onChange={(e) => setRouteForm({ ...routeForm, priority: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRoute(null)}>{t("common.cancel")}</Button>
            <Button onClick={() => handleAddRoute(showRoute!)}>{t("admin.models.addRoute")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}><CardContent className="p-6"><Skeleton className="h-24" /></CardContent></Card>
          ))}
        </div>
      ) : models.length === 0 ? (
        <div className="py-10 text-center text-muted-foreground">{t("common.noData")}</div>
      ) : (
        <div className="space-y-4">
          {models.map((m) => (
            <Card key={m.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="font-mono text-lg">{m.alias}</CardTitle>
                    <p className="text-sm text-muted-foreground">{m.description || ""}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      In: {formatQuota(m.inputPrice)} · Out: {formatQuota(m.outputPrice)}
                    </span>
                    <Button size="sm" variant="outline" onClick={() => { setRouteForm({ ...emptyRouteForm }); setShowRoute(m.id); }}>
                      {t("admin.models.addRoute")}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => handleDelete(m.id)}>{t("common.delete")}</Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {m.routes?.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {m.routes.map((r) => (
                      <Badge key={r.id} variant="secondary" className="gap-1 py-1.5 px-3">
                        <span className="font-mono">{r.upstreamModel}</span>
                        <span className="text-muted-foreground">ch:{r.channelId?.slice(0, 6)}...</span>
                        <span className="text-muted-foreground">w:{r.weight}</span>
                        <button
                          onClick={() => handleDeleteRoute(r.id)}
                          className="ml-1 text-destructive hover:text-destructive/80 font-bold"
                        >
                          x
                        </button>
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("admin.models.noRoutes")}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
