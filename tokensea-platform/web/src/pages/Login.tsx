import { useState, useRef, useEffect, useCallback } from "react"
import { useNavigate, Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/hooks/useAuth"
import { Mail, Loader2, CheckCircle, AlertCircle, Send, ArrowLeft } from "lucide-react"
import { ThemeToggle } from "@/components/ThemeToggle"
import { AuthBrand } from "@/components/AuthBrand"
import api from "@/lib/api"

export function LoginPage() {
  const { t } = useTranslation()
  const { i18n } = useTranslation()
  const { login, refreshUser } = useAuth()
  const navigate = useNavigate()

  // Login form state
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  // Verification mode state
  const [mode, setMode] = useState<"login" | "verify">("login")
  const [verifyEmail, setVerifyEmail] = useState("")
  const [code, setCode] = useState(["", "", "", "", "", ""])
  const [verifyLoading, setVerifyLoading] = useState(false)
  const [verifyError, setVerifyError] = useState("")
  const [verifySuccess, setVerifySuccess] = useState("")
  const [resendLoading, setResendLoading] = useState(false)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  const fullCode = code.join("")

  const handleVerify = useCallback(async () => {
    if (fullCode.length !== 6) {
      setVerifyError(t("verifyEmail.invalidCode") || "Please enter a 6-digit code")
      return
    }
    setVerifyLoading(true)
    setVerifyError("")
    setVerifySuccess("")
    try {
      await api.post("/api/auth/verify-email", { code: fullCode })
      setVerifySuccess(t("verifyEmail.success") || "Email verified successfully")
      refreshUser().then(() => {
        setTimeout(() => navigate("/app"), 1500)
      })
    } catch (err: any) {
      setVerifyError(err.message || t("verifyEmail.invalidCode") || "Invalid or expired code")
      setCode(["", "", "", "", "", ""])
      inputRefs.current[0]?.focus()
    } finally {
      setVerifyLoading(false)
    }
  }, [fullCode, navigate, refreshUser, t])

  useEffect(() => {
    if (fullCode.length === 6 && !verifyLoading && !verifySuccess) {
      handleVerify()
    }
  }, [fullCode, handleVerify, verifyLoading, verifySuccess])

  const handleChange = (index: number, value: string) => {
    if (!/^\d?$/.test(value)) return
    const newCode = [...code]
    newCode[index] = value
    setCode(newCode)
    setVerifyError("")
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6)
    const newCode = [...code]
    pasted.split("").forEach((char, i) => {
      if (i < 6) newCode[i] = char
    })
    setCode(newCode)
    const focusIndex = Math.min(pasted.length, 5)
    inputRefs.current[focusIndex]?.focus()
  }

  const handleResend = async () => {
    setResendLoading(true)
    setVerifyError("")
    setVerifySuccess("")
    try {
      await api.post("/api/auth/resend-verification")
      setVerifySuccess(t("verifyEmail.resent") || "Verification code sent")
      setCode(["", "", "", "", "", ""])
      inputRefs.current[0]?.focus()
    } catch (err: any) {
      setVerifyError(err.message || t("verifyEmail.resendFailed") || "Failed to resend")
    } finally {
      setResendLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const user = await login(username, password)
      if (user.email && !user.emailVerified) {
        setVerifyEmail(user.email)
        setMode("verify")
      } else {
        navigate("/app", { replace: true })
      }
    } catch (err: any) {
      setError(err.message || t("auth.loginFailed"))
    } finally {
      setLoading(false)
    }
  }

  const backToLogin = () => {
    setMode("login")
    setCode(["", "", "", "", "", ""])
    setVerifyError("")
    setVerifySuccess("")
    setVerifyEmail("")
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#eef6ff] text-slate-950 dark:bg-[#050b14] dark:text-slate-100">
      {/* Background effects — light */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(255,255,255,0.95)_0,rgba(255,255,255,0.7)_28%,rgba(219,235,255,0.58)_52%,rgba(128,184,255,0.45)_100%)] dark:hidden" />
      <div className="absolute -right-40 top-0 h-[620px] w-[760px] rounded-full bg-blue-300/30 blur-3xl dark:hidden" />
      <div className="absolute bottom-[-260px] left-[34%] h-[520px] w-[980px] rounded-[50%] border border-blue-300/60 bg-gradient-to-r from-blue-400/20 via-sky-300/25 to-indigo-500/25 blur-[1px] dark:hidden" />
      <div className="absolute bottom-[-210px] right-[-120px] h-[460px] w-[780px] rounded-[50%] border border-blue-200/70 bg-blue-500/20 dark:hidden" />
      <div className="absolute bottom-0 left-0 right-0 h-52 bg-gradient-to-t from-blue-500/20 to-transparent dark:hidden" />
      {/* Background effects — dark */}
      <div className="absolute inset-0 hidden bg-[radial-gradient(circle_at_20%_15%,rgba(15,23,42,0.8)_0,rgba(5,11,20,0.6)_40%,rgba(2,6,12,0.9)_100%)] dark:block" />
      <div className="absolute -right-40 top-0 hidden h-[620px] w-[760px] rounded-full bg-blue-600/10 blur-3xl dark:block" />
      <div className="absolute bottom-[-260px] left-[34%] hidden h-[520px] w-[980px] rounded-[50%] border border-blue-500/20 bg-gradient-to-r from-blue-600/10 via-indigo-600/10 to-cyan-600/10 blur-[1px] dark:block" />
      <div className="absolute bottom-[-210px] right-[-120px] hidden h-[460px] w-[780px] rounded-[50%] border border-blue-500/15 bg-blue-600/10 dark:block" />
      <div className="absolute bottom-0 left-0 right-0 hidden h-52 bg-gradient-to-t from-blue-600/10 to-transparent dark:block" />

      {/* Header */}
      <header className="relative z-10 mx-auto flex max-w-[1380px] items-center justify-between px-6 py-5 sm:px-8 lg:px-10 lg:py-6">
        <AuthBrand />
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
      <main className="relative z-10 mx-auto grid min-h-[calc(100svh-112px)] max-w-[1240px] grid-cols-1 items-center gap-12 px-6 pb-16 pt-3 sm:px-8 lg:grid-cols-[1fr_440px] lg:gap-20 lg:px-10 lg:pb-20">
        {/* Left: Marketing */}
        <section className="hidden pt-4 lg:block">
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
                <div className="text-xl font-black dark:text-slate-100">TokenSea API</div>
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

        {/* Right: Login / Verify form */}
        <section className="w-full max-w-[440px] justify-self-center rounded-[28px] border border-white/80 bg-white/88 p-7 shadow-[0_30px_90px_rgba(37,99,235,0.16)] backdrop-blur-2xl sm:p-9 dark:border-blue-400/15 dark:bg-[#0d1729]/88 dark:shadow-[0_30px_90px_rgba(0,0,0,0.38)]">
          {mode === "login" ? (
            <>
              <div className="mb-9 text-center">
                <h2 className="text-3xl font-black tracking-tight">{t("auth.welcomeBack")}</h2>
                <p className="mt-3 text-sm font-semibold text-slate-500 dark:text-slate-400">{t("auth.signIn")} TokenSea</p>
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
                  <label className="mb-2 block text-sm font-bold text-slate-700 dark:text-slate-300">{t("auth.password")}</label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 pr-12 text-sm font-semibold outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-[#1e293b] dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:ring-blue-900"
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

                <div className="flex items-center justify-between text-sm dark:text-slate-300">
                  <label className="flex items-center gap-2 font-semibold text-slate-500 dark:text-slate-400">
                    <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-blue-600 dark:border-slate-600" />
                    {t("auth.rememberMe", { defaultValue: "记住登录状态" })}
                  </label>
                  <Link to="/forgot-password" className="font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">{t("auth.forgotPassword")}</Link>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="group mt-2 flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-4 text-sm font-black text-white shadow-xl shadow-blue-500/25 transition hover:-translate-y-0.5 hover:bg-blue-700 disabled:opacity-60 disabled:hover:translate-y-0"
                >
                  {loading ? t("auth.signingIn") : t("auth.signIn")}
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
                {t("auth.noAccount")}{" "}
                <Link to="/register" className="font-black text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">{t("auth.signUp")}</Link>
              </p>
            </>
          ) : (
            <>
              <div className="mb-9 text-center">
                <Mail className="mx-auto h-12 w-12 text-blue-500" />
                <h2 className="mt-4 text-3xl font-black tracking-tight dark:text-slate-100">{t("verifyEmail.title") || "Verify your email"}</h2>
                <p className="mt-3 text-sm font-semibold text-slate-500 dark:text-slate-400">
                  {(t("verifyEmail.description") || "We've sent a 6-digit code to") + " " + verifyEmail}
                </p>
              </div>

              <div className="space-y-4">
                {verifyError && (
                  <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{verifyError}</span>
                  </div>
                )}
                {verifySuccess && (
                  <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-600 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400">
                    <CheckCircle className="h-4 w-4 shrink-0" />
                    <span>{verifySuccess}</span>
                  </div>
                )}

                <div className="flex justify-center gap-2">
                  {code.map((digit, i) => (
                    <input
                      key={i}
                      ref={(el) => { inputRefs.current[i] = el }}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleChange(i, e.target.value)}
                      onKeyDown={(e) => handleKeyDown(i, e)}
                      onPaste={handlePaste}
                      className={
                        "h-12 w-12 rounded-xl border-2 bg-white text-center text-xl font-bold text-slate-900 outline-none transition dark:bg-[#1e293b] dark:text-slate-100 " +
                        (digit
                          ? "border-blue-500 shadow-sm shadow-blue-200 dark:border-blue-400 dark:shadow-blue-900/30"
                          : "border-slate-200 dark:border-slate-600") +
                        " focus:border-blue-600 focus:ring-4 focus:ring-blue-100 dark:focus:ring-blue-900"
                      }
                      disabled={verifyLoading}
                    />
                  ))}
                </div>

                {verifyLoading && (
                  <div className="flex items-center justify-center py-2">
                    <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                    <span className="ml-2 text-sm text-slate-500 dark:text-slate-400">{t("verifyEmail.verifying") || "Verifying..."}</span>
                  </div>
                )}

                <button
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-[#1e293b] dark:text-slate-300 dark:hover:bg-white/5"
                  onClick={handleResend}
                  disabled={resendLoading}
                >
                  {resendLoading ? (
                    <><Loader2 className="h-4 w-4 animate-spin" />{t("verifyEmail.sending") || "Sending..."}</>
                  ) : (
                    <><Send className="h-4 w-4" />{t("verifyEmail.resend") || "Resend code"}</>
                  )}
                </button>

                <button
                  className="flex w-full items-center justify-center gap-1 text-sm font-semibold text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400"
                  onClick={backToLogin}
                >
                  <ArrowLeft className="h-4 w-4" />
                  {t("auth.backToLogin", { defaultValue: "Back to login" })}
                </button>
              </div>
            </>
          )}
        </section>
      </main>

      {/* Footer */}
      <footer className="absolute bottom-6 left-0 right-0 z-10 text-center text-xs font-semibold text-white/80">
        ©2026 TokenSea · API Gateway & Multi-Model Platform
      </footer>
    </div>
  )
}
