import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, Send } from "lucide-react";

const WEBHOOK_EVENTS = ["*", "node.unhealthy", "node.degraded", "node.recovered", "node.oauth_expired"];

interface WebhookRow {
  id: string;
  url: string;
  events: string[];
  secret?: string | null;
  status: string;
}

interface WebhookForm {
  url: string;
  secret: string;
  events: string[];
}

const emptyWebhookForm: WebhookForm = { url: "", secret: "", events: ["*"] };

interface SettingsSection {
  title: string;
  fields: { key: string; label: string; placeholder: string }[];
}

export function AdminSettings() {
  const { t } = useTranslation();
  const [options, setOptions] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getOptions()
      .then(setOptions)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await api.updateOptions(options);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: any) {
      alert(`Save failed: ${e.message}`);
    }
    setSaving(false);
  };

  const handleChange = (key: string, value: string) => {
    setOptions((prev) => ({ ...prev, [key]: value }));
  };

  // Webhooks
  const [webhooks, setWebhooks] = useState<WebhookRow[]>([]);
  const [webhooksLoading, setWebhooksLoading] = useState(true);
  const [showWebhookDialog, setShowWebhookDialog] = useState(false);
  const [editingWebhookId, setEditingWebhookId] = useState<string | null>(null);
  const [webhookForm, setWebhookForm] = useState<WebhookForm>({ ...emptyWebhookForm });
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState<string | null>(null);

  const fetchWebhooks = useCallback(() => {
    setWebhooksLoading(true);
    api.listWebhooks()
      .then((r: any) => setWebhooks(r.items || r || []))
      .catch(console.error)
      .finally(() => setWebhooksLoading(false));
  }, []);

  useEffect(() => { fetchWebhooks(); }, [fetchWebhooks]);

  const openWebhookDialog = (w?: WebhookRow) => {
    setEditingWebhookId(w?.id ?? null);
    setWebhookForm(w ? { url: w.url, secret: w.secret || "", events: w.events || [] } : { ...emptyWebhookForm });
    setShowWebhookDialog(true);
  };

  const toggleWebhookEvent = (ev: string) => {
    setWebhookForm((prev) => {
      const has = prev.events.includes(ev);
      if (ev === "*") return { ...prev, events: has ? [] : ["*"] };
      const rest = prev.events.filter((e) => e !== "*");
      return { ...prev, events: has ? rest.filter((e) => e !== ev) : [...rest, ev] };
    });
  };

  const handleSaveWebhook = async () => {
    setSavingWebhook(true);
    try {
      const body: any = { url: webhookForm.url, events: webhookForm.events.length ? webhookForm.events : ["*"] };
      if (webhookForm.secret) body.secret = webhookForm.secret;
      if (editingWebhookId) await api.updateWebhook(editingWebhookId, body);
      else await api.createWebhook(body);
      setShowWebhookDialog(false);
      fetchWebhooks();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSavingWebhook(false);
    }
  };

  const handleTestWebhook = async (id: string) => {
    setTestingWebhook(id);
    try {
      const r = await api.testWebhook(id);
      alert(r?.ok ? `${t("admin.webhooks.testOk")} (${r.latencyMs}ms)` : `${t("admin.webhooks.testFail")}: ${r?.error ?? r?.status}`);
    } catch (e: any) {
      alert(`${t("admin.webhooks.testFail")}: ${e.message}`);
    }
    setTestingWebhook(null);
  };

  const handleDeleteWebhook = async (id: string) => {
    if (!confirm(t("common.confirmDelete"))) return;
    try { await api.deleteWebhook(id); fetchWebhooks(); } catch (e: any) { alert(e.message); }
  };

  const toggleWebhookStatus = async (w: WebhookRow) => {
    try { await api.updateWebhook(w.id, { status: w.status === "active" ? "disabled" : "active" }); fetchWebhooks(); } catch (e: any) { alert(e.message); }
  };

  const sections: SettingsSection[] = [
    {
      title: t("admin.settings.general"),
      fields: [
        { key: "site_name", label: t("admin.settings.siteName"), placeholder: "TokenSea" },
        { key: "site_url", label: t("admin.settings.siteUrl"), placeholder: "https://api.tokensea.com" },
        { key: "site_description", label: t("admin.settings.siteDescription"), placeholder: "AI API Gateway" },
        { key: "register_enabled", label: t("admin.settings.registrationEnabled"), placeholder: "true / false" },
        { key: "default_quota", label: t("admin.settings.defaultQuota"), placeholder: "0" },
      ],
    },
    {
      title: t("admin.settings.email"),
      fields: [
        { key: "smtp_host", label: t("admin.settings.smtpHost"), placeholder: "" },
        { key: "smtp_port", label: t("admin.settings.smtpPort"), placeholder: "587" },
        { key: "smtp_user", label: t("admin.settings.smtpUser"), placeholder: "" },
        { key: "smtp_pass", label: t("admin.settings.smtpPassword"), placeholder: "" },
        { key: "email_from", label: t("admin.settings.fromAddress"), placeholder: "noreply@tokensea.com" },
      ],
    },
    {
      title: t("admin.settings.rateLimiting"),
      fields: [
        { key: "global_rpm", label: t("admin.settings.globalRpm"), placeholder: "60" },
        { key: "global_tpm", label: t("admin.settings.globalTpm"), placeholder: "100000" },
        { key: "per_key_rpm", label: t("admin.settings.perKeyRpm"), placeholder: "20" },
      ],
    },
    {
      title: t("admin.settings.proxyRouting"),
      fields: [
        { key: "relay_timeout", label: t("admin.settings.relayTimeout"), placeholder: "120000" },
        { key: "max_retries", label: t("admin.settings.maxRetries"), placeholder: "3" },
        { key: "session_affinity_ttl", label: t("admin.settings.sessionAffinityTtl"), placeholder: "14400" },
        { key: "cooldown_ttl", label: t("admin.settings.cooldownTtl"), placeholder: "300" },
      ],
    },
  ];

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-10 w-24" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}><CardContent className="p-6"><Skeleton className="h-40" /></CardContent></Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("admin.settings.title")}</h1>
          <p className="text-muted-foreground">{t("admin.settings.subtitle")}</p>
        </div>
        <div className="flex items-center gap-3">
          {saved && <span className="text-sm font-medium text-emerald-600">{t("common.saved")}</span>}
          <Button onClick={handleSave} disabled={saving}>
            {saving ? t("common.saving") : t("common.saveAll")}
          </Button>
        </div>
      </div>

      {/* Webhooks */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t("admin.webhooks.title")}</CardTitle>
              <p className="text-sm text-muted-foreground">{t("admin.webhooks.subtitle")}</p>
            </div>
            <Button size="sm" onClick={() => openWebhookDialog()}>
              <Plus className="mr-1 h-4 w-4" /> {t("admin.webhooks.add")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>URL</TableHead>
                <TableHead>{t("admin.webhooks.events")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead>{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {webhooksLoading ? (
                Array.from({ length: 2 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 4 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-5 w-20" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : webhooks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-20 text-center text-muted-foreground">{t("common.noData")}</TableCell>
                </TableRow>
              ) : (
                webhooks.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell className="font-mono text-xs max-w-[280px] truncate">{w.url}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(w.events || []).map((ev) => <Badge key={ev} variant="secondary" className="text-[10px]">{ev}</Badge>)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <button onClick={() => toggleWebhookStatus(w)}>
                        <Badge variant={w.status === "active" ? "success" : "secondary"}>
                          {w.status === "active" ? t("common.active") : t("common.disabled")}
                        </Badge>
                      </button>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="outline" disabled={testingWebhook === w.id} onClick={() => handleTestWebhook(w.id)}>
                          <Send className="mr-1 h-3 w-3" /> {testingWebhook === w.id ? "..." : t("admin.webhooks.test")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => openWebhookDialog(w)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDeleteWebhook(w.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Webhook dialog */}
      <Dialog open={showWebhookDialog} onOpenChange={(open) => { if (!open) { setShowWebhookDialog(false); setEditingWebhookId(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingWebhookId ? t("admin.webhooks.edit") : t("admin.webhooks.add")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>URL</Label>
              <Input value={webhookForm.url} onChange={(e) => setWebhookForm({ ...webhookForm, url: e.target.value })} placeholder="https://hooks.example.com/tokensea" />
            </div>
            <div className="space-y-2">
              <Label>{t("admin.webhooks.secret")}</Label>
              <Input value={webhookForm.secret} onChange={(e) => setWebhookForm({ ...webhookForm, secret: e.target.value })} placeholder="HMAC-SHA256 signing secret (optional)" />
              <p className="text-xs text-muted-foreground">{t("admin.webhooks.secretHint")}</p>
            </div>
            <div className="space-y-2">
              <Label>{t("admin.webhooks.events")}</Label>
              <div className="flex flex-col gap-2">
                {WEBHOOK_EVENTS.map((ev) => (
                  <label key={ev} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={webhookForm.events.includes(ev)} onChange={() => toggleWebhookEvent(ev)} />
                    <span className="font-mono text-xs">{ev}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowWebhookDialog(false); setEditingWebhookId(null); }}>{t("common.cancel")}</Button>
            <Button onClick={handleSaveWebhook} disabled={savingWebhook}>{savingWebhook ? t("common.loading") : t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="space-y-6">
        {sections.map((section) => (
          <Card key={section.title}>
            <CardHeader>
              <CardTitle>{section.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                {section.fields.map((f) => (
                  <div key={f.key} className="grid gap-2">
                    <Label>{f.label}</Label>
                    <Input
                      value={options[f.key] || ""}
                      placeholder={f.placeholder}
                      onChange={(e) => handleChange(f.key, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
