import { useState } from "react"
import { Link, useSearchParams, useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useTheme } from "@/hooks/useTheme"
import { api } from "@/services/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Moon, Sun, Monitor, Languages } from "lucide-react"

export function ResetPasswordPage() {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()
  const { i18n } = useTranslation()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get("token")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")

    if (password !== confirmPassword) {
      setError(t("auth.passwordMismatch"))
      return
    }

    if (!token) {
      setError(t("auth.invalidResetToken"))
      return
    }

    setLoading(true)
    try {
      await api.resetPassword(token, password)
      setSuccess(true)
      setTimeout(() => navigate("/login"), 3000)
    } catch (err: any) {
      setError(err.message || t("auth.passwordResetFailed"))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="fixed top-4 right-4 flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => i18n.changeLanguage(i18n.language === "en" ? "zh" : "en")}>
          <Languages className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => {
          const next = theme === "light" ? "dark" : theme === "dark" ? "auto" : "light"
          setTheme(next)
        }}>
          {theme === "light" ? <Sun className="h-4 w-4" /> : theme === "dark" ? <Moon className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
        </Button>
      </div>

      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">
            TS
          </div>
          <CardTitle className="text-xl">{t("auth.resetPassword")}</CardTitle>
          <CardDescription>{t("auth.resetPasswordDescription")}</CardDescription>
        </CardHeader>
        {success ? (
          <CardContent className="space-y-4">
            <div className="rounded-md bg-emerald-500/10 p-4 text-sm text-emerald-600 dark:text-emerald-400">
              {t("auth.passwordResetSuccess")}
            </div>
          </CardContent>
        ) : (
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              {error && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
              )}
              <div className="space-y-2">
                <Label htmlFor="password">{t("auth.newPassword")}</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder={t("auth.passwordPlaceholder")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">{t("auth.confirmPassword")}</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder={t("auth.confirmPasswordPlaceholder")}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
            </CardContent>
            <CardFooter className="flex-col gap-3">
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? t("auth.resetting") : t("auth.resetPasswordBtn")}
              </Button>
              <p className="text-sm text-muted-foreground">
                <Link to="/login" className="text-primary hover:underline">{t("auth.backToLogin")}</Link>
              </p>
            </CardFooter>
          </form>
        )}
      </Card>
    </div>
  )
}
