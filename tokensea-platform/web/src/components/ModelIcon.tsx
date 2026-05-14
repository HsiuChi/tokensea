const PROVIDER_MAP: Record<string, { src: string; bg: string; fallback: string }> = {
  claude:  { src: "/models/claude.svg",  bg: "bg-orange-50", fallback: "C" },
  anthropic: { src: "/models/claude.svg", bg: "bg-orange-50", fallback: "C" },
  openai:  { src: "/models/openai.svg",  bg: "bg-emerald-50", fallback: "G" },
  gpt:     { src: "/models/openai.svg",  bg: "bg-emerald-50", fallback: "G" },
  o1:      { src: "/models/openai.svg",  bg: "bg-emerald-50", fallback: "G" },
  o3:      { src: "/models/openai.svg",  bg: "bg-emerald-50", fallback: "G" },
  gemini:  { src: "/models/gemini.svg",  bg: "bg-blue-50", fallback: "G" },
  deepseek: { src: "", bg: "bg-violet-50", fallback: "D" },
  qwen:    { src: "", bg: "bg-purple-50", fallback: "Q" },
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
  return { src: "", bg: "bg-slate-50", fallback: model.charAt(0).toUpperCase() }
}

export function ModelIcon({ model, size = 5 }: { model: string; size?: 4 | 5 | 6 | 7 | 8 }) {
  const provider = resolveProvider(model)
  const sizeCls = SIZE_MAP[size] || SIZE_MAP[5]

  if (provider.src) {
    return <img src={provider.src} alt="" className={`${sizeCls} rounded-md shrink-0`} />
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
