import { useEffect, useMemo, useState, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { api } from "@/services/api"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  Search, Zap, Wrench, Eye, Play, Copy, Check, ArrowUpDown,
  Terminal, Hash, Clapperboard,
} from "lucide-react"

import { VendorIcon } from "@/components/VendorIcon"
import { BillingEstimate } from "@/components/BillingEstimate"
import {formatMoney,CNY_PER_USD} from '@/lib/utils'

// ── Provider theme map ────────────────────────────────────────────
interface ProviderTheme {
  label: string
  bar: string
  badge: string
  light: string
  iconBg: string
}

const PROVIDER_THEMES: Record<string, ProviderTheme> = {
  anthropic: {
    label: "Anthropic",
    bar: "bg-orange-500",
    badge: "bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300",
    light: "bg-orange-500/10 text-orange-600",
    iconBg: "bg-orange-50 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300",
  },
  claude: {
    label: "Claude",
    bar: "bg-orange-500",
    badge: "bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300",
    light: "bg-orange-500/10 text-orange-600",
    iconBg: "bg-orange-50 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300",
  },
  openai: {
    label: "OpenAI",
    bar: "bg-emerald-500",
    badge: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
    light: "bg-emerald-500/10 text-emerald-600",
    iconBg: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  google: {
    label: "Google",
    bar: "bg-blue-500",
    badge: "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",
    light: "bg-blue-500/10 text-blue-600",
    iconBg: "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300",
  },
  gemini: {
    label: "Google",
    bar: "bg-blue-500",
    badge: "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",
    light: "bg-blue-500/10 text-blue-600",
    iconBg: "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300",
  },
  deepseek: {
    label: "深度求索",
    bar: "bg-violet-500",
    badge: "bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300",
    light: "bg-violet-500/10 text-violet-600",
    iconBg: "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300",
  },
  codex: {
    label: "Codex",
    bar: "bg-cyan-500",
    badge: "bg-cyan-50 text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-300",
    light: "bg-cyan-500/10 text-cyan-600",
    iconBg: "bg-cyan-50 text-cyan-600 dark:bg-cyan-500/15 dark:text-cyan-300",
  },
  grok: {
    label: "Grok",
    bar: "bg-rose-500",
    badge: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
    light: "bg-rose-500/10 text-rose-600",
    iconBg: "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300",
  },
  mistral: {
    label: "Mistral",
    bar: "bg-amber-500",
    badge: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
    light: "bg-amber-500/10 text-amber-600",
    iconBg: "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300",
  },
  qwen: {
    label: "通义千问",
    bar: "bg-indigo-500",
    badge: "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300",
    light: "bg-indigo-500/10 text-indigo-600",
    iconBg: "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300",
  },
  moonshot: {
    label: "月之暗面",
    bar: "bg-blue-500",
    badge: "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",
    light: "bg-blue-500/10 text-blue-600",
    iconBg: "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300",
  },
  zhipu: {
    label: "智谱 AI",
    bar: "bg-blue-600",
    badge: "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",
    light: "bg-blue-500/10 text-blue-600",
    iconBg: "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300",
  },
  xiaomi: {
    label: "小米 MiMo",
    bar: "bg-orange-500",
    badge: "bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300",
    light: "bg-orange-500/10 text-orange-600",
    iconBg: "bg-orange-50 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300",
  },
  volcengine: {
    label: "火山引擎",
    bar: "bg-red-500",
    badge: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300",
    light: "bg-red-500/10 text-red-600",
    iconBg: "bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300",
  },
  kling: {
    label: "可灵 AI",
    bar: "bg-blue-500",
    badge: "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",
    light: "bg-blue-500/10 text-blue-600",
    iconBg: "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300",
  },
  minimax: {
    label: "MiniMax 海螺",
    bar: "bg-cyan-500",
    badge: "bg-cyan-50 text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-300",
    light: "bg-cyan-500/10 text-cyan-600",
    iconBg: "bg-cyan-50 text-cyan-600 dark:bg-cyan-500/15 dark:text-cyan-300",
  },
  doubao: {
    label: "Doubao",
    bar: "bg-sky-500",
    badge: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300",
    light: "bg-sky-500/10 text-sky-600",
    iconBg: "bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300",
  },
  hunyuan: {
    label: "Hunyuan",
    bar: "bg-teal-500",
    badge: "bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300",
    light: "bg-teal-500/10 text-teal-600",
    iconBg: "bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300",
  },
}

function getProviderTheme(provider?: string): ProviderTheme {
  if (!provider) return PROVIDER_THEMES.openai
  return PROVIDER_THEMES[provider.toLowerCase()] || {
    label: provider.charAt(0).toUpperCase() + provider.slice(1),
    bar: "bg-slate-400",
    badge: "bg-slate-50 text-slate-700 dark:bg-slate-500/10 dark:text-slate-300",
    light: "bg-slate-500/10 text-slate-600",
    iconBg: "bg-slate-50 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300",
  }
}

// Guess vendor icon name from model alias
const CATEGORY_LABELS: Record<string, string> = {
  chat: "marketplace.categoryChat",
  code: "marketplace.categoryCode",
  vision: "marketplace.categoryVision",
  embedding: "marketplace.categoryEmbedding",
  audio: "marketplace.categoryAudio",
  image: "marketplace.categoryImage",
  video: "marketplace.categoryVideo",
}

const CORE_CATEGORIES = ["chat", "vision", "video", "image", "audio"]

function getCategoryLabel(category: string, t: any) {
  return CATEGORY_LABELS[category] ? t(CATEGORY_LABELS[category]) : category
}

const MAX_CONTEXT_REF = 200_000

function getPublicDescription(description?: string | null) {
  if (!description || /^由金山云(?:星流)?接入/.test(description.trim())) return ""
  return description
}

type SortMode = "default" | "priceAsc" | "priceDesc" | "contextDesc"

export function MarketplacePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [models, setModels] = useState<any[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [providers, setProviders] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [selectedCategory, setSelectedCategory] = useState("")
  const [selectedProvider, setSelectedProvider] = useState("")
  const [sortMode, setSortMode] = useState<SortMode>("default")
  const [selectedModel, setSelectedModel] = useState<any>(null)
  const loadVersion=useRef(0)

  useEffect(() => { loadModels() }, [selectedCategory, selectedProvider])

  async function loadModels() {
    const version=++loadVersion.current
    setLoading(true)
    const params = new URLSearchParams()
    if (selectedCategory) params.set("category", selectedCategory)
    if (selectedProvider) params.set("provider", selectedProvider)
    try {
      const res = await api.getMarketplaceModels(params.toString())
      if(version!==loadVersion.current)return
      setModels(res.data || [])
      if (res.categories) setCategories(res.categories)
      if (res.providers) setProviders(res.providers)
    } catch {}
    if(version===loadVersion.current)setLoading(false)
  }

  const filteredSorted = useMemo(() => {
    let list = [...models]
    if (search) {
      const q = search.toLowerCase()
      list = list.filter((m) =>
        (m.alias || "").toLowerCase().includes(q) ||
        (m.displayName || "").toLowerCase().includes(q) ||
        (m.description || "").toLowerCase().includes(q)
      )
    }
    switch (sortMode) {
      case "priceAsc":
        list.sort((a, b) => (a.inputPrice || 0) - (b.inputPrice || 0))
        break
      case "priceDesc":
        list.sort((a, b) => (b.inputPrice || 0) - (a.inputPrice || 0))
        break
      case "contextDesc":
        list.sort((a, b) => (b.maxContext || 0) - (a.maxContext || 0))
        break
      default:
        list.sort((a, b) => (b.sortOrder || 0) - (a.sortOrder || 0))
        break
    }
    return list
  }, [models, search, sortMode])

  const visibleCategories = useMemo(
    () => [...CORE_CATEGORIES, ...categories.filter((category) => !CORE_CATEGORIES.includes(category))],
    [categories],
  )

  return (
    <div className="space-y-7">
      {/* Header */}
      <div>
        <h1 className="text-[30px] font-black tracking-tight text-slate-950 dark:text-slate-100">{t("marketplace.title")}</h1>
        <p className="mt-2 text-base font-medium text-slate-500 dark:text-slate-400">{t("marketplace.subtitle")}</p>
      </div>

      {/* Provider pills */}
      <div className="flex flex-wrap gap-2">
        <ProviderPill
          label={t("marketplace.allProviders")}
          active={!selectedProvider}
          onClick={() => setSelectedProvider("")}
        />
        {providers.map((p) => {
          const theme = getProviderTheme(p)
          return (
            <ProviderPill
              key={p}
              label={theme.label}
              active={selectedProvider === p}
              onClick={() => setSelectedProvider(p)}
              colorClass={theme.light}
              activeClass={theme.bar + " text-white"}
            />
          )
        })}
      </div>

      <p className="mb-4 text-xs text-muted-foreground">TokenSea 试运营售价 · 人民币 / 美元同时展示 · 1 USD = {CNY_PER_USD} CNY（固定平台折算，非实时汇率）· 文本价格单位：百万 Tokens</p>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        {/* Sidebar filters */}
        <div className="flex flex-row gap-2 sm:flex-col sm:w-52 sm:shrink-0">
          {/* Category pills */}
          <div className="flex flex-row gap-1.5 flex-wrap sm:flex-col">
            <button
              onClick={() => setSelectedCategory("")}
              className={`rounded-2xl px-4 py-2 text-sm font-bold transition-all ${
                !selectedCategory
                  ? "bg-blue-600 text-white shadow-lg shadow-blue-500/25"
                  : "bg-slate-50 text-slate-600 hover:bg-slate-100 dark:bg-slate-800/50 dark:text-slate-400 dark:hover:bg-slate-800"
              }`}
            >
              {t("marketplace.allCategories")}
            </button>
            {visibleCategories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`rounded-2xl px-4 py-2 text-sm font-bold transition-all ${
                  selectedCategory === cat
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-500/25"
                    : "bg-slate-50 text-slate-600 hover:bg-slate-100 dark:bg-slate-800/50 dark:text-slate-400 dark:hover:bg-slate-800"
                }`}
              >
                {getCategoryLabel(cat, t)}
              </button>
            ))}
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Search + sort */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadModels()}
                placeholder={t("marketplace.search")}
                className="pl-11 h-12 rounded-2xl border-slate-200 bg-white text-sm shadow-[0_4px_15px_rgba(15,23,42,0.03)] dark:border-slate-700 dark:bg-[#0f172a]"
              />
            </div>
            <div className="relative">
              <ArrowUpDown className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                className="h-12 appearance-none rounded-2xl border border-slate-200 bg-white pl-9 pr-8 text-sm font-semibold text-slate-700 shadow-[0_4px_15px_rgba(15,23,42,0.03)] focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-300"
              >
                <option value="default">{t("marketplace.sortDefault")}</option>
                <option value="priceAsc">{t("marketplace.sortPriceAsc")}</option>
                <option value="priceDesc">{t("marketplace.sortPriceDesc")}</option>
                <option value="contextDesc">{t("marketplace.sortContextDesc")}</option>
              </select>
            </div>
          </div>

          {/* Results count */}
          {!loading && (
            <p className="text-xs font-bold text-slate-400">
              {t("marketplace.modelCount", { count: filteredSorted.length })}
            </p>
          )}

          {/* Model grid */}
          {loading ? (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rounded-[22px] border border-slate-200/80 bg-white p-5 shadow-[0_10px_35px_rgba(15,23,42,0.035)] dark:border-slate-800 dark:bg-[#0f172a]">
                  <Skeleton className="h-40 w-full" />
                </div>
              ))}
            </div>
          ) : filteredSorted.length === 0 ? (
            <div className="py-16 text-center text-slate-400 font-medium dark:text-slate-500">{t("marketplace.noModels")}</div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {filteredSorted.map((m: any) => (
                <ModelCard key={m.id || m.alias} model={m} onClick={() => setSelectedModel(m)} t={t} onTry={() => {
                  if (m.category === "video") {
                    if(m.alias==='seedance-2.0-o'){setSelectedModel(m);return}
                    navigate(`/app/video?model=${encodeURIComponent(m.alias)}`)
                    return
                  }
                  const mode = m.category === "image" ? "image" : "chat"
                  navigate(`/app/chat?model=${encodeURIComponent(m.alias)}&mode=${mode}`)
                }} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Model detail dialog */}
      <Dialog open={!!selectedModel} onOpenChange={(open) => !open && setSelectedModel(null)}>
        <DialogContent className="max-w-2xl rounded-[24px] p-0 max-h-[90vh] overflow-y-auto">
          {selectedModel && <ModelDetail model={selectedModel} t={t} onTry={() => {
            setSelectedModel(null)
            if(selectedModel.category==='video'){navigate(`/app/video?model=${encodeURIComponent(selectedModel.alias)}`);return}
            const mode = selectedModel.category === "image" ? "image" : "chat"
            navigate(`/app/chat?model=${encodeURIComponent(selectedModel.alias)}&mode=${mode}`)
          }} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ProviderPill({
  label,
  active,
  onClick,
  colorClass,
  activeClass,
}: {
  label: string
  active: boolean
  onClick: () => void
  colorClass?: string
  activeClass?: string
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 text-sm font-bold transition-all ${
        active
          ? activeClass || "bg-blue-600 text-white shadow-lg shadow-blue-500/25"
          : colorClass || "bg-slate-50 text-slate-600 hover:bg-slate-100 dark:bg-slate-800/50 dark:text-slate-400 dark:hover:bg-slate-800"
      }`}
    >
      {label}
    </button>
  )
}

function ModelCard({ model, onClick, t, onTry }: { model: any; onClick: () => void; t: any; onTry: () => void }) {
  const theme = getProviderTheme(model.provider)
  const description = getPublicDescription(model.description)
  const isVideo = model.category === "video"
  const ctx = model.maxContext || 0
  const ctxPct = Math.min((ctx / MAX_CONTEXT_REF) * 100, 100)
  return (
    <div
      className="relative cursor-pointer rounded-[22px] border border-slate-200/80 bg-white shadow-[0_10px_35px_rgba(15,23,42,0.035)] transition-all hover:shadow-[0_15px_45px_rgba(15,23,42,0.08)] hover:-translate-y-0.5 group dark:border-slate-800 dark:bg-[#0f172a]"
      onClick={onClick}
    >
      {/* Provider color bar */}
      <div className={`absolute left-0 top-4 bottom-4 w-1 rounded-r-full ${theme.bar}`} />

      <div className="p-5 pl-6 space-y-3.5">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <div className="shrink-0">
                <VendorIcon name={model.alias} size={32} />
              </div>
              <div className="min-w-0">
                <h3 className="font-black text-sm truncate text-slate-900 dark:text-slate-100 font-mono">{model.alias}</h3>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Hash className="h-3 w-3 text-slate-400" />
                  <p className="text-[11px] text-slate-400 font-mono truncate">{model.alias}</p>
                </div>
              </div>
            </div>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${theme.badge}`}>{theme.label}</span>
        </div>

        {/* Description */}
        {description && (
          <p className="text-xs text-slate-500 leading-relaxed line-clamp-2 dark:text-slate-400">{description}</p>
        )}

        {/* Capabilities */}
        <div className="flex flex-wrap gap-1.5">
          {isVideo && (
            <span className="inline-flex items-center gap-1 rounded-lg bg-fuchsia-50 px-2 py-0.5 text-[10px] font-bold text-fuchsia-600 dark:bg-fuchsia-500/10 dark:text-fuchsia-300">
              <Clapperboard className="h-2.5 w-2.5" /> {t("marketplace.asyncVideo")}
            </span>
          )}
          {model.supportsStream && (
            <span className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
              <Zap className="h-2.5 w-2.5" /> {t("marketplace.stream")}
            </span>
          )}
          {model.supportsTools && (
            <span className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-600 dark:bg-amber-500/10 dark:text-amber-300">
              <Wrench className="h-2.5 w-2.5" /> {t("marketplace.tools")}
            </span>
          )}
          {model.supportsVision && (
            <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300">
              <Eye className="h-2.5 w-2.5" /> {model.capabilities?.visionUnderstanding ? t("marketplace.vision") : t('marketplace.imageInput', {defaultValue:'图片输入'})}
            </span>
          )}
        </div>

        {/* Context window bar */}
        {!isVideo && model.category !== "image" && <div>
          <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 mb-1">
            <span>{t("marketplace.contextWindow")}</span>
            <span>{ctx ? `${(ctx / 1000).toFixed(0)}K` : "—"}</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div
              className={`h-full rounded-full ${theme.bar}`}
              style={{ width: `${ctxPct}%`, opacity: ctxPct < 5 ? 0.6 : 1 }}
            />
          </div>
        </div>}

        {/* Pricing row — $/M tokens */}
        {!isVideo ? <div className="flex flex-col gap-1 text-[11px] font-medium pt-2 border-t border-slate-100 dark:border-slate-800/60">
          <span className="text-slate-500 dark:text-slate-400">{t("marketplace.inputPrice")} <span className="font-bold text-slate-800 dark:text-slate-200 font-mono">{formatMoney(model.inputPrice)}/M</span></span>
          {model.cacheReadPrice > 0 && (
            <span className="text-slate-500 dark:text-slate-400">{t("marketplace.cachePrice")} <span className="font-bold text-emerald-600 dark:text-emerald-400 font-mono">{formatMoney(model.cacheReadPrice)}/M</span></span>
          )}
          <span className="text-slate-500 dark:text-slate-400">{t("marketplace.outputPrice")} <span className="font-bold text-slate-800 dark:text-slate-200 font-mono">{formatMoney(model.outputPrice)}/M</span></span>
        </div> : (
          <div className="rounded-xl border border-fuchsia-100 bg-fuchsia-50/70 px-3 py-2 text-[11px] font-semibold text-fuchsia-700 dark:border-fuchsia-900/60 dark:bg-fuchsia-500/10 dark:text-fuchsia-300">
            {t("marketplace.videoBillingHint")}
          </div>
        )}
        {/* Multi-tier pricing hint */}
        {model.pricing?.tiers?.length > 1 && (
          <p className="text-[10px] text-blue-500 font-bold pt-1">{t("marketplace.pricingTiers", { count: model.pricing.tiers.length })}</p>
        )}
        {/* Try button — compact, bottom-right */}
        <div className="flex justify-end pt-1.5">
          <button
            onClick={(e) => { e.stopPropagation(); onTry() }}
            className="rounded-lg bg-blue-600 px-2.5 py-1 text-[10px] font-bold text-white shadow-sm hover:bg-blue-700 transition-colors"
          >
            {isVideo ? <Terminal className="inline h-2.5 w-2.5 mr-0.5 -mt-px" /> : <Play className="inline h-2.5 w-2.5 mr-0.5 -mt-px" />}
            {isVideo ? (model.alias==='seedance-2.0-o'?'查看说明':'视频工作台') : t("marketplace.tryInPlayground")}
          </button>
        </div>
      </div>
    </div>
  )
}

function getCurlExample(model: any) {
  const alias = model.alias
  if (model.category === "image") {
    return 'curl https://api.tokensea.dev/v1/images/generations -H "Authorization: Bearer $TOKENSEA_API_KEY" -H "Content-Type: application/json" -d ' + "'" + JSON.stringify({model: alias, prompt: "海面上的蓝色帆船", size: "1024x1024", quality: "low", n: 1}, null, 2) + "'"
  }
  if (model.category !== "video") {
    return `curl https://api.tokensea.dev/v1/chat/completions \\
  -H "Authorization: Bearer YOUR_TOKENSEA_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${alias}",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`
  }

  if (alias === "seedance-2.0-o") return "# 此型号价格尚未核实，暂不开放计费调用。"
  const seed = alias.startsWith("seedance"), kling = alias.startsWith("kling")
  const path = seed ? "v3/contents/generations/tasks" : kling ? (alias.endsWith("omni") ? "v1/videos/omni-video" : "v1/videos/text2video") : "v1/video_generation"
  const parameters = seed ? {
    model:alias,content:[{type:"text",text:"海边日落的电影感镜头"}],ratio:"16:9",resolution:"720p",duration:5,generate_audio:true,
  } : kling ? {
    model_name:alias,prompt:"海边日落的电影感镜头",duration:"5",mode:"std",sound:"on",aspect_ratio:"16:9",
  } : {
    model:alias,prompt:"海边日落的电影感镜头",duration:6,resolution:"768P",
    ...(alias.endsWith("fast") ? {first_frame_image:"https://example.com/REPLACE_WITH_YOUR_IMAGE.png"} : {}),
  }
  return '# 同一次任务重试须复用 Idempotency-Key；新任务请换一个唯一值。\n'
    + 'curl https://api.tokensea.dev/v1/video/' + alias + '/' + path + ' \\\n'
    + '  -H "Authorization: Bearer $TOKENSEA_API_KEY" \\\n'
    + '  -H "Idempotency-Key: YOUR_UNIQUE_REQUEST_ID" \\\n'
    + '  -H "Content-Type: application/json" \\\n'
    + "  -d '" + JSON.stringify(parameters,null,2) + "'\n\n"
    + '# 使用返回的 TokenSea id 查询；不要使用上游 task_id。查询不重复计费。\n'
    + 'curl https://api.tokensea.dev/v1/video/' + alias + '/tasks/YOUR_TOKENSEA_TASK_ID \\\n'
    + '  -H "Authorization: Bearer $TOKENSEA_API_KEY"'
}

function ModelDetail({ model, t, onTry }: { model: any; t: any; onTry: () => void }) {
  const [copied, setCopied] = useState(false)
  const [language, setLanguage] = useState("curl")
  const theme = getProviderTheme(model.provider)
  const description = getPublicDescription(model.description)
  const tags = (model.tags as string[]) ?? []
  const routes = (model.routes as any[]) ?? []
  const isVideo = model.category === "video"

  const copyAlias = async () => {
    try {
      await navigator.clipboard.writeText(model.alias)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  const curlExample = getCurlExample(model)
  const python = 'import os\nfrom openai import OpenAI\n\nclient = OpenAI(api_key=os.environ["TOKENSEA_API_KEY"],\n                base_url="https://api.tokensea.dev/v1")\n\n' +
    (model.category === "image"
      ? 'result = client.images.generate(model="' + model.alias + '", prompt="海面上的蓝色帆船", size="1024x1024", quality="low")\n# 图片在 result.data[0].b64_json；用量在 result.usage'
      : 'result = client.chat.completions.create(\n    model="' + model.alias + '",\n    messages=[{"role":"user","content":"你好"}]\n)\nprint(result.choices[0].message.content)')
  const example = language === "python" && !isVideo ? python : curlExample

  return (
    <div className="p-7 space-y-6">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-3">
          <div className="shrink-0">
            <VendorIcon name={model.alias} size={40} />
          </div>
          <div className="min-w-0">
            <div className="font-black text-lg font-mono">{model.alias}</div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${theme.badge}`}>{theme.label}</span>
              {model.category && (
                <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600 dark:border-slate-700 dark:text-slate-400">
                  {getCategoryLabel(model.category, t)}
                </span>
              )}
            </div>
          </div>
        </DialogTitle>
      </DialogHeader>

      {/* Model ID (copyable) */}
      <div>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">{t("marketplace.modelId")}</p>
        <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/50">
          <Terminal className="h-4 w-4 text-slate-400 shrink-0" />
          <code className="flex-1 text-sm font-mono text-slate-700 truncate dark:text-slate-300">{model.alias}</code>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 rounded-xl text-xs font-bold shrink-0"
            onClick={copyAlias}
          >
            {copied ? <Check className="h-3.5 w-3.5 mr-1 text-emerald-500" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
            {copied ? t("marketplace.copied") : t("marketplace.copy")}
          </Button>
        </div>
      </div>

      {description && <p className="text-sm text-slate-500 leading-relaxed dark:text-slate-400">{description}</p>}

      {/* Tags */}
      {tags.length > 0 && (
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">{t("marketplace.tags")}</p>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag: string) => (
              <Badge key={tag} variant="secondary" className="rounded-lg text-xs font-bold dark:bg-slate-800 dark:text-slate-300">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Capabilities */}
      <div>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">{t("marketplace.capabilities")}</p>
        {isVideo ? (
          <div className="grid grid-cols-1 gap-3">
            <CapabilityTile
              active
              icon={<Clapperboard className="h-4 w-4" />}
              label={t("marketplace.asyncVideo")}
              activeColor="text-fuchsia-500 bg-fuchsia-50 dark:bg-fuchsia-500/10"
            />
          </div>
        ) : <div className="grid grid-cols-3 gap-3">
          <CapabilityTile
            active={model.supportsStream}
            icon={<Zap className="h-4 w-4" />}
            label={t("marketplace.stream")}
            activeColor="text-blue-500 bg-blue-50 dark:bg-blue-500/10"
          />
          <CapabilityTile
            active={model.supportsTools}
            icon={<Wrench className="h-4 w-4" />}
            label={t("marketplace.tools")}
            activeColor="text-amber-500 bg-amber-50 dark:bg-amber-500/10"
          />
          <CapabilityTile
            active={model.supportsVision}
            icon={<Eye className="h-4 w-4" />}
            label={t(model.capabilities?.visionUnderstanding ? "marketplace.vision" : "marketplace.imageInput")}
            activeColor="text-emerald-500 bg-emerald-50 dark:bg-emerald-500/10"
          />
        </div>}
      </div>

      <BillingEstimate key={model.alias} model={model} />
      {/* Pricing — $/M tokens */}
      {isVideo ? (
        <div className="rounded-2xl border border-fuchsia-100 bg-fuchsia-50/70 p-4 text-sm font-semibold text-fuchsia-700 dark:border-fuchsia-900/60 dark:bg-fuchsia-500/10 dark:text-fuchsia-300">
          <p>可灵按时长与音画档位，海螺按分辨率和时长档位，Seedance 按实际视频 Tokens 结算。提交前预占，完成后结算；查询任务不重复收费。</p>
          <p className="mt-2">当前仅接受已核实的参数组合。Seedance 2.0-o、视频参考输入及其他未核价扩展参数暂不开放计费调用。</p>
        </div>
      ) : <div>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">{t("marketplace.pricing")}</p>
        {model.pricing?.tiers ? (
          /* Multi-tier pricing table (GPT short/long context, etc.) */
          <div className="space-y-3">
            {model.pricing.tiers.map((tier: any, i: number) => (
              <div key={i}>
                <p className="text-[11px] font-bold text-slate-500 mb-2">{tier.label}</p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  {model.pricing.dimensions.map((dim: string) => {
                    const val = tier[dim]
                    if (val == null) return (
                      <div key={dim} className="rounded-xl border border-slate-100 bg-slate-50/50 p-2 dark:border-slate-800 dark:bg-slate-900/30">
                        <p className="text-[9px] text-slate-300 font-bold">{dim}</p>
                        <p className="text-sm font-bold text-slate-300">—</p>
                      </div>
                    )
                    const colors: Record<string,string> = {
                      input: "border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/50 text-slate-900 dark:text-slate-100",
                      cachedInput: "border-emerald-200 bg-emerald-50/70 dark:border-emerald-800 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300",
                      cacheWrite5m: "border-orange-200 bg-orange-50/70 dark:border-orange-800 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300",
                      cacheWrite1h: "border-amber-200 bg-amber-50/70 dark:border-amber-800 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300",
                      cacheRead: "border-emerald-200 bg-emerald-50/70 dark:border-emerald-800 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300",
                      output: "border-blue-200 bg-blue-50/70 dark:border-blue-800 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300",
                    }
                    const labels: Record<string,string> = {
                      input: t("marketplace.inputPrice"), cachedInput: t("marketplace.cachedInput"), output: t("marketplace.outputPrice"),
                      cacheWrite5m: t("marketplace.cacheWrite5m"), cacheWrite1h: t("marketplace.cacheWrite1h"), cacheRead: t("marketplace.cacheRead"),
                    }
                    const c = colors[dim] || colors.input
                    return (
                      <div key={dim} className={`rounded-xl border p-2 ${c}`}>
                        <p className="text-[9px] opacity-60 font-bold">{labels[dim] || dim}</p>
                        <p className={`text-sm font-black font-mono`}>{formatMoney(val)}/M</p>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Legacy single-tier pricing (Claude) */
          <>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/50">
                <p className="text-[10px] text-slate-400 font-bold">{t("marketplace.baseInput")}</p>
                <p className="text-sm font-black text-slate-900 dark:text-slate-100 font-mono">{formatMoney(model.inputPrice)}/M</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/50">
                <p className="text-[10px] text-slate-400 font-bold">{t("marketplace.outputPrice")}</p>
                <p className="text-sm font-black text-slate-900 dark:text-slate-100 font-mono">{formatMoney(model.outputPrice)}/M</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/50">
                <p className="text-[10px] text-slate-400 font-bold">{t("marketplace.contextWindow")}</p>
                <p className="text-lg font-black text-slate-900 dark:text-slate-100">{model.maxContext ? `${(model.maxContext / 1000).toFixed(0)}K` : "—"}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center mt-3">
              {model.cacheWrite5mPrice > 0 && (
                <div className="rounded-2xl border border-orange-200 bg-orange-50/70 p-3 dark:border-orange-800 dark:bg-orange-900/20">
                  <p className="text-[10px] text-orange-500 font-bold">{t("marketplace.cacheWrite5m")}</p>
                  <p className="text-sm font-black text-orange-700 dark:text-orange-300 font-mono">{formatMoney(model.cacheWrite5mPrice)}/M</p>
                </div>
              )}
              {model.cacheWrite1hPrice > 0 && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-800 dark:bg-amber-900/20">
                  <p className="text-[10px] text-amber-500 font-bold">{t("marketplace.cacheWrite1h")}</p>
                  <p className="text-sm font-black text-amber-700 dark:text-amber-300 font-mono">{formatMoney(model.cacheWrite1hPrice)}/M</p>
                </div>
              )}
              {model.cacheReadPrice > 0 && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3 dark:border-emerald-800 dark:bg-emerald-900/20">
                  <p className="text-[10px] text-emerald-500 font-bold">{t("marketplace.cacheRead")}</p>
                  <p className="text-sm font-black text-emerald-700 dark:text-emerald-300 font-mono">{formatMoney(model.cacheReadPrice)}/M</p>
                </div>
              )}
            </div>
          </>
        )}
        <p className="text-[10px] text-slate-400 text-center mt-2">{t("marketplace.per1mTokens")}</p>
      </div>}

      {/* Routes */}
      {routes.length > 0 && (
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">{t("marketplace.routes")}</p>
          <div className="rounded-2xl border border-slate-200 overflow-hidden dark:border-slate-800">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-900/50">
                <tr>
                  <th className="px-3 py-2 text-left font-bold text-slate-500">{t("marketplace.channel")}</th>
                  <th className="px-3 py-2 text-left font-bold text-slate-500">{t("marketplace.upstreamModel")}</th>
                  <th className="px-3 py-2 text-right font-bold text-slate-500">{t("marketplace.priority")}</th>
                </tr>
              </thead>
              <tbody>
                {routes.map((r: any, idx: number) => (
                  <tr key={idx} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-2 font-mono text-slate-700 dark:text-slate-300">{r.channel?.name || "—"}</td>
                    <td className="px-3 py-2 font-mono text-slate-700 dark:text-slate-300">{r.upstreamModel}</td>
                    <td className="px-3 py-2 text-right font-bold text-slate-700 dark:text-slate-300">{r.priority}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {model.pricing?.imageInputPrice != null && <div className="rounded-xl border bg-muted/50 p-4 text-sm space-y-1"><p>图片按实际 Tokens 计费，不是固定每张价格。</p><p>文字输入：{formatMoney(model.inputPrice)}／百万 Tokens；缓存：{formatMoney(model.cacheReadPrice)}</p><p>图片输入：{formatMoney(model.pricing.imageInputPrice)}；图片缓存：{formatMoney(model.pricing.imageCacheReadPrice)}；图片输出：{formatMoney(model.outputPrice)}／百万 Tokens</p></div>}
      {model.pricing?.longContext && <p className="text-sm text-muted-foreground">输入超过 {model.pricing.longContext.threshold.toLocaleString()} Tokens 时，整次请求输入与缓存价格 × {model.pricing.longContext.inputMultiplier}，输出价格 × {model.pricing.longContext.outputMultiplier}。</p>}
      <p className="text-xs text-muted-foreground">展示为基础单价，最终费用受套餐与渠道倍率影响；请求日志可查看计费快照。请使用 TokenSea 密钥，不是上游平台密钥。</p>
      {/* API example */}
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2"><Button size="sm" variant={language === "curl" ? "default" : "outline"} onClick={()=>setLanguage("curl")}>cURL</Button>{!isVideo && <Button size="sm" variant={language === "python" ? "default" : "outline"} onClick={()=>setLanguage("python")}>Python SDK</Button>}<Button size="sm" variant="outline" onClick={async()=>{await navigator.clipboard.writeText(example);setCopied(true);setTimeout(()=>setCopied(false),1500)}}>{copied ? "已复制" : "复制示例"}</Button></div>
        <p className="mb-2 text-xs text-muted-foreground">{language === "python" ? "安装：pip install openai。将密钥存入环境变量 TOKENSEA_API_KEY。" : "将 YOUR_TOKENSEA_KEY 替换为您的 TokenSea 密钥；图片示例使用环境变量 TOKENSEA_API_KEY。"}</p>
        <div className="rounded-2xl border border-slate-200 bg-slate-950 p-4 overflow-x-auto dark:border-slate-800">
          <pre className="text-xs font-mono text-slate-300 whitespace-pre">{example}</pre>
        </div>
      </div>

      {model.alias!=='seedance-2.0-o' && (
        <Button className="w-full h-12 rounded-xl font-bold shadow-lg shadow-blue-500/25" onClick={onTry}>
          <Play className="mr-2 h-4 w-4" /> {isVideo?'进入视频工作台':t("marketplace.tryInPlayground")}
        </Button>
      )}
    </div>
  )
}

function CapabilityTile({
  active,
  icon,
  label,
  activeColor,
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  activeColor: string
}) {
  return (
    <div
      className={`flex flex-col items-center gap-1.5 rounded-2xl border p-3 text-center ${
        active
          ? activeColor + " border-transparent"
          : "bg-slate-50 text-slate-400 border-slate-100 dark:bg-slate-900/30 dark:border-slate-800"
      }`}
    >
      {icon}
      <span className="text-[10px] font-bold">{label}</span>
    </div>
  )
}
