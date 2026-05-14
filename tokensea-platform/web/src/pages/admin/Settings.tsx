import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

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
