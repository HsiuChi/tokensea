import { useState, useEffect } from "react"
import { useNavigate, Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/hooks/useAuth"
import { Loader2, Send } from "lucide-react"
import { ThemeToggle } from "@/components/ThemeToggle"

export function RegisterPage() {
  const { t } = useTranslation()
  const { i18n } = useTranslation()
  const { register, sendRegisterCode } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [agreedToTerms, setAgreedToTerms] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [countdown, setCountdown] = useState(0)

  useEffect(() => {
    if (countdown <= 0) return
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000)
    return () => clearTimeout(timer)
  }, [countdown])

  async function handleSendCode() {
    if (!email.trim()) {
      setError(t("auth.emailRequired") || "Please enter your email")
      return
    }
    setSendingCode(true)
    setError("")
    try {
      await sendRegisterCode(email.trim())
      setCountdown(60)
    } catch (err: any) {
      setError(err.message || t("auth.sendCodeFailed") || "Failed to send code")
    } finally {
      setSendingCode(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    if (!email.trim()) {
      setError(t("auth.emailRequired") || "Email is required")
      return
    }
    if (!code.trim()) {
      setError(t("auth.codeRequired") || "Please enter the verification code")
      return
    }
    setLoading(true)
    try {
      await register(username, password, email.trim(), code.trim())
      navigate("/app", { replace: true })
    } catch (err: any) {
      setError(err.message || t("auth.registerFailed"))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#eef6ff] text-slate-950 dark:bg-[#050b14] dark:text-slate-100">
      {/* Background effects — light */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(255,255,255,0.95)_0,rgba(255,255,255,0.7)_28%,rgba(219,235,255,0.58)_52%,rgba(128,184,255,0.45)_100%)] dark:hidden" />
      <div className="absolute -right-40 top-0 h-[620px] w-[760px] rounded-full bg-blue-300/30 blur-3xl dark:hidden" />
      <div className="absolute bottom-[-260px] left-[34%] h-[520px] w-[980px] rounded-[50%] border border-blue-300/60 bg-gradient-to-r from-blue-400/20 via-sky-300/25 to-indigo-500/25 blur-[1px] dark:hidden" />
      <div className="absolute bottom-[-210px] right-[-120px] h-[460px] w-[780px] rounded-[50%] border border-blue-200/70 bg-blue-500/20 dark:hidden" />
      <div className="absolute bottom-0 left-0 right-0 h-52 bg-gradient-to-t from-blue-500/20 to-transparent dark:hidden" />
      {/* Background effects — dark */}
      <div className="absolute inset-0 hidden bg-[radial-gradient(circle_at_20%_15%,rgba(15,23,42,0.9)_0,rgba(5,11,20,0.95)_100%)] dark:block" />
      <div className="absolute -right-40 top-0 hidden h-[620px] w-[760px] rounded-full bg-blue-800/20 blur-3xl dark:block" />
      <div className="absolute bottom-0 left-0 right-0 hidden h-52 bg-gradient-to-t from-blue-900/20 to-transparent dark:block" />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-8 py-7">
        <div className="flex items-center" style={{ gap: 20 }}>
          <img src="data:image/png;base64,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" alt="TokenSea" style={{ height: 72, width: 'auto', borderRadius: 18, objectFit: 'contain' }} />
          <span style={{ fontFamily: 'Montserrat, Inter, sans-serif', fontSize: 48, fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1 }}>
            <span className="text-[#0f2b50] dark:text-slate-100">Token</span><span style={{ color: '#1688e8' }}>sea</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => i18n.changeLanguage(i18n.language === "en" ? "zh" : "en")}
            className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-white/50 dark:text-slate-300 dark:hover:bg-white/10"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
              <path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            {i18n.language === "en" ? "中文" : "EN"}
          </button>
          <ThemeToggle />
        </div>
      </header>

      {/* Main content */}
      <main className="relative z-10 mx-auto grid min-h-[calc(100vh-92px)] max-w-[1180px] grid-cols-[1.05fr_0.95fr] items-center gap-20 px-8 pb-20">
        {/* Left: Marketing */}
        <section className="pt-4">
          <p className="mb-5 inline-flex rounded-full border border-blue-200 bg-white/60 px-4 py-2 text-sm font-bold text-blue-700 shadow-sm backdrop-blur dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-400">
            {t("auth.badge", { defaultValue: "一个 Key，多模型随意切换" })}
          </p>
          <h1 className="text-[54px] font-black leading-[1.08] tracking-tight text-slate-950 dark:text-slate-100">
            API {t("auth.relay", { defaultValue: "中转" })} &
            <br />
            <span className="bg-gradient-to-r from-blue-600 via-cyan-500 to-indigo-500 bg-clip-text text-transparent">{t("auth.heroHighlight", { defaultValue: "AI 模型调用平台" })}</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg font-medium leading-8 text-slate-600 dark:text-slate-400">
            {t("auth.heroDesc", { defaultValue: "聚合 GPT、Gemini、Claude 等模型能力，统一 base URL、统一密钥管理、统一用量统计，让开发接入更简单。" })}
          </p>

          {/* Decorative card */}
          <div className="relative mt-14 h-[250px] max-w-[520px]">
            <div className="absolute left-10 top-10 h-40 w-40 rounded-[34px] bg-gradient-to-br from-blue-600 to-cyan-400 shadow-2xl shadow-blue-500/30 rotate-[-8deg]" />
            <div className="absolute left-36 top-0 w-[290px] rounded-[28px] border border-white/70 bg-white/75 p-6 shadow-2xl shadow-blue-500/15 backdrop-blur-xl dark:border-white/10 dark:bg-[#1e293b]/75">
              <div className="mb-4 flex items-center justify-between">
                <div className="text-xl font-black">TokenSea API</div>
                <div className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">ONLINE</div>
              </div>
              <div className="space-y-3 text-sm font-semibold text-slate-600 dark:text-slate-400">
                <div className="flex justify-between"><span>{t("auth.cardGateway", { defaultValue: "统一网关" })}</span><span className="text-blue-600 dark:text-blue-400">/v1</span></div>
                <div className="flex justify-between"><span>{t("auth.cardModel", { defaultValue: "模型切换" })}</span><span>GPT / Gemini</span></div>
                <div className="flex justify-between"><span>{t("auth.cardKey", { defaultValue: "密钥管理" })}</span><span>{t("auth.cardSecure", { defaultValue: "安全加密" })}</span></div>
              </div>
              <div className="mt-5 h-2 rounded-full bg-slate-100 dark:bg-slate-700"><div className="h-2 w-4/5 rounded-full bg-blue-500 dark:bg-blue-400" /></div>
            </div>
            <svg viewBox="0 0 24 24" fill="none" className="absolute left-[450px] top-16 h-8 w-8 text-indigo-400" aria-hidden>
              <path d="M12 2 14.6 9.4 22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6L12 2Z" fill="currentColor" />
            </svg>
            <svg viewBox="0 0 24 24" fill="none" className="absolute left-0 top-36 h-10 w-10 text-cyan-400" aria-hidden>
              <path d="M12 2 14.6 9.4 22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6L12 2Z" fill="currentColor" />
            </svg>
            <div className="absolute bottom-2 left-64 rounded-2xl bg-white/70 px-4 py-3 text-sm font-black text-blue-700 shadow-lg shadow-blue-500/10 backdrop-blur dark:bg-[#1e293b]/70 dark:text-blue-400">
              base_url {t("auth.oneClickReplace", { defaultValue: "一键替换" })}
            </div>
          </div>
        </section>

        {/* Right: Register form */}
        <section className="rounded-[28px] border border-white/70 bg-white/82 p-10 shadow-[0_30px_90px_rgba(37,99,235,0.16)] backdrop-blur-2xl dark:border-white/10 dark:bg-[#0f172a]/82 dark:shadow-[0_30px_90px_rgba(0,0,0,0.4)]">
          <div className="mb-9 text-center">
            <h2 className="text-3xl font-black tracking-tight">{t("auth.createAccount")}</h2>
            <p className="mt-3 text-sm font-semibold text-slate-500 dark:text-slate-400">TokenSea</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="rounded-xl border border-red-500/30 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">{error}</div>
            )}
            <div>
              <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-300">{t("auth.username")}</label>
              <input
                className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-[#1e293b] dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:ring-blue-900"
                placeholder={t("auth.usernamePlaceholder")}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-300">{t("auth.email")}</label>
              <div className="flex gap-2">
                <input
                  type="email"
                  className="h-12 flex-1 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-[#1e293b] dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:ring-blue-900"
                  placeholder={t("auth.emailPlaceholder")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <button
                  type="button"
                  onClick={handleSendCode}
                  disabled={sendingCode || countdown > 0}
                  className="flex h-12 shrink-0 items-center gap-1 rounded-xl border border-blue-200 bg-blue-50 px-4 text-sm font-bold text-blue-600 transition hover:bg-blue-100 disabled:opacity-60 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-400 dark:hover:bg-blue-500/20"
                >
                  {sendingCode ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : countdown > 0 ? (
                    <span>{countdown}s</span>
                  ) : (
                    <><Send className="h-4 w-4" />{t("auth.getCode") || "获取验证码"}</>
                  )}
                </button>
              </div>
            </div>
            <div>
              <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-300">{t("auth.verificationCode") || "验证码"}</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-[#1e293b] dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:ring-blue-900"
                placeholder={t("auth.codePlaceholder") || "6-digit code"}
                value={code}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, "").slice(0, 6)
                  setCode(val)
                }}
                required
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-300">{t("auth.password")}</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 pr-12 text-sm font-semibold outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                  placeholder={t("auth.passwordPlaceholder")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-300"
                >
                  <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
                    <path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" stroke="currentColor" strokeWidth="2" />
                    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
                  </svg>
                </button>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm font-semibold text-slate-500 dark:text-slate-400">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-blue-600 dark:border-slate-600"
                checked={agreedToTerms}
                onChange={(e) => setAgreedToTerms(e.target.checked)}
              />
              {t("auth.agreeToTerms")}{" "}
              <span className="font-bold text-blue-600 cursor-pointer hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">{t("auth.termsOfService")}</span>{" "}
              {t("auth.and")}{" "}
              <span className="font-bold text-blue-600 cursor-pointer hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">{t("auth.privacyPolicy")}</span>
            </label>

            <button
              type="submit"
              disabled={loading || !agreedToTerms}
              className="group mt-2 flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-4 text-sm font-black text-white shadow-xl shadow-blue-500/25 transition hover:-translate-y-0.5 hover:bg-blue-700 disabled:opacity-60 disabled:hover:translate-y-0"
            >
              {loading ? t("auth.creatingAccount") : t("auth.createAccountBtn")}
              {!loading && (
                <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 transition group-hover:translate-x-1" aria-hidden>
                  <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          </form>

          <div className="my-8 flex items-center gap-4 text-xs font-bold text-slate-400 dark:text-slate-500">
            <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
            {t("auth.orContinueWith", { defaultValue: "使用其他方式登录" })}
            <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => alert(t("auth.comingSoon"))}
              className="h-11 rounded-full border border-slate-200 bg-white text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-[#1e293b] dark:text-slate-300 dark:hover:bg-white/5"
            >
              GitHub
            </button>
            <button
              type="button"
              onClick={() => alert(t("auth.comingSoon"))}
              className="h-11 rounded-full border border-slate-200 bg-white text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-[#1e293b] dark:text-slate-300 dark:hover:bg-white/5"
            >
              Google
            </button>
          </div>

          <p className="mt-8 text-center text-sm font-semibold text-slate-500 dark:text-slate-400">
            {t("auth.hasAccount")}{" "}
            <Link to="/login" className="font-black text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">{t("auth.signIn")}</Link>
          </p>
        </section>
      </main>

      {/* Footer */}
      <footer className="absolute bottom-6 left-0 right-0 z-10 text-center text-xs font-semibold text-white/80 dark:text-slate-500">
        ©2026 TokenSea · API Gateway & Multi-Model Platform
      </footer>
    </div>
  )
}
