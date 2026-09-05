import { useEffect, useState } from "react"
import { api } from "@/services/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

export function ChannelOperations() {
  const [data,setData] = useState<any>(null)
  const [error,setError] = useState("")
  const [loading,setLoading] = useState(false)
  const [hooks,setHooks] = useState<any[]>([])
  const [url,setUrl] = useState("")
  const [saving,setSaving] = useState(false)
  const refresh = async () => {
    setLoading(true); setError("")
    try { const [d,h] = await Promise.all([api.getChannelOperations(),api.listWebhooks()]);setData(d);setHooks(h) }
    catch(e:any) { setError(e.message) } finally { setLoading(false) }
  }
  useEffect(()=>{refresh()},[])
  const addHook = async () => {
    setSaving(true)
    try {await api.createWebhook({url,events:["*"]});setUrl("");await refresh()}
    catch(e:any){setError(e.message)}finally{setSaving(false)}
  }
  return <Card>
    <CardHeader><div className="flex justify-between items-center"><CardTitle>账号、额度与告警</CardTitle><Button size="sm" variant="outline" onClick={refresh} disabled={loading}>{loading ? "查询中…" : "刷新"}</Button></div><p className="text-xs text-muted-foreground">节点统计为近 24 小时。CPA 账号额度缓存 5 分钟，低于 10% 每小时告警一次；限流与认证异常按节点去重 5 分钟。</p></CardHeader>
    <CardContent className="space-y-4">
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {data?.channels?.filter((c:any)=>c.status==="active").map((c:any)=><details key={c.id} className="rounded-xl border p-3">
        <summary className="cursor-pointer text-sm font-semibold">{c.name} · {c.nodes.length} 个渠道节点 · {c.nodes.filter((n:any)=>n.status==="healthy").length} 个探测正常</summary>
        <div className="mt-3 max-h-96 space-y-3 overflow-y-auto">{c.nodes.map((n:any)=><div key={n.id} className="rounded-lg bg-muted/50 p-3 text-xs">
          <p className="font-semibold">{n.name} · {n.adapter} · {n.status}</p>
          <p className="mt-1 text-muted-foreground">请求 {n.requests24h} · 429 {n.rateLimited24h} · 认证错误 {n.authErrors24h} · 探测 {n.probeLatency ?? "—"} ms</p>
          <p className="text-muted-foreground">最后探测：{n.lastHealthCheck ? new Date(n.lastHealthCheck).toLocaleString() : "从未探测"}</p>
          {n.quotaMessage && <p className="mt-1 text-muted-foreground">{n.quotaMessage}</p>}
          {n.cpa && <div className="mt-2 space-y-2"><p>{n.cpa.message ?? ("CPA 内部账号：" + n.cpa.accounts.length)}</p>{n.cpa.accounts?.map((a:any)=><div key={a.id || a.name} className="rounded-lg border bg-background p-3"><p>{a.name} · {a.disabled ? "已停用" : a.status} · {a.plan ?? a.provider}</p>{a.quotaMessage && <p className="text-muted-foreground">{a.quotaMessage}</p>}{a.windows.map((w:any)=><div key={w.name} className="mt-2"><p>{w.name} · 剩余 {w.remainingPercent === null ? "未知" : w.remainingPercent.toFixed(1)+"%"} · 重置 {w.resetAt ? new Date(w.resetAt*1000).toLocaleString() : "未提供"}</p>{w.remainingPercent !== null && <progress className="mt-1 h-2 w-full accent-blue-600" max={100} value={w.remainingPercent} />}</div>)}</div>)}</div>}
        </div>)}</div>
      </details>)}
      <details className="rounded-xl border p-3"><summary className="cursor-pointer text-sm font-semibold">告警通知 Webhook</summary>
        <p className="my-2 text-xs text-muted-foreground">发送标准 JSON 到接收端；失败最多尝试 3 次，每次结果会记入下方历史。不是钉钉／企业微信专用机器人格式。</p>
        <div className="flex gap-2"><Input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://您的告警接收地址" /><Button onClick={addHook} disabled={saving||!url}>添加</Button></div>
        {hooks.map(h=><div key={h.id} className="mt-2 flex flex-wrap items-center gap-2 text-xs"><span className="break-all">{h.url} · {h.status}</span><Button size="sm" variant="outline" onClick={async()=>{try{const r=await api.testWebhook(h.id);alert(r.ok?"测试成功":"测试失败："+(r.status??r.error))}catch(e:any){setError(e.message)}}}>测试</Button><Button size="sm" variant="ghost" onClick={async()=>{try{await api.updateWebhook(h.id,{status:h.status==="active"?"disabled":"active"});await refresh()}catch(e:any){setError(e.message)}}}>{h.status==="active"?"停用":"启用"}</Button></div>)}
      </details>
      <details className="rounded-xl border p-3"><summary className="cursor-pointer text-sm font-semibold">最近告警与投递记录（50 条）</summary><div className="mt-3 max-h-64 space-y-2 overflow-y-auto">{data?.alerts?.length===0 && <p className="text-xs text-muted-foreground">暂无记录；未配置 Webhook 时仍记录站内事件。</p>}{data?.alerts?.map((a:any)=><div key={a.id} className="border-b pb-2 text-xs"><p>{new Date(a.createdAt).toLocaleString()} · {a.action}</p><pre className="mt-1 whitespace-pre-wrap break-all text-muted-foreground">{JSON.stringify(a.detail,null,2)}</pre></div>)}</div></details>
    </CardContent>
  </Card>
}
