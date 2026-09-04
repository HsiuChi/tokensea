import { LogoMark } from "@/components/LogoMark"
import { ModelIcon } from "@/components/ModelIcon"
import { useTranslation } from "react-i18next"

const providers = [
  { model: "gpt-5", label: "GPT" },
  { model: "claude", label: "Claude" },
  { model: "deepseek", label: "DeepSeek" },
  { model: "kimi", label: "Kimi" },
  { model: "glm", label: "GLM" },
]

export function AuthHero() {
  const { t } = useTranslation()

  return (
    <section className="hidden min-w-0 self-center xl:block">
      <p className="mb-5 inline-flex rounded-full border border-blue-200/90 bg-white/70 px-4 py-2 text-sm font-bold tracking-wide text-blue-700 shadow-sm shadow-blue-900/5 backdrop-blur dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-300">
        {t("auth.heroBadge", { defaultValue: "统一入口 · 自由选择" })}
      </p>

      <h1 className="text-[52px] font-black leading-[1.08] tracking-[-0.045em] text-[#08152f] 2xl:text-[58px] dark:text-slate-50">
        {t("auth.heroTitlePrimary", { defaultValue: "让模型各展所长" })}
        <br />
        <span className="bg-gradient-to-r from-blue-600 via-sky-500 to-cyan-400 bg-clip-text text-transparent dark:from-blue-400 dark:via-sky-300 dark:to-cyan-300">
          {t("auth.heroTitleAccent", { defaultValue: "让接入始终如一" })}
        </span>
      </h1>

      <div className="mt-6 max-w-[650px] space-y-1 text-[17px] font-medium leading-7 text-slate-600 dark:text-slate-400">
        <p>{t("auth.heroDescLead", { defaultValue: "模型持续进化，接入无需从头再来。" })}</p>
        <p>{t("auth.heroDescModels", { defaultValue: "用一个 API Key 连接 GPT、Claude、DeepSeek、Kimi 与 GLM，" })}</p>
        <p>{t("auth.heroDescClose", { defaultValue: "自由切换，稳定抵达。" })}</p>
      </div>

      <div className="relative mt-9 h-[212px] w-[650px] max-w-full" aria-label={t("auth.routingDiagram", { defaultValue: "TokenSea 模型路由示意图" })}>
        <svg className="pointer-events-none absolute inset-0 h-full w-full text-blue-400/80 dark:text-blue-400/60" viewBox="0 0 650 212" fill="none" aria-hidden>
          <path d="M210 106H260" stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 5" />
          <path d="M428 106H472M472 18V194" stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 5" />
          {[18, 62, 106, 150, 194].map((y) => (
            <path key={y} d={`M472 ${y}H496`} stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 5" />
          ))}
          <circle cx="210" cy="106" r="4" fill="currentColor" />
          <circle cx="260" cy="106" r="4" fill="currentColor" />
          <circle cx="428" cy="106" r="4" fill="currentColor" />
        </svg>

        <div className="absolute left-0 top-[26px] h-[160px] w-[210px] rounded-2xl border border-white/90 bg-white/78 p-4 shadow-[0_18px_55px_rgba(37,99,235,0.12)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/75 dark:shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
          <div className="border-b border-slate-200/80 pb-3 font-mono text-[11px] font-bold dark:border-slate-700/80">
            <span className="text-blue-600 dark:text-blue-400">POST</span>{" "}
            <span className="text-slate-700 dark:text-slate-300">/v1/chat/completions</span>
          </div>
          <pre className="mt-3 whitespace-pre-wrap font-mono text-[11px] leading-5 text-slate-500 dark:text-slate-400">
            <span className="text-slate-700 dark:text-slate-300">{"{"}</span>{"\n"}
            {"  "}<span className="text-cyan-700 dark:text-cyan-300">"model"</span>: <span className="text-emerald-700 dark:text-emerald-300">"auto"</span>,{"\n"}
            {"  "}<span className="text-cyan-700 dark:text-cyan-300">"messages"</span>: [...],{"\n"}
            {"  "}<span className="text-cyan-700 dark:text-cyan-300">"stream"</span>: true{"\n"}
            <span className="text-slate-700 dark:text-slate-300">{"}"}</span>
          </pre>
        </div>

        <div className="absolute left-[260px] top-[42px] flex h-[126px] w-[168px] flex-col items-center justify-center rounded-2xl border border-white/90 bg-white/82 shadow-[0_20px_65px_rgba(37,99,235,0.16)] backdrop-blur-xl dark:border-blue-300/15 dark:bg-[#0e1a2e]/88 dark:shadow-[0_22px_65px_rgba(0,0,0,0.36)]">
          <LogoMark size={38} />
          <div className="mt-2 text-lg font-black tracking-tight text-[#0b1b36] dark:text-slate-100">TokenSea</div>
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">{t("auth.apiGateway", { defaultValue: "API 网关" })}</div>
        </div>

        <div className="absolute left-[287px] top-[177px] inline-flex items-center gap-2 rounded-full border border-emerald-200/70 bg-emerald-50/90 px-3 py-1.5 text-xs font-bold text-emerald-700 shadow-sm dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300">
          <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]" />
          {t("auth.serviceAvailable", { defaultValue: "服务可用" })}
        </div>

        <div className="absolute left-[496px] top-0 flex w-[144px] flex-col gap-2">
          {providers.map(({ model, label }) => (
            <div key={model} className="flex h-9 items-center gap-2.5 rounded-xl border border-white/90 bg-white/82 px-3 shadow-[0_8px_24px_rgba(37,99,235,0.10)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/78 dark:shadow-[0_10px_26px_rgba(0,0,0,0.24)]">
              <ModelIcon model={model} size={5} />
              <span className="flex-1 text-xs font-bold text-slate-700 dark:text-slate-200">{label}</span>
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
