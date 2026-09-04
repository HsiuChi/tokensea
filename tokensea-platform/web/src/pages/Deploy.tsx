import { useState } from "react"
import { Check, ChevronRight, Clipboard, Code2, PackageCheck, TerminalSquare } from "lucide-react"

const clients = [
  { name: "CC Switch", description: "一键导入 TokenSea 服务配置", icon: "CC", accent: "bg-blue-600" },
  { name: "Cherry Studio", description: "快速配置 OpenAI 兼容接口", icon: "CS", accent: "bg-rose-500" },
  { name: "Claude Code", description: "生成终端环境变量配置", icon: "CL", accent: "bg-orange-500" },
  { name: "Cursor", description: "配置自定义模型与 Base URL", icon: "CU", accent: "bg-slate-900" },
]

const setupGuides: Record<string, { steps: string[]; config: string }> = {
  "CC Switch": { steps: ["打开 CC Switch 的供应商管理", "新增 OpenAI 兼容供应商", "填入下方 Base URL 与您的 API 密钥"], config: "Base URL: https://api.tokensea.dev/v1\nAPI Key: YOUR_TOKEN" },
  "Cherry Studio": { steps: ["进入设置 → 模型服务", "添加 OpenAI 兼容服务", "保存后从模型列表选择 TokenSea 模型"], config: "Provider: OpenAI Compatible\nBase URL: https://api.tokensea.dev/v1\nAPI Key: YOUR_TOKEN" },
  "Claude Code": { steps: ["复制环境变量到终端", "将 YOUR_TOKEN 替换为您的 API 密钥", "重新启动 Claude Code"], config: "export ANTHROPIC_BASE_URL=https://api.tokensea.dev\nexport ANTHROPIC_AUTH_TOKEN=YOUR_TOKEN" },
  "Cursor": { steps: ["打开 Cursor Settings → Models", "开启 Override OpenAI Base URL", "填入 Base URL 与 API 密钥"], config: "OPENAI_BASE_URL=https://api.tokensea.dev/v1\nOPENAI_API_KEY=YOUR_TOKEN" },
}

export function DeployPage() {
  const [copied, setCopied] = useState("")
  const [selectedClient, setSelectedClient] = useState("CC Switch")
  const baseUrl = "https://api.tokensea.dev/v1"

  function copy(value: string, key: string) {
    navigator.clipboard.writeText(value)
    setCopied(key)
    window.setTimeout(() => setCopied(""), 1600)
  }

  return <div className="space-y-6">
    <div><h1 className="text-2xl font-extrabold tracking-tight">一键部署</h1><p className="mt-1 text-sm text-slate-500">选择常用客户端，快速完成 TokenSea API 接入</p></div>
    <section className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-600 to-cyan-500 p-6 text-white shadow-lg shadow-blue-500/15">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><PackageCheck className="h-5 w-5" /><h2 className="font-extrabold">开始前请先创建 API 密钥</h2></div><p className="mt-2 text-sm text-blue-50">所有客户端共用同一个 Base URL，密钥仅保存在您的设备中。</p></div><a href="/app/keys" className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-bold text-blue-600">管理 API 密钥<ChevronRight className="h-4 w-4" /></a></div>
    </section>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{clients.map((client) => <article key={client.name} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <span className={`flex h-11 w-11 items-center justify-center rounded-xl text-xs font-black text-white ${client.accent}`}>{client.icon}</span><h2 className="mt-4 font-extrabold">{client.name}</h2><p className="mt-2 min-h-10 text-sm leading-5 text-slate-500">{client.description}</p><button onClick={() => setSelectedClient(client.name)} className={`mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border text-sm font-bold ${selectedClient === client.name ? "border-blue-600 bg-blue-600 text-white" : "border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100 dark:border-blue-500/20 dark:bg-blue-500/10"}`}><ChevronRight className="h-4 w-4" />{selectedClient === client.name ? "当前选择" : "查看配置"}</button>
    </article>)}</div>
    <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-5 lg:flex-row lg:justify-between">
        <div><p className="text-xs font-bold uppercase tracking-wider text-blue-600">{selectedClient}</p><h2 className="mt-2 text-lg font-extrabold">配置步骤</h2><ol className="mt-4 space-y-3">{setupGuides[selectedClient].steps.map((step, index) => <li key={step} className="flex items-start gap-3 text-sm text-slate-600 dark:text-slate-300"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-bold text-blue-600 dark:bg-blue-500/10">{index + 1}</span><span className="pt-0.5">{step}</span></li>)}</ol></div>
        <div className="w-full lg:max-w-xl"><p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">配置内容</p><div className="relative rounded-xl bg-slate-950 p-4 pr-12 font-mono text-sm leading-6 text-slate-200"><pre className="overflow-x-auto whitespace-pre-wrap">{setupGuides[selectedClient].config}</pre><button aria-label="复制配置" onClick={() => copy(setupGuides[selectedClient].config, "client")} className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20">{copied === "client" ? <Check className="h-4 w-4 text-emerald-400" /> : <Clipboard className="h-4 w-4" />}</button></div></div>
      </div>
    </section>
    <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-3"><TerminalSquare className="h-5 w-5 text-blue-600" /><div><h2 className="font-extrabold">手动配置</h2><p className="mt-1 text-sm text-slate-500">适用于任何 OpenAI API 兼容客户端</p></div></div>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div><p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Base URL</p><button onClick={() => copy(baseUrl, "url")} className="flex w-full items-center justify-between rounded-xl bg-slate-50 px-4 py-3 font-mono text-sm dark:bg-slate-800"><span>{baseUrl}</span>{copied === "url" ? <Check className="h-4 w-4 text-emerald-500" /> : <Clipboard className="h-4 w-4 text-slate-400" />}</button></div>
        <div><p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">环境变量示例</p><button onClick={() => copy(`OPENAI_BASE_URL=${baseUrl}`, "env")} className="flex w-full items-center justify-between rounded-xl bg-slate-50 px-4 py-3 font-mono text-sm dark:bg-slate-800"><span className="truncate">OPENAI_BASE_URL={baseUrl}</span>{copied === "env" ? <Check className="h-4 w-4 text-emerald-500" /> : <Code2 className="h-4 w-4 text-slate-400" />}</button></div>
      </div>
    </section>
  </div>
}
