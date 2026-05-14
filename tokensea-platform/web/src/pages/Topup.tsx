import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/services/api"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { formatQuota } from "@/lib/utils"
import {
  Wallet, Gift, Check, CreditCard, Smartphone, Landmark,
  Copy, Clock, AlertCircle,
} from "lucide-react"

const PRESET_AMOUNTS = [10, 50, 100, 500]

const PAYMENT_METHODS = [
  { id: "stripe", name: "Stripe", icon: CreditCard, color: "bg-indigo-500" },
  { id: "alipay", name: "Alipay", icon: Smartphone, color: "bg-blue-500" },
  { id: "wechat", name: "WeChat Pay", icon: Landmark, color: "bg-green-500" },
  { id: "paypal", name: "PayPal", icon: CreditCard, color: "bg-amber-500" },
] as const

interface TopUpOrder {
  id: string
  tradeNo: string
  paymentMethod: string
  amount: string
  money: number
  status: string
  createdAt: string
}

export function TopupPage() {
  const { t } = useTranslation()
  const { user, refreshUser } = useAuth()
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null)
  const [customAmount, setCustomAmount] = useState("")
  const [redeemCode, setRedeemCode] = useState("")
  const [redeeming, setRedeeming] = useState(false)
  const [redeemResult, setRedeemResult] = useState<"success" | "error" | null>(null)
  const [copied, setCopied] = useState(false)
  const [paying, setPaying] = useState(false)
  const [orders, setOrders] = useState<TopUpOrder[]>([])

  useEffect(() => {
    api.getTopupOrders().then((data) => {
      setOrders(data.items || [])
    }).catch(() => {})
  }, [])

  const handlePayment = async (methodId: string) => {
    if (!selectedAmount || selectedAmount <= 0) return
    setPaying(true)
    try {
      const result = await api.createTopupOrder(methodId, selectedAmount)
      if (result.checkoutUrl) {
        window.open(result.checkoutUrl, "_blank")
      }
      refreshUser()
    } catch (err: any) {
      alert(err.message || t("topup.comingSoon"))
    } finally {
      setPaying(false)
    }
  }

  const handleCustomAmount = () => {
    const val = Number(customAmount)
    if (val > 0) {
      setSelectedAmount(val)
    }
  }

  const handleRedeem = async () => {
    if (!redeemCode.trim()) return
    setRedeeming(true)
    setRedeemResult(null)
    try {
      await api.redeemCode(redeemCode.trim())
      setRedeemResult("success")
      setRedeemCode("")
      refreshUser()
    } catch {
      setRedeemResult("error")
    } finally {
      setRedeeming(false)
    }
  }

  const copyInviteCode = () => {
    if (user?.inviteCode) {
      navigator.clipboard.writeText(user.inviteCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("topup.title")}</h1>
        <p className="text-muted-foreground">{t("topup.subtitle")}</p>
      </div>

      {/* Current Balance */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" /> {t("topup.currentBalance")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">
            {formatQuota(Number(user?.quota || 0) - Number(user?.usedQuota || 0))}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {t("usage.ofQuota", { quota: formatQuota(user?.quota || 0) })}
          </p>
        </CardContent>
      </Card>

      {/* Payment Methods */}
      <Card>
        <CardHeader>
          <CardTitle>{t("topup.paymentMethods")}</CardTitle>
          <CardDescription>{t("topup.paymentMethodsDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Quick Amount Selection */}
          <div>
            <Label className="text-sm font-medium">{t("topup.selectAmount")}</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {PRESET_AMOUNTS.map((amount) => (
                <Button
                  key={amount}
                  variant={selectedAmount === amount ? "default" : "outline"}
                  size="lg"
                  className="min-w-[80px]"
                  onClick={() => {
                    setSelectedAmount(amount)
                    setCustomAmount("")
                  }}
                >
                  ${amount}
                </Button>
              ))}
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min="1"
                  placeholder={t("topup.customAmount")}
                  value={customAmount}
                  onChange={(e) => {
                    setCustomAmount(e.target.value)
                    setSelectedAmount(null)
                  }}
                  className="w-32"
                />
                <Button
                  variant="outline"
                  onClick={handleCustomAmount}
                  disabled={!customAmount || Number(customAmount) <= 0}
                >
                  {t("topup.confirm")}
                </Button>
              </div>
            </div>
            {selectedAmount && (
              <p className="text-sm text-muted-foreground mt-2">
                {t("topup.selectedAmount")}: <span className="font-semibold text-foreground">${selectedAmount}</span>
              </p>
            )}
          </div>

          <Separator />

          {/* Payment Method Cards */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {PAYMENT_METHODS.map((method) => (
              <button
                key={method.id}
                onClick={() => handlePayment(method.id)}
                disabled={!selectedAmount || paying}
                className="group relative flex flex-col items-center gap-3 rounded-lg border p-4 transition-all hover:border-primary hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className={`flex h-10 w-10 items-center justify-center rounded-full ${method.color} text-white`}>
                  <method.icon className="h-5 w-5" />
                </div>
                <span className="text-sm font-medium">{method.name}</span>
                {selectedAmount && (
                  <Badge variant="secondary" className="text-xs">
                    ${selectedAmount}
                  </Badge>
                )}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground text-center">
            {t("topup.paymentNote")}
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Redeem Code */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gift className="h-5 w-5" /> {t("topup.redeemCode")}
            </CardTitle>
            <CardDescription>{t("topup.redeemCodeDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                value={redeemCode}
                onChange={(e) => setRedeemCode(e.target.value)}
                placeholder={t("topup.enterCode")}
              />
              <Button onClick={handleRedeem} disabled={redeeming || !redeemCode.trim()}>
                {redeeming ? t("common.loading") : t("topup.redeem")}
              </Button>
            </div>
            {redeemResult === "success" && (
              <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                <Check className="h-4 w-4" /> {t("topup.redeemSuccess")}
              </div>
            )}
            {redeemResult === "error" && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" /> {t("topup.redeemFailed")}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Invite Code */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gift className="h-5 w-5" /> {t("topup.inviteCode")}
            </CardTitle>
            <CardDescription>{t("usage.shareToEarn")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg border p-4">
              <div className="flex-1">
                <Label className="text-muted-foreground">{t("usage.inviteCode")}</Label>
                <div className="mt-1 font-mono text-lg font-bold text-primary">
                  {user?.inviteCode || "—"}
                </div>
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={copyInviteCode}
                disabled={!user?.inviteCode}
                title={t("topup.copy")}
              >
                {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("topup.inviteCodeDesc")}</p>
          </CardContent>
        </Card>
      </div>

      {/* Order History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" /> {t("topup.orderHistory")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Clock className="h-12 w-12 text-muted-foreground/40 mb-4" />
              <p className="text-muted-foreground">{t("topup.noOrders")}</p>
              <p className="text-xs text-muted-foreground mt-1">{t("topup.noOrdersDesc")}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {orders.map((order) => (
                <div key={order.id} className="flex items-center justify-between rounded-lg border p-4">
                  <div>
                    <p className="font-medium text-sm">${order.money}</p>
                    <p className="text-xs text-muted-foreground">{order.tradeNo}</p>
                  </div>
                  <div className="text-right">
                    <Badge variant={order.status === "success" ? "default" : "secondary"}>
                      {order.status}
                    </Badge>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(order.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
