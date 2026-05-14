import { useEffect, useState, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { api } from "@/services/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { Plus, Trash2, Activity, Pencil, Search, ChevronDown, ChevronRight } from "lucide-react"

const CHANNEL_TYPES = [
  { value: "openai", label: "OpenAI Compatible" },
  { value: "anthropic", label: "Anthropic Native" },
  { value: "claude", label: "Claude (OpenAI Format)" },
  { value: "gemini", label: "Google Gemini" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "codex", label: "Codex" },
  { value: "custom", label: "Custom" },
]

interface Channel {
  id: string; name: string; type: string; status: string; priority?: number; weight?: number
  models?: string[]; nodes: any[]
}

interface ChannelForm {
  name: string; type: string; models: string; priority: string; weight: string
}

interface NodeForm {
  name: string; internalUrl: string; apiKey: string; maxConcurrent: string
}

const emptyChannel: ChannelForm = { name: "", type: "openai", models: "", priority: "1", weight: "1" }
const emptyNode: NodeForm = { name: "", internalUrl: "", apiKey: "", maxConcurrent: "100" }

export function AdminChannels() {
  const { t } = useTranslation()
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showCreate, setShowCreate] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [addNodeTo, setAddNodeTo] = useState<string | null>(null)
  const [channelForm, setChannelForm] = useState<ChannelForm>({ ...emptyChannel })
  const [nodeForm, setNodeForm] = useState<NodeForm>({ ...emptyNode })
  const [healthChecking, setHealthChecking] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const fetch = useCallback(() => {
    setLoading(true)
    api.listChannels()
      .then((r: any) => { setChannels(r.items || r || []) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetch() }, [fetch])

  const toggleExpand = (id: string) => {
    setExpanded((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }

  const handleCreate = async () => {
    setSaving(true)
    try {
      const body: any = { name: channelForm.name, type: channelForm.type, priority: Number(channelForm.priority), weight: Number(channelForm.weight) }
      if (channelForm.models) body.models = channelForm.models.split(",").map((s) => s.trim()).filter(Boolean)
      await api.createChannel(body)
      setShowCreate(false); setChannelForm({ ...emptyChannel }); fetch()
    } catch (e: any) { alert(e.message) } finally { setSaving(false) }
  }

  const handleEdit = async () => {
    if (!editingId) return
    setSaving(true)
    try {
      const body: any = { name: channelForm.name, type: channelForm.type, priority: Number(channelForm.priority), weight: Number(channelForm.weight) }
      if (channelForm.models) body.models = channelForm.models.split(",").map((s) => s.trim()).filter(Boolean)
      await api.updateChannel(editingId, body)
      setShowEdit(false); setEditingId(null); fetch()
    } catch (e: any) { alert(e.message) } finally { setSaving(false) }
  }

  const openEdit = (ch: Channel) => {
    setEditingId(ch.id)
    setChannelForm({
      name: ch.name || "", type: ch.type || "openai",
      models: ch.models?.join(", ") || "", priority: String(ch.priority || 1), weight: String(ch.weight || 1),
    })
    setShowEdit(true)
  }

  const handleAddNode = async (channelId: string) => {
    setSaving(true)
    try {
      await api.addNode(channelId, {
        name: nodeForm.name, internalUrl: nodeForm.internalUrl,
        internalApiKey: nodeForm.apiKey, maxConcurrent: Number(nodeForm.maxConcurrent),
      })
      setAddNodeTo(null); setNodeForm({ ...emptyNode }); fetch()
    } catch (e: any) { alert(e.message) } finally { setSaving(false) }
  }

  const handleHealthCheck = async (nodeId: string) => {
    setHealthChecking(nodeId)
    try { await api.healthCheckNode(nodeId); fetch() } catch (e: any) { alert(e.message) }
    setHealthChecking(null)
  }

  const handleDeleteNode = async (nodeId: string) => {
    if (!confirm(t("admin.channels.deleteNode"))) return
    try { await api.deleteNode(nodeId); fetch() } catch (e: any) { alert(e.message) }
  }

  const handleDeleteChannel = async (id: string) => {
    if (!confirm(t("admin.channels.deleteChannel"))) return
    try { await api.deleteChannel(id); fetch() } catch (e: any) { alert(e.message) }
  }

  const filtered = channels.filter((ch) => !search || ch.name?.toLowerCase().includes(search.toLowerCase()) || ch.type?.toLowerCase().includes(search.toLowerCase()))
  const typeLabel = (type: string) => CHANNEL_TYPES.find((c) => c.value === type)?.label || type

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("admin.channels.title")}</h1>
          <p className="text-muted-foreground">{t("admin.channels.subtitle")}</p>
        </div>
        <Button onClick={() => { setChannelForm({ ...emptyChannel }); setShowCreate(true) }}>
          <Plus className="mr-2 h-4 w-4" /> {t("admin.channels.addChannel")}
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("common.search")} className="pl-9" />
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={showCreate || showEdit} onOpenChange={(open) => { if (!open) { setShowCreate(false); setShowEdit(false); setEditingId(null) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{showEdit ? t("admin.channels.editChannel") : t("admin.channels.addChannelTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>{t("admin.channels.channelName")}</Label><Input value={channelForm.name} onChange={(e) => setChannelForm({ ...channelForm, name: e.target.value })} /></div>
            <div className="space-y-2">
              <Label>{t("admin.channels.channelType")}</Label>
              <Select value={channelForm.type} onValueChange={(v) => setChannelForm({ ...channelForm, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CHANNEL_TYPES.map((ct) => <SelectItem key={ct.value} value={ct.value}>{ct.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>{t("admin.channels.models")}</Label><Input value={channelForm.models} onChange={(e) => setChannelForm({ ...channelForm, models: e.target.value })} placeholder="gpt-4o, claude-sonnet-4-20250514, ..." /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>{t("admin.channels.priority")}</Label><Input type="number" value={channelForm.priority} onChange={(e) => setChannelForm({ ...channelForm, priority: e.target.value })} /></div>
              <div className="space-y-2"><Label>{t("admin.channels.weight")}</Label><Input type="number" value={channelForm.weight} onChange={(e) => setChannelForm({ ...channelForm, weight: e.target.value })} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreate(false); setShowEdit(false); setEditingId(null) }}>{t("common.cancel")}</Button>
            <Button onClick={showEdit ? handleEdit : handleCreate} disabled={saving}>{saving ? t("common.loading") : t("common.create")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Node Dialog */}
      <Dialog open={addNodeTo !== null} onOpenChange={(open) => { if (!open) setAddNodeTo(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("admin.channels.addNodeTitle")}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>{t("admin.channels.nodeName")}</Label><Input value={nodeForm.name} onChange={(e) => setNodeForm({ ...nodeForm, name: e.target.value })} /></div>
            <div className="space-y-2"><Label>{t("admin.channels.internalUrl")}</Label><Input value={nodeForm.internalUrl} onChange={(e) => setNodeForm({ ...nodeForm, internalUrl: e.target.value })} placeholder="https://api.openai.com" /></div>
            <div className="space-y-2"><Label>{t("admin.channels.apiKey")}</Label><Input type="password" value={nodeForm.apiKey} onChange={(e) => setNodeForm({ ...nodeForm, apiKey: e.target.value })} /></div>
            <div className="space-y-2"><Label>{t("admin.channels.maxConcurrent")}</Label><Input type="number" value={nodeForm.maxConcurrent} onChange={(e) => setNodeForm({ ...nodeForm, maxConcurrent: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddNodeTo(null)}>{t("common.cancel")}</Button>
            <Button onClick={() => handleAddNode(addNodeTo!)} disabled={saving}>{saving ? t("common.loading") : t("admin.channels.addNode")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Channel List */}
      {loading ? (
        <div className="space-y-4">{Array.from({ length: 2 }).map((_, i) => <Card key={i}><CardContent className="p-6"><Skeleton className="h-32" /></CardContent></Card>)}</div>
      ) : filtered.length === 0 ? (
        <div className="py-10 text-center text-muted-foreground">{search ? t("common.noResults") : t("admin.channels.noNodes")}</div>
      ) : (
        <div className="space-y-3">
          {filtered.map((ch) => {
            const isExpanded = expanded.has(ch.id)
            return (
              <Card key={ch.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 cursor-pointer" onClick={() => toggleExpand(ch.id)}>
                      {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      <div>
                        <CardTitle className="text-base">{ch.name}</CardTitle>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="secondary">{typeLabel(ch.type)}</Badge>
                          <Badge variant={ch.status === "active" ? "success" : "destructive"}>{ch.status === "active" ? t("common.active") : t("common.disabled")}</Badge>
                          {(ch.models?.length ?? 0) > 0 && <span className="text-xs text-muted-foreground">{ch.models!.length} {t("admin.channels.models")}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(ch)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="outline" onClick={() => { setNodeForm({ ...emptyNode }); setAddNodeTo(ch.id) }}>
                        <Plus className="mr-1 h-3 w-3" /> {t("admin.channels.addNode")}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDeleteChannel(ch.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                </CardHeader>
                {isExpanded && (
                  <CardContent>
                    <div className="mb-3 text-xs text-muted-foreground">
                      {t("admin.channels.priority")}: {ch.priority} · {t("admin.channels.weight")}: {ch.weight}
                      {(ch.models?.length ?? 0) > 0 && <> · {t("admin.channels.models")}: {ch.models!.join(", ")}</>}
                    </div>
                    {ch.nodes?.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t("admin.channels.nodeName")}</TableHead>
                            <TableHead>URL</TableHead>
                            <TableHead>{t("common.status")}</TableHead>
                            <TableHead>{t("admin.channels.maxConcurrent")}</TableHead>
                            <TableHead>{t("common.actions")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {ch.nodes.map((n: any) => (
                            <TableRow key={n.id}>
                              <TableCell className="font-medium">{n.name}</TableCell>
                              <TableCell className="text-xs text-muted-foreground font-mono">{n.internalUrl || n.baseUrl}</TableCell>
                              <TableCell>
                                <Badge variant={n.status === "healthy" ? "success" : n.status === "degraded" ? "warning" : "destructive"}>
                                  {n.status === "healthy" ? t("common.healthy") : n.status === "degraded" ? t("common.degraded") : t("common.unhealthy")}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-muted-foreground">{n.currentLoad || 0}/{n.maxConcurrent}</TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1">
                                  <Button size="sm" variant="outline" disabled={healthChecking === n.id} onClick={() => handleHealthCheck(n.id)}>
                                    <Activity className="mr-1 h-3 w-3" /> {healthChecking === n.id ? "..." : t("admin.channels.healthCheck")}
                                  </Button>
                                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDeleteNode(n.id)}><Trash2 className="h-3 w-3" /></Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <p className="text-sm text-muted-foreground py-4 text-center">{t("admin.channels.noNodes")}</p>
                    )}
                  </CardContent>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
