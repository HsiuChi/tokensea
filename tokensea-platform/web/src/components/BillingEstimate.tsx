import { useEffect, useRef, useState } from "react"
import { api } from "@/services/api"
import { Button } from "@/components/ui/button"
import {formatMoney} from '@/lib/utils'
function initial(model:any) {
  if(model.category==="image")return {prompt:"海面上的帆船",size:"1024x1024",quality:"low",n:1}
  if(model.alias.startsWith("seedance"))return {content:[{type:"text",text:"海边日落"}],duration:5,resolution:"720p",ratio:"16:9"}
  if(model.alias.startsWith("kling"))return {prompt:"海边日落",duration:5,mode:"std",sound:"off"}
  if(model.category==="video")return {prompt:"海边日落",duration:6,resolution:"768P",...(model.alias.endsWith("fast")?{first_frame_image:"https://example.com/replace-with-your-image.png"}:{})}
  return {messages:[{role:"user",content:"你好"}],max_tokens:1024}
}
export function BillingEstimate({model}:{model:any}) {
  const [keys,setKeys]=useState<any[]>([]),[key,setKey]=useState(""),[parameters,setParameters]=useState(()=>JSON.stringify(initial(model),null,2))
  const [quote,setQuote]=useState<any>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false)
  const version=useRef(0)
  useEffect(()=>{let active=true;api.listTokens(1,100).then(data=>{
    if(!active)return
    const items=(data.items??[]).filter((k:any)=>k.status==="active").map((k:any)=>({id:k.id,name:k.name}))
    setKeys(items);setKey(items[0]?.id??"")
  }).catch(()=>{if(active)setError("登录并创建 API Key 后可试算")})
    return ()=>{active=false;version.current++}
  },[])
  const invalidate=()=>{version.current++;setQuote(null);setError("");setBusy(false)}
  const calculate=async()=>{
    const current=++version.current;setBusy(true);setError("");setQuote(null)
    try{const data=await api.billingEstimate(key,model.alias,JSON.parse(parameters));if(current===version.current)setQuote(data)}
    catch(e:any){if(current===version.current)setError(e instanceof SyntaxError?"参数需要是有效 JSON":e.message)}
    finally{if(current===version.current)setBusy(false)}
  }
  return <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4 space-y-3 dark:border-blue-900/50 dark:bg-blue-500/5">
    <p className="font-semibold">预占试算</p>
    <p className="text-xs text-muted-foreground">试算不会调用模型，也不冻结或扣款。展开参数可比较尺寸、质量、时长等设置。</p>
    <label className="block text-sm">计费密钥
      <select aria-label="计费密钥" className="mt-1 w-full rounded-lg border bg-background p-2" value={key} onChange={e=>{setKey(e.target.value);invalidate()}}>
        {keys.length===0&&<option value="">暂无可用 API Key</option>}
        {keys.map(k=><option key={k.id} value={k.id}>{k.name}</option>)}
      </select>
    </label>
    <details><summary className="text-sm cursor-pointer">请求参数（JSON）</summary>
      <textarea aria-label="试算请求参数" className="mt-2 w-full min-h-48 rounded-lg border bg-background p-3 text-xs font-mono" value={parameters} onChange={e=>{setParameters(e.target.value);invalidate()}} />
    </details>
    <Button size="sm" disabled={!key||busy} onClick={calculate}>{busy?"试算中…":"计算预占金额"}</Button>
    {error&&<p role="alert" className="text-sm text-red-500">{error}</p>}
    {quote&&<div className="space-y-1 text-sm">
      <p>预计临时冻结：<strong className="text-blue-600 dark:text-blue-400">{formatMoney(Number(quote.estimatedUsd))}</strong></p>
      <p className="text-xs text-muted-foreground">这不是最终扣费。完成后按实际用量或明确的视频档位结算，释放差额。自动尺寸/质量、参考图、长上下文可能扩大估算；异常用量需核对。</p>
      <p className="text-xs text-muted-foreground">含当前套餐及路由倍率；正式提交时重新校验。</p>
    </div>}
  </div>
}
