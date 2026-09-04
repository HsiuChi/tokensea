import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Loader2, Send } from "lucide-react"
import { AuthPageShell } from "@/components/AuthPageShell"
import { useAuth } from "@/hooks/useAuth"

export function RegisterPage() {
  const { t } = useTranslation()
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
    <AuthPageShell wideForm>
      <section className="w-full max-w-[480px] justify-self-center rounded-[28px] border border-white/80 bg-white/88 p-7 shadow-[0_30px_90px_rgba(37,99,235,0.16)] backdrop-blur-2xl sm:p-9 dark:border-blue-400/15 dark:bg-[#0d1729]/88 dark:shadow-[0_30px_90px_rgba(0,0,0,0.42)]">
        <div className="mb-9 text-center">
          <h2 className="text-3xl font-black tracking-tight">{t("auth.createAccount")}</h2>
          <p className="mt-3 text-sm font-semibold text-slate-500 dark:text-slate-400">
            {t("auth.registerSubtitle", { defaultValue: "创建账户，开始调用你的第一个模型" })}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
              {error}
            </div>
          )}

          <div>
            <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-300">{t("auth.username")}</label>
            <input className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-[#1e293b] dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:ring-blue-900" placeholder={t("auth.usernamePlaceholder")} value={username} onChange={(e) => setUsername(e.target.value)} required />
          </div>

          <div>
            <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-300">{t("auth.email")}</label>
            <div className="flex gap-2">
              <input type="email" className="h-12 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-[#1e293b] dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:ring-blue-900" placeholder={t("auth.emailPlaceholder")} value={email} onChange={(e) => setEmail(e.target.value)} required />
              <button type="button" onClick={handleSendCode} disabled={sendingCode || countdown > 0} className="flex h-12 shrink-0 items-center gap-1 rounded-xl border border-blue-200 bg-blue-50 px-4 text-sm font-bold text-blue-600 transition hover:bg-blue-100 disabled:opacity-60 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-400 dark:hover:bg-blue-500/20">
                {sendingCode ? <Loader2 className="h-4 w-4 animate-spin" /> : countdown > 0 ? <span>{countdown}s</span> : <><Send className="h-4 w-4" />{t("auth.getCode") || "获取验证码"}</>}
              </button>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-300">{t("auth.verificationCode") || "验证码"}</label>
            <input type="text" inputMode="numeric" maxLength={6} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-[#1e293b] dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:ring-blue-900" placeholder={t("auth.codePlaceholder") || "6-digit code"} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} required />
          </div>

          <div>
            <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-300">{t("auth.password")}</label>
            <div className="relative">
              <input type={showPassword ? "text" : "password"} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 pr-12 text-sm font-semibold outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-[#1e293b] dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:ring-blue-900" placeholder={t("auth.passwordPlaceholder")} value={password} onChange={(e) => setPassword(e.target.value)} required />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-300" aria-label={showPassword ? "隐藏密码" : "显示密码"}>
                <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden><path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" stroke="currentColor" strokeWidth="2" /><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" /></svg>
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm font-semibold text-slate-500 dark:text-slate-400">
            <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-blue-600 dark:border-slate-600" checked={agreedToTerms} onChange={(e) => setAgreedToTerms(e.target.checked)} />
            <span>{t("auth.agreeToTerms")} <span className="cursor-pointer font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">{t("auth.termsOfService")}</span> {t("auth.and")} <span className="cursor-pointer font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">{t("auth.privacyPolicy")}</span></span>
          </label>

          <button type="submit" disabled={loading || !agreedToTerms} className="group mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-4 text-sm font-black text-white shadow-xl shadow-blue-500/25 transition hover:-translate-y-0.5 hover:bg-blue-700 disabled:opacity-60 disabled:hover:translate-y-0">
            {loading ? t("auth.creatingAccount") : t("auth.createAccountBtn")}
            {!loading && <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 transition group-hover:translate-x-1" aria-hidden><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
          </button>
        </form>

        <div className="my-8 flex items-center gap-4 text-xs font-bold text-slate-400 dark:text-slate-500"><div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />{t("auth.orContinueWith", { defaultValue: "使用其他方式登录" })}<div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" /></div>

        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={() => alert(t("auth.comingSoon"))} className="h-11 rounded-full border border-slate-200 bg-white text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-[#1e293b] dark:text-slate-300 dark:hover:bg-white/5">GitHub</button>
          <button type="button" onClick={() => alert(t("auth.comingSoon"))} className="h-11 rounded-full border border-slate-200 bg-white text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-[#1e293b] dark:text-slate-300 dark:hover:bg-white/5">Google</button>
        </div>

        <p className="mt-8 text-center text-sm font-semibold text-slate-500 dark:text-slate-400">{t("auth.hasAccount")} <Link to="/login" className="font-black text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">{t("auth.signIn")}</Link></p>
      </section>
    </AuthPageShell>
  )
}
