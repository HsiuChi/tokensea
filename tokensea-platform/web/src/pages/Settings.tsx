import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/services/api"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { useTheme } from "@/hooks/useTheme"
import {
  Save,
  Check,
  Copy,
  Key,
  Shield,
  Trash2,
  Mail,
  UserCircle,
  Bell,
  Eye,
  EyeOff,
} from "lucide-react"

export function SettingsPage() {
  const { t } = useTranslation()
  const { user, refreshUser } = useAuth()
  const { theme, setTheme } = useTheme()
  const { i18n } = useTranslation()

  // Profile state
  const [name, setName] = useState(user?.name || "")
  const [email, setEmail] = useState(user?.email || "")
  const [savingProfile, setSavingProfile] = useState(false)
  const [savedProfile, setSavedProfile] = useState(false)

  // Password state
  const [oldPassword, setOldPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmNewPassword, setConfirmNewPassword] = useState("")
  const [showOldPassword, setShowOldPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordChanged, setPasswordChanged] = useState(false)
  const [passwordError, setPasswordError] = useState("")

  // Delete account state
  const [deleteConfirmText, setDeleteConfirmText] = useState("")
  const [deletingAccount, setDeletingAccount] = useState(false)

  // API token state
  const [showToken, setShowToken] = useState(false)
  const [copiedToken, setCopiedToken] = useState(false)

  // Invite code state
  const [copiedInvite, setCopiedInvite] = useState(false)

  // Notification preferences (visual only)
  const [emailNotifications, setEmailNotifications] = useState(true)
  const [quotaAlerts, setQuotaAlerts] = useState(true)

  const jwtToken = localStorage.getItem("token") || ""

  // Profile save handler
  const handleSaveProfile = async () => {
    setSavingProfile(true)
    setSavedProfile(false)
    try {
      await api.updateSelf({ name: name || undefined, email: email || undefined })
      await refreshUser()
      setSavedProfile(true)
      setTimeout(() => setSavedProfile(false), 3000)
    } catch (err: any) {
      alert(err.message)
    } finally {
      setSavingProfile(false)
    }
  }

  // Password change handler
  const handleChangePassword = async () => {
    setPasswordError("")
    setPasswordChanged(false)

    if (!oldPassword || !newPassword || !confirmNewPassword) {
      setPasswordError(t("common.required"))
      return
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError(t("settings.passwordMismatch"))
      return
    }
    if (newPassword.length < 8) {
      setPasswordError(t("auth.passwordTooShort"))
      return
    }

    setSavingPassword(true)
    try {
      await api.changePassword(oldPassword, newPassword)
      setPasswordChanged(true)
      setOldPassword("")
      setNewPassword("")
      setConfirmNewPassword("")
      setTimeout(() => setPasswordChanged(false), 3000)
    } catch (err: any) {
      setPasswordError(err.message)
    } finally {
      setSavingPassword(false)
    }
  }

  // Delete account handler
  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== user?.username) {
      alert(t("settings.deleteAccountConfirm"))
      return
    }
    setDeletingAccount(true)
    try {
      await api.deleteAccount()
      localStorage.removeItem("token")
      window.location.href = "/login"
    } catch (err: any) {
      alert(err.message || t("settings.deleteAccountWarning"))
    } finally {
      setDeletingAccount(false)
    }
  }

  // Copy to clipboard helper
  const copyToClipboard = (text: string, setCopied: (v: boolean) => void) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("settings.title")}</h1>
        <p className="text-muted-foreground">{t("settings.subtitle")}</p>
      </div>

      <Tabs defaultValue="profile" className="space-y-4">
        <TabsList>
          <TabsTrigger value="profile" className="gap-2">
            <UserCircle className="h-4 w-4" />
            {t("settings.profile")}
          </TabsTrigger>
          <TabsTrigger value="security" className="gap-2">
            <Shield className="h-4 w-4" />
            {t("settings.security")}
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2">
            <Bell className="h-4 w-4" />
            {t("settings.notifications")}
          </TabsTrigger>
        </TabsList>

        {/* ============ Profile Tab ============ */}
        <TabsContent value="profile" className="space-y-4">
          {/* Profile Card */}
          <Card>
            <CardHeader>
              <CardTitle>{t("settings.profile")}</CardTitle>
              <CardDescription>{t("settings.subtitle")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 max-w-lg">
              <div className="space-y-2">
                <Label>{t("admin.users.username")}</Label>
                <Input value={user?.username || ""} disabled className="opacity-50" />
              </div>
              <div className="space-y-2">
                <Label>{t("settings.displayName")}</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("settings.displayNamePlaceholder")}
                />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  {t("settings.email")}
                </Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
                {user?.email && (
                  <p className="text-xs text-muted-foreground">
                    {t("settings.email")}: {user.email}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>{t("common.role")}</Label>
                <Input value={user?.role || ""} disabled className="opacity-50 capitalize" />
              </div>
              <Button onClick={handleSaveProfile} disabled={savingProfile}>
                {savingProfile ? (
                  <>
                    <Save className="mr-2 h-4 w-4 animate-spin" />
                    {t("common.saving")}
                  </>
                ) : savedProfile ? (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    {t("common.saved")}
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    {t("common.saveChanges")}
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Invite Code Card */}
          <Card>
            <CardHeader>
              <CardTitle>{t("usage.inviteCode")}</CardTitle>
              <CardDescription>{t("usage.shareToEarn")}</CardDescription>
            </CardHeader>
            <CardContent className="max-w-lg">
              <div className="flex items-center gap-3">
                <div className="flex-1 rounded-md border bg-muted/50 px-4 py-2.5 font-mono text-sm tracking-wider">
                  {user?.inviteCode || "---"}
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(user?.inviteCode || "", setCopiedInvite)}
                  disabled={!user?.inviteCode}
                  title={t("common.copy")}
                >
                  {copiedInvite ? (
                    <Check className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              {copiedInvite && (
                <p className="mt-2 text-xs text-emerald-500">{t("common.copied")}</p>
              )}
            </CardContent>
          </Card>

          {/* Preferences Card */}
          <Card>
            <CardHeader>
              <CardTitle>{t("common.custom")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 max-w-lg">
              <div className="space-y-2">
                <Label>{t("settings.language")}</Label>
                <div className="flex gap-2">
                  <Button
                    variant={i18n.language === "en" ? "default" : "outline"}
                    size="sm"
                    onClick={() => i18n.changeLanguage("en")}
                  >
                    English
                  </Button>
                  <Button
                    variant={i18n.language === "zh" ? "default" : "outline"}
                    size="sm"
                    onClick={() => i18n.changeLanguage("zh")}
                  >
                    中文
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t("theme.toggle")}</Label>
                <div className="flex gap-2">
                  <Button
                    variant={theme === "light" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTheme("light")}
                  >
                    {t("theme.light")}
                  </Button>
                  <Button
                    variant={theme === "dark" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTheme("dark")}
                  >
                    {t("theme.dark")}
                  </Button>
                  <Button
                    variant={theme === "auto" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTheme("auto")}
                  >
                    {t("theme.auto")}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============ Security Tab ============ */}
        <TabsContent value="security" className="space-y-4">
          {/* Password Change Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                {t("settings.changePassword")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 max-w-lg">
              <div className="space-y-2">
                <Label>{t("settings.currentPassword")}</Label>
                <div className="relative">
                  <Input
                    type={showOldPassword ? "text" : "password"}
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    placeholder={t("auth.enterPassword")}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                    onClick={() => setShowOldPassword(!showOldPassword)}
                  >
                    {showOldPassword ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t("settings.newPassword")}</Label>
                <div className="relative">
                  <Input
                    type={showNewPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder={t("auth.passwordPlaceholder")}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                  >
                    {showNewPassword ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t("settings.confirmNewPassword")}</Label>
                <div className="relative">
                  <Input
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    placeholder={t("settings.confirmNewPassword")}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>
              {passwordError && (
                <p className="text-sm text-destructive">{passwordError}</p>
              )}
              {passwordChanged && (
                <p className="text-sm text-emerald-500">{t("settings.passwordChanged")}</p>
              )}
              <Button onClick={handleChangePassword} disabled={savingPassword}>
                {savingPassword ? (
                  <>
                    <Save className="mr-2 h-4 w-4 animate-spin" />
                    {t("common.saving")}
                  </>
                ) : (
                  <>
                    <Key className="mr-2 h-4 w-4" />
                    {t("settings.changePassword")}
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* API Access Token Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                API Access Token
              </CardTitle>
              <CardDescription>
                Use this token to authenticate API requests. Keep it secret.
              </CardDescription>
            </CardHeader>
            <CardContent className="max-w-lg space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex-1 rounded-md border bg-muted/50 px-4 py-2.5 font-mono text-sm break-all">
                  {showToken
                    ? jwtToken || "No token found"
                    : jwtToken
                      ? "••••••••••••••••••••••••••••••••"
                      : "No token found"}
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowToken(!showToken)}
                  title={showToken ? "Hide" : "Show"}
                >
                  {showToken ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(jwtToken, setCopiedToken)}
                  disabled={!jwtToken}
                  title={t("common.copy")}
                >
                  {copiedToken ? (
                    <Check className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              {copiedToken && (
                <p className="text-xs text-emerald-500">{t("common.copied")}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Include this token in the Authorization header as: <code className="rounded bg-muted px-1 py-0.5 text-xs">Bearer {"<token>"}</code>
              </p>
            </CardContent>
          </Card>

          <Separator />

          {/* Danger Zone */}
          <Card className="border-destructive/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <Trash2 className="h-5 w-5" />
                {t("settings.deleteAccount")}
              </CardTitle>
              <CardDescription className="text-destructive/80">
                {t("settings.deleteAccountWarning")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 max-w-lg">
              <div className="space-y-2">
                <Label>
                  {t("settings.deleteAccountConfirm")}: <span className="font-semibold">{user?.username}</span>
                </Label>
                <Input
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder={user?.username}
                />
              </div>
              <Button
                variant="destructive"
                onClick={handleDeleteAccount}
                disabled={deleteConfirmText !== user?.username || deletingAccount}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {t("settings.deleteAccount")}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============ Notifications Tab ============ */}
        <TabsContent value="notifications" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                {t("settings.notifications")}
              </CardTitle>
              <CardDescription>
                Choose how you want to be notified. (Visual only -- not yet connected to backend.)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 max-w-lg">
              {/* Email Notifications */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="flex items-center gap-2">
                    <Mail className="h-4 w-4" />
                    {t("settings.emailNotifications")}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Receive email updates about your account activity.
                  </p>
                </div>
                <Switch
                  checked={emailNotifications}
                  onCheckedChange={setEmailNotifications}
                />
              </div>

              <Separator />

              {/* Quota Alerts */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="flex items-center gap-2">
                    <Bell className="h-4 w-4" />
                    {t("settings.quotaAlerts")}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {t("settings.quotaAlertThreshold")}.
                  </p>
                </div>
                <Switch
                  checked={quotaAlerts}
                  onCheckedChange={setQuotaAlerts}
                />
              </div>

              <Separator />

              {/* Status badges (visual indicators) */}
              <div className="space-y-3">
                <Label>{t("common.status")}</Label>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={emailNotifications ? "success" : "secondary"}>
                    {t("settings.emailNotifications")}: {emailNotifications ? t("common.enabled") : t("common.disabled")}
                  </Badge>
                  <Badge variant={quotaAlerts ? "success" : "secondary"}>
                    {t("settings.quotaAlerts")}: {quotaAlerts ? t("common.enabled") : t("common.disabled")}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
