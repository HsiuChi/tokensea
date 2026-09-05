import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { api } from "@/services/api"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { Plus, Copy, Check, Trash2, Power, PowerOff, Search, Eye, EyeOff, Pencil } from "lucide-react"

export function KeysPage() {
  const { t } = useTranslation()
  const [keys, setKeys] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [showCreate, setShowCreate] = useState(false)
  const [keyName, setKeyName] = useState("")
  const [editing, setEditing] = useState<any>(null)
  const [quota, setQuota] = useState("")
  const [expiresAt, setExpiresAt] = useState("")
  const [allowedIps, setAllowedIps] = useState("")
  const [modelNames, setModelNames] = useState("")
  const openEditor = (key: any = null) => {
    setEditing(key); setKeyName(key?.name ?? "")
    setQuota(key && Number(key.quota) >= 0 ? String(Number(key.quota) / 1000000) : "")
    setExpiresAt(key?.expiresAt ? new Date(new Date(key.expiresAt).getTime() - new Date(key.expiresAt).getTimezoneOffset() * 60000).toISOString().slice(0,16) : "")
    setAllowedIps((key?.allowedIps ?? []).join("\n"))
    setModelNames((key?.models ?? []).join("\n"))
    setShowCreate(true)
  }
  const [saving, setSaving] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [revealedId, setRevealedId] = useState<string | null>(null)

  const fetchKeys = async () => {
    try {
      const data = await api.listTokens(1, 100)
      setKeys(data.items || [])
    } catch {} finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchKeys() }, [])

  const handleCreate = async () => {
    if (!keyName.trim()) return
    setSaving(true)
    try {
      const limit = quota.trim() === "" ? "-1" : String(Math.round(Number(quota) * 1000000))
      if (!/^-?\d+$/.test(limit) || (quota !== "" && Number(quota) < 0)) throw new Error("请输入有效的美元额度")
      const body = { name: keyName.trim(), quota: limit, models: modelNames.split(/[\s,，]+/).filter(Boolean), allowedIps: allowedIps.split(/[\s,，]+/).filter(Boolean), expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null }
      if (editing) await api.updateToken(editing.id, body)
      else await api.createToken({ ...body, expiresAt: body.expiresAt ?? undefined })
      setKeyName("")
      setShowCreate(false)
      fetchKeys()
    } catch (err: any) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm(t("keys.deleteConfirm"))) return
    try { await api.deleteToken(id); fetchKeys() } catch (err: any) { alert(err.message) }
  }

  const handleToggle = async (id: string, status: string) => {
    try { await api.updateToken(id, { status: status === "active" ? "disabled" : "active" }); fetchKeys() } catch (err: any) { alert(err.message) }
  }

  const copyKey = (id: string, key: string) => {
    navigator.clipboard.writeText(key)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const filtered = keys.filter((k) => !search || k.name?.toLowerCase().includes(search.toLowerCase()) || k.keyPrefix?.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("keys.title")}</h1>
          <p className="text-muted-foreground">{t("keys.subtitle")}</p>
        </div>
        <Button onClick={() => openEditor()}>
          <Plus className="mr-2 h-4 w-4" /> {t("keys.createKey")}
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("common.search")} className="pl-9" />
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "API Key 高级设置" : t("keys.createKeyTitle")}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("keys.keyName")} *</Label>
              <Input
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                placeholder={t("keys.keyNamePlaceholder")}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                autoFocus
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label>累计额度上限（美元）</Label><Input type="number" min="0" step="0.000001" value={quota} onChange={e=>setQuota(e.target.value)} placeholder="留空为不限额" /><p className="text-xs text-muted-foreground">包含已用额度；0 表示不可调用。仍受账户余额限制。</p></div>
              <div className="space-y-2"><Label>有效期（本地时间）</Label><Input type="datetime-local" value={expiresAt} onChange={e=>setExpiresAt(e.target.value)} /><p className="text-xs text-muted-foreground">留空表示永不过期</p></div>
            </div>
            <div className="space-y-2"><Label>允许的模型 ID</Label><textarea className="w-full rounded-xl border bg-background p-3 text-sm" rows={3} value={modelNames} onChange={e=>setModelNames(e.target.value)} placeholder="每行一个模型 ID，留空使用分组权限或全部已开放模型" /></div>
            <div className="space-y-2"><Label>IP 白名单</Label><textarea className="w-full rounded-xl border bg-background p-3 text-sm" rows={3} value={allowedIps} onChange={e=>setAllowedIps(e.target.value)} placeholder="每行一个 IPv4 / IPv6 或 CIDR，例如 203.0.113.0/24；留空不限制" /><p className="text-xs text-muted-foreground">限制的是调用方公网出口 IP，也作用于在线试用。</p></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleCreate} disabled={saving || !keyName.trim()}>{saving ? t("common.loading") : editing ? "保存设置" : t("common.create")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Keys Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <p className="text-lg mb-2">{search ? t("common.noResults") : t("keys.noKeys")}</p>
              {!search && <Button variant="outline" onClick={() => openEditor()}>{t("keys.createFirst")}</Button>}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("keys.key")}</TableHead>
                  <TableHead>{t("keys.keyName")}</TableHead>
                  <TableHead>{t("keys.enabled")}</TableHead>
                  <TableHead>{t("keys.createdAt")}</TableHead>
                  <TableHead className="text-right">{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((key: any) => (
                  <TableRow key={key.id}>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <code className="text-xs font-mono">
                          {revealedId === key.id && key.keyPlain ? key.keyPlain : `${key.keyPrefix}****`}
                        </code>
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setRevealedId(revealedId === key.id ? null : key.id)}>
                          {revealedId === key.id ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                        </Button>
                        {key.keyPlain && (
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => copyKey(key.id, key.keyPlain)}>
                            {copiedId === key.id ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{key.name}<p className="mt-1 text-xs text-muted-foreground">{Number(key.quota) < 0 ? "不限额" : "$" + (Number(key.usedQuota)/1000000).toFixed(4) + " / $" + Number(key.quota)/1000000}</p><p className="text-xs text-muted-foreground">{key.expiresAt ? "到期：" + new Date(key.expiresAt).toLocaleString() : "永不过期"}</p></TableCell>
                    <TableCell>
                      <Badge variant={key.status === "active" ? "success" : "destructive"}>
                        {key.status === "active" ? t("common.active") : t("common.disabled")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {key.createdAt ? new Date(key.createdAt).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1"><Button size="sm" variant="ghost" aria-label="高级设置" onClick={()=>openEditor(key)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => handleToggle(key.id, key.status)}>
                          {key.status === "active" ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
                        </Button>
                        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => handleDelete(key.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
