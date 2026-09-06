import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '@/services/api'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { VendorIcon } from '@/components/VendorIcon'
import { formatMoney } from '@/lib/utils'
import { VIDEO_MODELS, VIDEO_STATUS, videoDefaults, videoRequest, resultVideo } from '@/lib/video-workbench'
import { Film, RefreshCw, Download, Loader2 } from 'lucide-react'

type Pending = {id:string;model:string;key:string;path:string;body:any}
export function VideoWorkbenchPage(){
  const [params]=useSearchParams(),{user}=useAuth()
  const initial=params.get('model')??'seedance-2.5'
  const [model,setModel]=useState(initial)
  const [settings,setSettings]=useState(()=>videoDefaults(model))
  const [models,setModels]=useState<any[]>([]),[keys,setKeys]=useState<any[]>([]),[key,setKey]=useState('')
  const [tasks,setTasks]=useState<any[]>([]),[error,setError]=useState(''),[historyError,setHistoryError]=useState('')
  const [busy,setBusy]=useState(false),[quote,setQuote]=useState<any>(null),[pending,setPending]=useState<Pending|null>(null)
  const lock=useRef(false),version=useRef(0),storageKey='tokensea-video-pending:'+user?.id
  const cls='w-full rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-900'
  const refresh=async()=>{try{setTasks(await api.videoTasks());setHistoryError('')}catch{setHistoryError('任务记录暂时加载失败，稍后刷新即可；请不要因此重新提交。')}}
  useEffect(()=>{
    let alive=true
    Promise.all([api.listTokens(1,100),fetch('/api/public/models').then(r=>{if(!r.ok)throw Error();return r.json()})]).then(([k,m])=>{
      if(!alive)return
      const active=(k.items??[]).filter((x:any)=>x.status==='active'&&(!x.expiresAt||new Date(x.expiresAt)>new Date()))
      setKeys(active);setKey(String(active[0]?.id??''));setModels(m.data.filter((x:any)=>x.category==='video'&&VIDEO_MODELS.includes(x.alias)))
    }).catch(()=>{if(alive)setError('加载模型或密钥失败，请刷新页面')})
    try{const saved=JSON.parse(localStorage.getItem(storageKey)??'null');if(saved?.id&&saved?.body)setPending(saved)}catch{}
    const poll=async()=>{try{const rows=await api.videoTasks();if(alive){setTasks(rows);setHistoryError('')}}catch{if(alive)setHistoryError('任务记录暂时加载失败，请稍后刷新。')}}
    void poll();const timer=setInterval(poll,10000)
    return()=>{alive=false;clearInterval(timer);version.current++}
  },[storageKey])
  const change=(patch:any)=>{version.current++;setQuote(null);setSettings(s=>({...s,...patch}));setError('')}
  const estimate=async()=>{
    if(lock.current)return
    const v=++version.current;lock.current=true;setBusy(true);setError('');setQuote(null)
    try{const req=videoRequest(model,settings);const data=await api.billingEstimate(key,model,req.body);if(v===version.current)setQuote({...data,request:req,model,key})}
    catch(e:any){setError(e.message)}finally{lock.current=false;setBusy(false)}
  }
  const submit=async(retry?:Pending)=>{
    if(lock.current||(!retry&&!quote))return
    lock.current=true;setBusy(true);setError('')
    const job=retry??{id:crypto.randomUUID(),model:quote.model,key:quote.key,path:quote.request.path,body:quote.request.body}
    try{
      // Persist before the request: an interrupted browser must reuse the exact id and payload.
      localStorage.setItem(storageKey,JSON.stringify(job));setPending(job)
      await api.submitVideo(job.model,job.path,job.body,job.key,job.id)
      localStorage.removeItem(storageKey);setPending(null);setQuote(null);await refresh()
    }catch(e:any){
      if(!retry&&[400,401,403,404,422,429].includes(e.status)){localStorage.removeItem(storageKey);setPending(null);setQuote(null);setError(e.message)}
      else setError(e.message+'。如结果不明确，请使用“恢复本次提交”，不要创建新任务。')
    }
    finally{lock.current=false;setBusy(false)}
  }
  const hailuo=model.startsWith('hailuo'),kling=model.startsWith('kling')
  return <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-widest text-blue-500">TokenSea Playground</p><h1 className="mt-2 text-2xl font-bold">视频工作台</h1><p className="mt-2 text-sm text-muted-foreground">让文字与画面，成为下一段镜头。</p></div><Link className="text-sm text-blue-500" to="/app/marketplace">返回模型广场 →</Link></header>
    <div className="grid items-start gap-6 lg:grid-cols-[380px_1fr]">
      <section className="space-y-4 rounded-3xl border bg-card p-5 shadow-sm">
        <fieldset disabled={busy||!!pending} className="space-y-4 disabled:opacity-60">
          <label className="block text-sm">模型<select className={cls+' mt-2'} value={model} onChange={e=>{setModel(e.target.value);setSettings(videoDefaults(e.target.value));setQuote(null);version.current++}}><option value="" disabled>选择模型</option>{!models.some(m=>m.alias===model)&&<option value={model} disabled>{model}（加载中或未开放）</option>}{models.map(m=><option key={m.alias} value={m.alias}>{m.displayName||m.alias}</option>)}</select></label>
          <label className="block text-sm">计费 API Key<select className={cls+' mt-2'} value={key} onChange={e=>{setKey(e.target.value);setQuote(null);version.current++}}>{!keys.length&&<option value="">请先创建 API Key</option>}{keys.map(k=><option key={k.id} value={String(k.id)}>{k.name}</option>)}</select></label>
          <label className="block text-sm">画面描述<textarea className={cls+' mt-2 min-h-32 resize-y'} maxLength={5000} value={settings.prompt} onChange={e=>change({prompt:e.target.value})} placeholder="例如：清晨的海面，一艘蓝色帆船驶过，镜头缓慢向前推进，电影感自然光。" /></label>
          {model!=='kling-v3-omni'&&<label className="block text-sm">参考图 {model==='hailuo-2.3-fast'?'（必填）':'（可选）'}<input className={cls+' mt-2'} type="url" value={settings.image} onChange={e=>change({image:e.target.value})} placeholder="https://…/image.png"/><span className="mt-1 block text-xs text-muted-foreground">目前支持公开 HTTPS 图片链接，不支持本地上传。</span></label>}
          <div className="grid grid-cols-2 gap-3"><label className="text-sm">时长<select className={cls+' mt-2'} value={settings.duration} onChange={e=>change({duration:Number(e.target.value)})}>{(hailuo?(settings.resolution==='1080P'?[6]:[6,10]):kling?[3,5,10,15]:[4,5,10,15]).map(n=><option key={n} value={n}>{n} 秒</option>)}</select></label>
            {kling?<label className="text-sm">质量<select className={cls+' mt-2'} value={settings.quality} onChange={e=>change({quality:e.target.value})}><option value="std">标准</option><option value="pro">高品质</option></select></label>:<label className="text-sm">分辨率<select className={cls+' mt-2'} value={settings.resolution} onChange={e=>change({resolution:e.target.value,...(e.target.value==='1080P'?{duration:6}:{})})}>{(hailuo?['768P','1080P']:['480p','720p','1080p']).map(r=><option key={r}>{r}</option>)}</select></label>}
          </div>
          {!hailuo&&<div className="grid grid-cols-2 items-center gap-3"><label className="text-sm">画幅<select className={cls+' mt-2'} value={settings.ratio} onChange={e=>change({ratio:e.target.value})}>{['16:9','9:16','1:1'].map(r=><option key={r}>{r}</option>)}</select></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.sound} onChange={e=>change({sound:e.target.checked})}/>生成声音</label></div>}
        </fieldset>
        {error&&<p role="alert" className="text-sm text-red-500">{error}</p>}
        {pending?<div className="space-y-2 rounded-xl bg-amber-500/10 p-3 text-sm"><p>有一次提交尚未确认。恢复会沿用原任务标识和参数，不创建重复任务。</p><Button disabled={busy} onClick={()=>submit(pending)}>恢复本次提交</Button><p className="text-xs">如密钥失效或参数被拒绝，请联系支持并提供提交标识：{pending.id}</p></div>:quote?<div className="space-y-3 rounded-xl bg-blue-500/5 p-4"><p className="text-sm">预计临时冻结</p><p className="font-semibold text-blue-500">{formatMoney(Number(quote.estimatedUsd))}</p><p className="text-xs text-muted-foreground">最终按实际用量或视频档位结算，释放差额。正式提交会重新校验价格和余额。</p><Button className="w-full" disabled={busy} onClick={()=>submit()}>{busy?'提交中…':'确认费用并生成'}</Button></div>:<Button className="w-full" disabled={busy||!key||!models.some(m=>m.alias===model)} onClick={estimate}>{busy?<Loader2 className="mr-2 size-4 animate-spin"/>:<Film className="mr-2 size-4"/>}预估费用</Button>}
        <p className="text-xs leading-relaxed text-muted-foreground">试算不扣费。生成任务不会因关闭页面而取消。服务暂不支持取消已提交任务。</p>
      </section>
      <section className="space-y-4"><div className="flex items-center justify-between"><h2 className="font-semibold">我的生成记录 <span className="text-sm font-normal text-muted-foreground">最近 100 条</span></h2><Button size="sm" variant="ghost" onClick={refresh}><RefreshCw className="mr-2 size-4"/>刷新</Button></div>
        {historyError&&<p role="alert" className="text-sm text-amber-600">{historyError}</p>}
        {!tasks.length&&<div className="flex min-h-80 flex-col items-center justify-center rounded-3xl border border-dashed bg-card p-8 text-center"><Film className="mb-4 size-10 text-blue-400"/><h3 className="font-semibold">你的第一个镜头，从这里开始</h3><p className="mt-2 text-sm text-muted-foreground">选择模型，描述画面，确认费用后开始生成。</p></div>}
        {tasks.map(task=>{const url=resultVideo(task);return <article key={task.id} className="overflow-hidden rounded-2xl border bg-card"><div className="flex flex-wrap items-center justify-between gap-2 p-4"><div className="flex items-center gap-2"><VendorIcon name={task.model} size={24}/><span className="font-medium">{task.model}</span></div><span className="rounded-full bg-blue-500/10 px-3 py-1 text-xs">{VIDEO_STATUS[task.status]??'状态待确认'}</span></div>
          {url?<video className="aspect-video w-full bg-black" controls preload="metadata" src={url}/>:<div className="flex min-h-36 items-center justify-center bg-muted/40 px-4 text-center text-sm text-muted-foreground">{task.status==='running'||task.status==='submitting'?<><Loader2 className="mr-2 size-4 animate-spin"/>任务处理中，页面每 10 秒更新</>:task.status==='review'?'上游结果或计费待核对，预占暂时保留，请勿重复生成。':task.status==='failed'?'生成失败，请查看扣费状态。':'暂未获取到可播放视频链接'}</div>}
          <div className="space-y-2 p-4 text-xs text-muted-foreground"><p>{new Date(task.createdAt).toLocaleString()} · 预占 {formatMoney(task.billing.reservedUsd)} · 已扣 {formatMoney(task.billing.chargedUsd)} · {task.billing.status==='released'?'预占已释放':task.billing.status==='settled'?'已结算':'待结算'}</p><p className="break-all">任务 ID：{task.id}</p>{url&&<a className="inline-flex items-center gap-1 text-blue-500" href={url} target="_blank" rel="noopener noreferrer" download><Download className="size-4"/>打开／下载视频</a>}<p>结果链接可能过期，请及时下载保存。</p></div>
        </article>})}
      </section>
    </div>
  </div>
}
