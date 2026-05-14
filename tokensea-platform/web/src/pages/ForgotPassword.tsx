import { useState } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useTheme } from "@/hooks/useTheme"
import { api } from "@/services/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Moon, Sun, Monitor, Languages } from "lucide-react"

export function ForgotPasswordPage() {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()
  const { i18n } = useTranslation()
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      await api.forgotPassword(email)
      setSent(true)
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
          <CardTitle className="text-xl">{t("auth.forgotPassword")}</CardTitle>
          <CardDescription>{t("auth.forgotPasswordDescription")}</CardDescription>
        </CardHeader>
        {sent ? (
          <CardContent className="space-y-4">
            <div className="rounded-md bg-emerald-500/10 p-4 text-sm text-emerald-600 dark:text-emerald-400">
              {t("auth.passwordResetEmailSent")}
            </div>
          </CardContent>
        ) : (
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              {error && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">{t("auth.email")}</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder={t("auth.emailPlaceholder")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </CardContent>
            <CardFooter className="flex-col gap-3">
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? t("auth.sending") : t("auth.sendResetLink")}
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
