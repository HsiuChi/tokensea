import deepSeekLogo from "@lobehub/icons-static-svg/icons/deepseek-color.svg"
import moonshotLogo from "@lobehub/icons-static-svg/icons/moonshot.svg"
import qwenLogo from "@lobehub/icons-static-svg/icons/qwen-color.svg"
import xiaomiMimoLogo from "@lobehub/icons-static-svg/icons/xiaomimimo.svg"
import zhipuLogo from "@lobehub/icons-static-svg/icons/zhipu-color.svg"
import volcengineLogo from "@lobehub/icons-static-svg/icons/volcengine-color.svg"
import klingLogo from "@lobehub/icons-static-svg/icons/kling-color.svg"
import hailuoLogo from "@lobehub/icons-static-svg/icons/hailuo-color.svg"
import openaiLogo from "@lobehub/icons-static-svg/icons/openai.svg"

const PROVIDER_MAP: Record<string, { src: string; bg: string; fallback: string; imageClass?: string }> = {
  claude:  { src: "/models/claude.svg",  bg: "bg-orange-50", fallback: "C" },
  anthropic: { src: "/models/claude.svg", bg: "bg-orange-50", fallback: "C" },
  openai:  { src: openaiLogo, bg: "bg-emerald-50", fallback: "G", imageClass: "dark:invert" },
  gpt:     { src: openaiLogo, bg: "bg-emerald-50", fallback: "G", imageClass: "dark:invert" },
  o1:      { src: openaiLogo, bg: "bg-emerald-50", fallback: "G", imageClass: "dark:invert" },
  o3:      { src: openaiLogo, bg: "bg-emerald-50", fallback: "G", imageClass: "dark:invert" },
  gemini:  { src: "/models/gemini.svg",  bg: "bg-blue-50", fallback: "G" },
  deepseek: { src: deepSeekLogo, bg: "bg-violet-50", fallback: "D" },
  kimi:    { src: moonshotLogo, bg: "bg-blue-50", fallback: "K", imageClass: "dark:invert" },
  moonshot: { src: moonshotLogo, bg: "bg-blue-50", fallback: "K", imageClass: "dark:invert" },
  qwen:    { src: qwenLogo, bg: "bg-purple-50", fallback: "Q" },
  glm:     { src: zhipuLogo, bg: "bg-blue-50", fallback: "G" },
  chatglm: { src: zhipuLogo, bg: "bg-blue-50", fallback: "G" },
  zhipu:   { src: zhipuLogo, bg: "bg-blue-50", fallback: "Z" },
  mimo:    { src: xiaomiMimoLogo, bg: "bg-orange-50", fallback: "M", imageClass: "dark:invert" },
  xiaomi:  { src: xiaomiMimoLogo, bg: "bg-orange-50", fallback: "M", imageClass: "dark:invert" },
  seedance: { src: volcengineLogo, bg: "bg-red-50", fallback: "S" },
  volcengine: { src: volcengineLogo, bg: "bg-red-50", fallback: "S" },
  kling:   { src: klingLogo, bg: "bg-blue-50", fallback: "K" },
  hailuo:  { src: hailuoLogo, bg: "bg-cyan-50", fallback: "H" },
  minimax: { src: hailuoLogo, bg: "bg-cyan-50", fallback: "H" },
}

const SIZE_MAP = {
  4: "h-4 w-4",
  5: "h-5 w-5",
  6: "h-6 w-6",
  7: "h-7 w-7",
  8: "h-8 w-8",
}

function resolveProvider(model: string) {
  const lower = model.toLowerCase()
  for (const [prefix, info] of Object.entries(PROVIDER_MAP)) {
    if (lower.startsWith(prefix)) return info
  }
  return { src: "", bg: "bg-slate-50", fallback: model.charAt(0).toUpperCase(), imageClass: "" }
}

export function ModelIcon({ model, size = 5 }: { model: string; size?: 4 | 5 | 6 | 7 | 8 }) {
  const provider = resolveProvider(model)
  const sizeCls = SIZE_MAP[size] || SIZE_MAP[5]

  if (provider.src) {
    return <img src={provider.src} alt="" className={`${sizeCls} shrink-0 object-contain ${provider.imageClass || ""}`} />
  }

  return (
    <div className={`${sizeCls} ${provider.bg} rounded-md shrink-0 flex items-center justify-center text-[10px] font-bold`}>
      {provider.fallback}
    </div>
  )
}

export function ModelName({ model, upstreamModel, mono = true }: { model: string; upstreamModel?: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <ModelIcon model={model} />
      <span className={`truncate ${mono ? "font-mono" : ""} text-xs`}>{model}</span>
      {upstreamModel && upstreamModel !== model && (
        <span className="text-muted-foreground text-[10px] truncate">({upstreamModel})</span>
      )}
    </div>
  )
}
