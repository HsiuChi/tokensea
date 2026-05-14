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
import { Plus, Copy, Check, Trash2, Power, PowerOff, Search, Eye, EyeOff } from "lucide-react"

export function KeysPage() {
  const { t } = useTranslation()
  const [keys, setKeys] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [showCreate, setShowCreate] = useState(false)
  const [keyName, setKeyName] = useState("")
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
      await api.createToken({ name: keyName.trim() })
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
        <Button onClick={() => { setShowCreate(true); setKeyName("") }}>
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
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t("keys.createKeyTitle")}</DialogTitle></DialogHeader>
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleCreate} disabled={saving || !keyName.trim()}>{saving ? t("common.loading") : t("common.create")}</Button>
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
              {!search && <Button variant="outline" onClick={() => { setShowCreate(true) }}>{t("keys.createFirst")}</Button>}
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
                    <TableCell className="font-medium">{key.name}</TableCell>
                    <TableCell>
                      <Badge variant={key.status === "active" ? "success" : "destructive"}>
                        {key.status === "active" ? t("common.active") : t("common.disabled")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {key.createdAt ? new Date(key.createdAt).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
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
