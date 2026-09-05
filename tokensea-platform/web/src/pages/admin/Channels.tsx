import { useEffect, useState, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { ChannelOperations } from "@/components/ChannelOperations"
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
import { Plus, Trash2, Activity, Pencil, Search, ChevronDown, ChevronRight, Zap, KeyRound, Cloud } from "lucide-react"

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
  billingMultiplier?: number; retryPolicy?: any
  models?: string[]; nodes: any[]
}

interface ChannelForm {
  name: string; type: string; models: string; priority: string; weight: string
  billingMultiplier: string; retryPolicy: string
}

interface NodeForm {
  adapter: string
  name: string; internalUrl: string; apiKey: string; maxConcurrent: string
}

const emptyChannel: ChannelForm = { name: "", type: "openai", models: "", priority: "1", weight: "1", billingMultiplier: "1", retryPolicy: "" }
const emptyNode: NodeForm = { adapter: "cpa", name: "", internalUrl: "", apiKey: "", maxConcurrent: "100" }

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
  const [testingChannel, setTestingChannel] = useState<string | null>(null)
  const [oauthNode, setOauthNode] = useState<any>(null)
  const [oauthData, setOauthData] = useState<any>(null)
  const [oauthLoading, setOauthLoading] = useState(false)
  const [syncing, setSyncing] = useState<string | null>(null)

  const handleSyncModels = async (id: string) => {
    setSyncing(id)
    try {
      const result = await api.syncChannelModels(id)
      alert(`发现 ${result.discovered} 个模型，新增 ${result.addedModels} 个模型、${result.addedRoutes} 条路由。${result.message}`)
      fetch()
    } catch (e: any) { alert(e.message) } finally { setSyncing(null) }
  }
  const [saving, setSaving] = useState(false)
  const [showKsyun, setShowKsyun] = useState(false)
  const [ksyunCatalog, setKsyunCatalog] = useState<any[]>([])
  const [ksyunKeys, setKsyunKeys] = useState("")
  const [ksyunModels, setKsyunModels] = useState<Set<string>>(new Set())

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

  const buildChannelBody = (): any | null => {
    let retryPolicy: any = undefined
    if (channelForm.retryPolicy.trim()) {
      try { retryPolicy = JSON.parse(channelForm.retryPolicy) } catch {
        alert(t("admin.channels.invalidRetryPolicy"))
        return null
      }
    }
    const body: any = {
      name: channelForm.name, type: channelForm.type,
      priority: Number(channelForm.priority), weight: Number(channelForm.weight),
      billingMultiplier: Number(channelForm.billingMultiplier) || 1,
    }
    if (channelForm.models) body.models = channelForm.models.split(",").map((s) => s.trim()).filter(Boolean)
    if (retryPolicy !== undefined) body.retryPolicy = retryPolicy
    return body
  }

  const handleCreate = async () => {
    const body = buildChannelBody()
    if (!body) return
    setSaving(true)
    try {
      await api.createChannel(body)
      setShowCreate(false); setChannelForm({ ...emptyChannel }); fetch()
    } catch (e: any) { alert(e.message) } finally { setSaving(false) }
  }

  const handleEdit = async () => {
    if (!editingId) return
    const body = buildChannelBody()
    if (!body) return
    setSaving(true)
    try {
      await api.updateChannel(editingId, body)
      setShowEdit(false); setEditingId(null); fetch()
    } catch (e: any) { alert(e.message) } finally { setSaving(false) }
  }

  const openEdit = (ch: Channel) => {
    setEditingId(ch.id)
    setChannelForm({
      name: ch.name || "", type: ch.type || "openai",
      models: ch.models?.join(", ") || "", priority: String(ch.priority || 1), weight: String(ch.weight || 1),
      billingMultiplier: String(ch.billingMultiplier ?? 1),
      retryPolicy: ch.retryPolicy ? JSON.stringify(ch.retryPolicy, null, 2) : "",
    })
    setShowEdit(true)
  }

  const handleTestChannel = async (id: string) => {
    setTestingChannel(id)
    try {
      const r = await api.testChannel(id)
      alert(r?.ok ? `${t("admin.channels.testOk")} (${r.latencyMs ?? "?"}ms${r.model ? `, ${r.model}` : ""})` : `${t("admin.channels.testFail")}: ${r?.status ?? "?"} ${r?.error ?? r?.node ?? ""}`)
    } catch (e: any) { alert(`${t("admin.channels.testFail")}: ${e.message}`) }
    setTestingChannel(null)
  }

  const handleAddNode = async (channelId: string) => {
    setSaving(true)
    try {
      await api.addNode(channelId, {
        name: nodeForm.name, internalUrl: nodeForm.internalUrl,
        internalApiKey: nodeForm.apiKey, maxConcurrent: Number(nodeForm.maxConcurrent),
        adapter: nodeForm.adapter,
        authType: nodeForm.adapter === "dario" ? "x-api-key" : "bearer",
        probePath: nodeForm.adapter === "dario" ? "/healthz" : "/v1/models",
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

  const handleViewOAuth = async (node: any) => {
    setOauthNode(node)
    setOauthData(null)
    setOauthLoading(true)
    try {
      const r = await api.getOAuthStatus(node.id)
      setOauthData(r)
    } catch (e: any) {
      setOauthData({ node: node.name, errors: { status: e.message } })
    }
    setOauthLoading(false)
  }

  const handleDeleteChannel = async (id: string) => {
    if (!confirm(t("admin.channels.deleteChannel"))) return
    try { await api.deleteChannel(id); fetch() } catch (e: any) { alert(e.message) }
  }

  const openKsyunImport = async () => {
    setShowKsyun(true)
    try {
      const models = await api.getKsyunCatalog()
      setKsyunCatalog(models)
      setKsyunModels(new Set(models.map((model: any) => model.id)))
    } catch (e: any) { alert(e.message); setShowKsyun(false) }
  }

  const handleKsyunImport = async () => {
    const apiKeys = ksyunKeys.split(/[\n,]+/).map((key) => key.trim()).filter(Boolean)
    if (!apiKeys.length) return alert("请粘贴至少一个金山云星流 API Key")
    if (!ksyunModels.size) return alert("请至少选择一个模型")
    setSaving(true)
    try {
      const result = await api.bootstrapKsyun({ apiKeys, modelIds: [...ksyunModels], maxConcurrent: 20 })
      setKsyunKeys(""); setShowKsyun(false); fetch()
      alert(`接入完成：新增 ${result.addedKeys} 个 Key，已路由 ${result.models.length} 个模型`)
    } catch (e: any) { alert(e.message) } finally { setSaving(false) }
  }

  const filtered = channels.filter((ch) => !search || ch.name?.toLowerCase().includes(search.toLowerCase()) || ch.type?.toLowerCase().includes(search.toLowerCase()))
  const typeLabel = (type: string) => CHANNEL_TYPES.find((c) => c.value === type)?.label || type
  const providerLabel = (provider: string) => ({ deepseek: "DeepSeek", moonshot: "月之暗面 Kimi", qwen: "通义千问 Qwen", zhipu: "智谱 GLM", xiaomi: "小米 MiMo" } as Record<string, string>)[provider] || provider

  return (
    <div className="space-y-6">
      <ChannelOperations />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("admin.channels.title")}</h1>
          <p className="text-muted-foreground">{t("admin.channels.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={openKsyunImport}>
            <Cloud className="mr-2 h-4 w-4" /> 接入金山云星流
          </Button>
          <Button onClick={() => { setChannelForm({ ...emptyChannel }); setShowCreate(true) }}>
            <Plus className="mr-2 h-4 w-4" /> {t("admin.channels.addChannel")}
          </Button>
        </div>
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
            <div className="space-y-2">
              <Label>{t("admin.channels.billingMultiplier")}</Label>
              <Input type="number" step="0.01" min="0" value={channelForm.billingMultiplier} onChange={(e) => setChannelForm({ ...channelForm, billingMultiplier: e.target.value })} />
              <p className="text-xs text-muted-foreground">{t("admin.channels.billingMultiplierHint")}</p>
            </div>
            <div className="space-y-2">
              <Label>{t("admin.channels.retryPolicy")}</Label>
              <textarea
                className="flex min-h-[120px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs font-mono"
                value={channelForm.retryPolicy}
                onChange={(e) => setChannelForm({ ...channelForm, retryPolicy: e.target.value })}
                placeholder='{"rules":[{"status":429,"action":"continue-and-cooldown"},{"status":500,"match":["overloaded"],"action":"continue"}]}'
              />
              <p className="text-xs text-muted-foreground">{t("admin.channels.retryPolicyHint")}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreate(false); setShowEdit(false); setEditingId(null) }}>{t("common.cancel")}</Button>
            <Button onClick={showEdit ? handleEdit : handleCreate} disabled={saving}>{saving ? t("common.loading") : t("common.create")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* KSP bulk key pool setup */}
      <Dialog open={showKsyun} onOpenChange={(open) => { setShowKsyun(open); if (!open) setKsyunKeys("") }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>接入金山云星流 Key 池</DialogTitle></DialogHeader>
          <div className="space-y-5 max-h-[68vh] overflow-y-auto pr-1">
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100">
              用户仍然只使用 TokenSea Key。上游 Key 会加密保存，并在请求失败或限流时自动切换。
            </div>
            <div className="space-y-2">
              <Label>API Keys（每行一个）</Label>
              <textarea autoComplete="off" spellCheck={false}
                className="flex min-h-[140px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono"
                value={ksyunKeys} onChange={(e) => setKsyunKeys(e.target.value)} placeholder={"sk-...\nsk-...\nsk-..."} />
              <p className="text-xs text-muted-foreground">只在提交时发送到本机 TokenSea；保存后管理页面仅显示掩码。</p>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>开放模型（已选 {ksyunModels.size}）</Label>
                <div className="flex gap-3 text-xs">
                  <button type="button" className="text-primary" onClick={() => setKsyunModels(new Set(ksyunCatalog.map((m) => m.id)))}>全选</button>
                  <button type="button" className="text-muted-foreground" onClick={() => setKsyunModels(new Set())}>清空</button>
                </div>
              </div>
              {[...new Set(ksyunCatalog.map((model) => model.provider))].map((provider) => (
                <div key={provider} className="rounded-lg border p-3">
                  <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground">{providerLabel(provider)}</p>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                    {ksyunCatalog.filter((model) => model.provider === provider).map((model) => (
                      <label key={model.id} className="flex cursor-pointer items-start gap-2 rounded-md p-2 text-sm hover:bg-muted">
                        <input type="checkbox" className="mt-1" checked={ksyunModels.has(model.id)}
                          onChange={(e) => setKsyunModels((previous) => {
                            const next = new Set(previous)
                            e.target.checked ? next.add(model.id) : next.delete(model.id)
                            return next
                          })} />
                        <span><span className="block font-medium">{model.displayName}</span><span className="text-xs text-muted-foreground font-mono">{model.id}</span></span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowKsyun(false); setKsyunKeys("") }}>{t("common.cancel")}</Button>
            <Button onClick={handleKsyunImport} disabled={saving || !ksyunCatalog.length}>{saving ? "正在加密并接入…" : "创建 Key 池并发布模型"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Node Dialog */}
      <Dialog open={addNodeTo !== null} onOpenChange={(open) => { if (!open) setAddNodeTo(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("admin.channels.addNodeTitle")}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>适配器</Label><Select value={nodeForm.adapter} onValueChange={(adapter) => setNodeForm({ ...nodeForm, adapter })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cpa">CPA</SelectItem><SelectItem value="openai-compatible">OpenAI Compatible</SelectItem><SelectItem value="ksyun">金山云</SelectItem><SelectItem value="dario">Dario（旧版）</SelectItem></SelectContent></Select></div>
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

      {/* OAuth status dialog */}
      <Dialog open={oauthNode !== null} onOpenChange={(open) => { if (!open) { setOauthNode(null); setOauthData(null) } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("admin.channels.oauthTitle")} — {oauthNode?.name}</DialogTitle>
          </DialogHeader>
          {oauthLoading ? (
            <Skeleton className="h-40" />
          ) : !oauthData ? null : (
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              {oauthData.errors?.status && <p className="text-xs text-destructive">{t("admin.channels.oauthStatusError")}: {oauthData.errors.status}</p>}
              {oauthData.status && (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">{t("admin.channels.oauthStatus")}</p>
                  <pre className="rounded-md bg-muted p-3 text-xs font-mono whitespace-pre-wrap break-all">{JSON.stringify(oauthData.status, null, 2)}</pre>
                </div>
              )}
              {oauthData.accounts?.accounts?.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">{t("admin.channels.oauthAccounts")}</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Alias</TableHead>
                        <TableHead>5h</TableHead>
                        <TableHead>7d</TableHead>
                        <TableHead>{t("common.status")}</TableHead>
                        <TableHead>{t("admin.channels.oauthExpires")}</TableHead>
                        <TableHead>Req</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {oauthData.accounts.accounts.map((a: any) => (
                        <TableRow key={a.alias}>
                          <TableCell className="font-medium">{a.alias}</TableCell>
                          <TableCell>{a.util5h != null ? `${Math.round(a.util5h * 100)}%` : "-"}</TableCell>
                          <TableCell>{a.util7d != null ? `${Math.round(a.util7d * 100)}%` : "-"}</TableCell>
                          <TableCell>
                            <Badge variant={a.status === "ok" ? "success" : a.status === "auth-cooldown" ? "warning" : "secondary"}>{a.status}</Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {a.expiresInMs != null ? `${Math.round(a.expiresInMs / 3600000)}h` : "-"}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{a.requestCount ?? 0}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {oauthData.errors?.accounts && <p className="text-xs text-muted-foreground">/accounts: {oauthData.errors.accounts}</p>}
            </div>
          )}
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
                      <Button size="sm" variant="outline" disabled={testingChannel === ch.id} onClick={() => handleTestChannel(ch.id)}>
                        <Zap className="mr-1 h-3 w-3" /> {testingChannel === ch.id ? "..." : t("admin.channels.testChannel")}
                      </Button>
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
                    {ch.nodes?.some((n: any) => n.adapter === "cpa") && <div className="mb-3 flex items-center gap-3"><Button size="sm" variant="outline" disabled={syncing !== null} onClick={() => handleSyncModels(ch.id)}>{syncing === ch.id ? "同步中…" : "同步 CPA 模型"}</Button><span className="text-xs text-muted-foreground">新模型停用入库，审核价格及兼容性后启用</span></div>}
                    <div className="mb-3 text-xs text-muted-foreground">
                      {t("admin.channels.priority")}: {ch.priority} · {t("admin.channels.weight")}: {ch.weight} · {t("admin.channels.billingMultiplier")}: ×{ch.billingMultiplier ?? 1}
                      {(ch.models?.length ?? 0) > 0 && <> · {t("admin.channels.models")}: {ch.models!.join(", ")}</>}
                      {ch.retryPolicy?.rules?.length > 0 && <> · {t("admin.channels.retryPolicy")}: {ch.retryPolicy.rules.length} rules</>}
                    </div>
                    {ch.nodes?.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t("admin.channels.nodeName")}</TableHead>
                            <TableHead>URL</TableHead>
                            <TableHead>Key / 协议</TableHead>
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
                              <TableCell className="text-xs text-muted-foreground"><span className="font-mono">{n.apiKeyMasked || "••••••••"}</span><br />{n.adapter || "dario"}</TableCell>
                              <TableCell>
                                <Badge variant={n.status === "healthy" ? "success" : n.status === "degraded" ? "warning" : "destructive"}>
                                  {n.status === "healthy" ? t("common.healthy") : n.status === "degraded" ? t("common.degraded") : t("common.unhealthy")}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-muted-foreground">{n.currentLoad || 0}/{n.maxConcurrent}</TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1">
                                  {(!n.adapter || n.adapter === "dario") && <Button size="sm" variant="ghost" onClick={() => handleViewOAuth(n)}><KeyRound className="mr-1 h-3 w-3" /> OAuth</Button>}
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
