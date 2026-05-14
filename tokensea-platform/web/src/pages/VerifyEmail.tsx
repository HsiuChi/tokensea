import { useState, useRef, useEffect, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { Mail, Loader2, CheckCircle, AlertCircle, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import api from "@/lib/api"
import { useAuth } from "@/hooks/useAuth"
import { useTranslation } from "react-i18next"

export function VerifyEmailPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user, refreshUser } = useAuth()
  const [code, setCode] = useState(["", "", "", "", "", ""])
  const [loading, setLoading] = useState(false)
  const [resendLoading, setResendLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  const handleChange = (index: number, value: string) => {
    if (!/^\d?$/.test(value)) return
    const newCode = [...code]
    newCode[index] = value
    setCode(newCode)
    setError("")
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

  const fullCode = code.join("")

  const handleVerify = useCallback(async () => {
    if (fullCode.length !== 6) {
      setError(t("verifyEmail.invalidCode") || "Please enter a 6-digit code")
      return
    }
    setLoading(true)
    setError("")
    setSuccess("")
    try {
      await api.post("/api/auth/verify-email", { code: fullCode })
      setSuccess(t("verifyEmail.success") || "Email verified successfully")
      refreshUser().then(() => {
        setTimeout(() => navigate("/app"), 1500)
      })
    } catch (err: any) {
      setError(err.message || t("verifyEmail.invalidCode") || "Invalid or expired code")
      setCode(["", "", "", "", "", ""])
      inputRefs.current[0]?.focus()
    } finally {
      setLoading(false)
    }
  }, [fullCode, navigate, refreshUser, t])

  useEffect(() => {
    if (fullCode.length === 6 && !loading && !success) {
      handleVerify()
    }
  }, [fullCode, handleVerify, loading, success])

  const handleResend = async () => {
    setResendLoading(true)
    setError("")
    setSuccess("")
    try {
      await api.post("/api/auth/resend-verification")
      setSuccess(t("verifyEmail.resent") || "Verification code sent")
      setCode(["", "", "", "", "", ""])
      inputRefs.current[0]?.focus()
    } catch (err: any) {
      setError(err.message || t("verifyEmail.resendFailed") || "Failed to resend")
    } finally {
      setResendLoading(false)
    }
  }

  if (user?.emailVerified) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CheckCircle className="mx-auto h-12 w-12 text-emerald-500" />
            <CardTitle className="mt-4">{t("verifyEmail.alreadyVerified") || "Email already verified"}</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <Button onClick={() => navigate("/app")}>{t("verifyEmail.goToConsole") || "Go to Console"}</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <Mail className="mx-auto h-12 w-12 text-blue-500" />
          <CardTitle className="mt-4">{t("verifyEmail.title") || "Verify your email"}</CardTitle>
          <CardDescription>
            {(t("verifyEmail.description") || "We've sent a 6-digit code to") + " " + (user?.email || "your email")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
              <CheckCircle className="h-4 w-4 shrink-0" />
              <span>{success}</span>
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
                  "h-12 w-12 rounded-xl border-2 bg-white text-center text-xl font-bold text-slate-900 outline-none transition " +
                  (digit
                    ? "border-blue-500 shadow-sm shadow-blue-200"
                    : "border-slate-200") +
                  " focus:border-blue-600 focus:ring-4 focus:ring-blue-100"
                }
                disabled={loading}
              />
            ))}
          </div>

          {loading && (
            <div className="flex items-center justify-center py-2">
              <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
              <span className="ml-2 text-sm text-slate-500">{t("verifyEmail.verifying") || "Verifying..."}</span>
            </div>
          )}

          <Button
            className="w-full"
            onClick={handleResend}
            disabled={resendLoading}
            variant="outline"
          >
            {resendLoading ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("verifyEmail.sending") || "Sending..."}</>
            ) : (
              <><Send className="mr-2 h-4 w-4" />{t("verifyEmail.resend") || "Resend code"}</>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
