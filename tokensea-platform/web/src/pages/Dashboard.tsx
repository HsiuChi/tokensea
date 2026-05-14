import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/services/api"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { formatQuota } from "@/lib/utils"
import { VChart } from "@visactor/react-vchart"
import {
  Wallet, Zap, Cpu, Crown, Eye, Key, ChevronRight, Code2, BarChart3, Tag, CreditCard, BookOpen,
} from "lucide-react"

const quickLinks = [
  { labelKey: "nav.keys", icon: Key, path: "/app/keys" },
  { labelKey: "nav.usage", icon: BarChart3, path: "/app/usage" },
  { labelKey: "nav.pricing", icon: Tag, path: "/pricing" },
  { labelKey: "nav.topup", icon: CreditCard, path: "/app/topup" },
  { labelKey: "nav.marketplace", icon: Cpu, path: "/app/marketplace" },
]

export function DashboardPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [keys, setKeys] = useState<any[]>([])
  const [models, setModels] = useState<any[]>([])
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.listTokens(1, 100).then((d) => setKeys(d.items || [])).catch(() => {}),
      api.listModels().then((d) => setModels(d.data || [])).catch(() => {}),
      api.getSelfStats({ period: "7d" }).then((d) => setStats(d.data ?? d)).catch(() => {}),
    ]).finally(() => setLoading(false))
  }, [])

  const quotaUsed = Number(user?.usedQuota || 0)
  const quotaTotal = Number(user?.quota || 0)
  const quotaPercent = quotaTotal > 0 ? Math.min((quotaUsed / quotaTotal) * 100, 100) : 0
  const activeKeys = keys.filter((k) => k.status === "active").length
  const isAdmin = user?.role === "admin" || user?.role === "root"

  const statCards = [
    {
      title: t("dashboard.quotaBalance"),
      value: quotaTotal >= 0 ? formatQuota(quotaTotal - quotaUsed) : t("common.unlimited"),
      hint: quotaTotal > 0 ? `${quotaPercent.toFixed(1)}% ${t("dashboard.quotaUsed")}` : undefined,
      icon: Wallet,
      tone: "blue",
      badge: isAdmin ? t("common.unlimited") : undefined,
    },
    {
      title: t("dashboard.activeKeys"),
      value: String(activeKeys),
      hint: "",
      icon: Zap,
      tone: "green",
    },
    {
      title: t("dashboard.availableModels"),
      value: String(models.length),
      hint: "",
      icon: Cpu,
      tone: "purple",
    },
    {
      title: t("dashboard.plan"),
      value: isAdmin ? "Admin" : "Member",
      hint: "",
      icon: Crown,
      tone: "amber",
      badge: isAdmin ? t("common.unlimited") : undefined,
    },
  ]

  const toneStyles: Record<string, { bg: string; text: string }> = {
    blue: { bg: "bg-blue-50", text: "text-blue-600" },
    green: { bg: "bg-emerald-50", text: "text-emerald-600" },
    purple: { bg: "bg-violet-50", text: "text-violet-600" },
    amber: { bg: "bg-amber-50", text: "text-amber-500" },
  }

  const dailyData = stats?.daily || []
  const modelBreakdown = stats?.modelBreakdown || []

  const areaSpec: any = {
    type: "area",
    data: { values: dailyData },
    xField: "date",
    yField: "requests",
    point: { visible: true },
    area: { style: { fill: "rgba(37,99,235,0.15)" } },
    line: { style: { stroke: "#2563eb", lineWidth: 2 } },
    axes: [
      {
        orient: "bottom",
        label: { style: { fontSize: 11, fill: "#64748b" } },
        grid: { visible: false },
      },
      {
        orient: "left",
        label: { style: { fontSize: 11, fill: "#64748b" } },
        grid: { style: { lineDash: [4, 4], stroke: "#e2e8f0" } },
      },
    ],
    padding: { top: 10, right: 10, bottom: 20, left: 40 },
    height: 220,
  }

  const pieSpec: any = {
    type: "pie",
    data: { values: modelBreakdown },
    valueField: "requestCount",
    categoryField: "model",
    outerRadius: 0.75,
    innerRadius: 0.5,
    label: {
      visible: true,
      style: { fontSize: 11, fill: "#475569" },
    },
    legends: {
      visible: true,
      orient: "right",
      item: { label: { style: { fontSize: 11, fill: "#64748b" } } },
    },
    tooltip: {
      mark: { content: [{ key: (d: any) => d.model, value: (d: any) => d.requestCount }] },
    },
    padding: { top: 10, right: 10, bottom: 10, left: 10 },
    height: 220,
  }

  return (
    <div className="space-y-7">
      {/* Header */}
      <div>
        <h1 className="text-[30px] font-black tracking-tight text-slate-950">
          {t("dashboard.greeting", { name: user?.name || user?.username || "" })} 👋
        </h1>
        <p className="mt-2 text-base font-medium text-slate-500">{t("dashboard.overview")}</p>
      </div>

      {/* Stat cards */}
      <section className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-[22px] border border-slate-200/80 bg-white p-7 shadow-[0_10px_35px_rgba(15,23,42,0.035)]">
              <Skeleton className="h-28 w-full" />
            </div>
          ))
        ) : statCards.map((s) => {
          const Icon = s.icon
          const style = toneStyles[s.tone] || toneStyles.blue
          return (
            <section
              key={s.title}
              className="rounded-[22px] border border-slate-200/80 bg-white p-7 shadow-[0_10px_35px_rgba(15,23,42,0.035)]"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-slate-600">
                    {s.title}
                    {s.title === t("dashboard.quotaBalance") && (
                      <Eye className="h-4 w-4 text-slate-500" />
                    )}
                  </div>
                  <div className="text-3xl font-black tracking-tight text-slate-950">{s.value}</div>
                </div>
                <div className={`flex h-14 w-14 items-center justify-center rounded-full ${style.bg} ${style.text}`}>
                  <Icon className="h-6 w-6" />
                </div>
              </div>
              <div className="mt-6 flex items-center gap-2">
                {s.hint && <span className="text-sm font-medium text-slate-500">{s.hint}</span>}
                {s.badge && (
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-bold text-emerald-600">
                    {s.badge}
                  </span>
                )}
              </div>
            </section>
          )
        })}
      </section>

      {/* Charts */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-[24px] border border-slate-200/80 bg-white p-6 shadow-[0_10px_35px_rgba(15,23,42,0.035)]">
          <h2 className="text-lg font-black mb-4">{t("dashboard.dailyRequests", { defaultValue: "Daily Requests" })}</h2>
          {loading ? (
            <Skeleton className="h-[220px] w-full" />
          ) : dailyData.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-sm text-slate-400">
              {t("common.noData", { defaultValue: "No data" })}
            </div>
          ) : (
            <VChart spec={areaSpec} />
          )}
        </div>

        <div className="rounded-[24px] border border-slate-200/80 bg-white p-6 shadow-[0_10px_35px_rgba(15,23,42,0.035)]">
          <h2 className="text-lg font-black mb-4">{t("dashboard.modelDistribution", { defaultValue: "Model Distribution" })}</h2>
          {loading ? (
            <Skeleton className="h-[220px] w-full" />
          ) : modelBreakdown.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-sm text-slate-400">
              {t("common.noData", { defaultValue: "No data" })}
            </div>
          ) : (
            <VChart spec={pieSpec} />
          )}
        </div>
      </section>

      {/* Quick actions */}
      <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Create key card */}
        <div className="relative overflow-hidden rounded-[24px] border border-slate-200/80 bg-white p-8 shadow-[0_10px_35px_rgba(15,23,42,0.035)]">
          <div className="relative z-10 max-w-md">
            <h2 className="text-xl font-black">{t("dashboard.createKey")}</h2>
            <p className="mt-4 text-sm font-medium leading-6 text-slate-500">{t("dashboard.createKeyDesc")}</p>
            <button
              onClick={() => navigate("/app/keys")}
              className="mt-8 inline-flex h-12 items-center gap-3 rounded-xl bg-blue-600 px-6 text-sm font-bold text-white shadow-lg shadow-blue-500/25 transition hover:bg-blue-700"
            >
              {t("dashboard.goToKeys")} <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <Key className="absolute bottom-8 right-20 h-28 w-28 rotate-12 text-blue-500 opacity-90" strokeWidth={1.8} />
          <div className="absolute right-8 top-8 text-slate-400"><ChevronRight className="h-6 w-6" /></div>
          <div className="absolute bottom-12 right-8 h-7 w-7 rotate-45 rounded-lg bg-blue-100" />
          <div className="absolute right-40 top-8 h-6 w-6 rotate-45 rounded-lg bg-blue-100" />
        </div>

        {/* API docs card */}
        <div className="rounded-[24px] border border-slate-200/80 bg-white p-8 shadow-[0_10px_35px_rgba(15,23,42,0.035)]">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-black">{t("dashboard.apiDocs")}</h2>
              <p className="mt-4 text-sm font-medium text-slate-500">{t("dashboard.apiDocsDesc")}</p>
            </div>
            <ChevronRight className="h-5 w-5 text-slate-500" />
          </div>
          <div className="mt-8 flex h-14 items-center justify-between rounded-2xl border border-slate-200 bg-slate-50/70 px-5 font-mono text-sm font-bold text-slate-800">
            <div className="flex items-center gap-3">
              <Code2 className="h-5 w-5 text-blue-600" />
              base_url="https://api.tokensea.dev/v1"
            </div>
            <BookOpen className="h-5 w-5 text-slate-500" />
          </div>
        </div>
      </section>

      {/* Quick navigation */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_420px]">
        {/* Models */}
        <div className="rounded-[24px] border border-slate-200/80 bg-white p-8 shadow-[0_10px_35px_rgba(15,23,42,0.035)]">
          <h2 className="text-xl font-black">{t("dashboard.supportedModels")}</h2>
          {loading ? (
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : (
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {models.slice(0, 9).map((m: any) => (
                <div key={m.id} className="flex items-center justify-between rounded-2xl bg-slate-50/70 px-4 py-3 transition hover:bg-blue-50/70">
                  <div className="min-w-0">
                    <p className="font-bold text-sm text-slate-700 truncate">{m.display_name || m.id}</p>
                    <p className="text-xs text-slate-500">
                      {m.pricing?.input_per_1k ?? "—"}¢{t("dashboard.per1k")}
                      {" · "}
                      {m.pricing?.output_per_1k ?? "—"}¢{t("dashboard.per1k")}
                    </p>
                  </div>
                  <Badge variant="secondary" className="ml-2 shrink-0 text-xs">{m.owned_by}</Badge>
                </div>
              ))}
            </div>
          )}
          <button
            onClick={() => navigate("/app/marketplace")}
            className="mx-auto mt-6 flex items-center gap-2 text-sm font-bold text-blue-600 hover:text-blue-700"
          >
            {t("nav.marketplace")} <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Quick links */}
        <div className="rounded-[24px] border border-slate-200/80 bg-white p-8 shadow-[0_10px_35px_rgba(15,23,42,0.035)]">
          <h2 className="text-xl font-black">{t("dashboard.quickNav")}</h2>
          <div className="mt-6 space-y-3">
            {quickLinks.map((link) => {
              const Icon = link.icon
              return (
                <button
                  key={link.labelKey}
                  onClick={() => navigate(link.path)}
                  className="flex h-14 w-full items-center justify-between rounded-2xl bg-slate-50/70 px-4 text-left transition hover:bg-blue-50/70"
                >
                  <span className="flex items-center gap-4 font-bold text-slate-700">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                      <Icon className="h-5 w-5" />
                    </span>
                    {t(link.labelKey)}
                  </span>
                  <ChevronRight className="h-4 w-4 text-slate-500" />
                </button>
              )
            })}
          </div>
        </div>
      </section>
    </div>
  )
}
