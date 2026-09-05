import { useEffect, useState } from "react"
import { api } from "@/services/api"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card"
const money=(v:any)=>v===null?"不限额":"$"+(Number(v)/1e6).toFixed(6)
export function BillingBalance({admin=false}:{admin?:boolean}) {
  const [data,setData]=useState<any>(null),[error,setError]=useState("")
  const refresh=async()=>{try{setData(await (admin?api.billingPending():api.billingSelf()));setError("")}catch(e:any){setError(e.message)}}
  useEffect(()=>{void refresh()},[admin])
  const resolve=async(id:string,action:"retry"|"release")=>{
    const reason=prompt(action==="release"?"释放预占不会向用户扣费，上游可能仍收费。请输入至少 8 字核对依据：":"请输入至少 8 字核对依据（按已保存的用量重新结算）：");
    if(!reason)return;
    try{await api.billingReview(id,action,reason);await refresh()}catch(e:any){setError(e.message)}
  };
  const wallet=data?.accounts?.find((a:any)=>a.scope==="user")
  const rows=admin?(data??[]):(data?.reservations??[])
  return <Card><CardHeader className="flex flex-row justify-between items-center"><CardTitle>{admin?"待结算与资金异常":"余额与账单核对"}</CardTitle><Button variant="outline" onClick={refresh}>刷新</Button></CardHeader><CardContent className="space-y-3">
    {error&&<p className="text-red-500">{error}</p>}
    {wallet&&<div className="flex flex-wrap gap-6"><span>可用余额：{money(wallet.available)}</span><span>预占中：{money(wallet.held)}</span><span>累计消费：{money(wallet.used)}</span><span>{data.balanced?"本次升级后账目一致":"发现差异，请联系管理员核对"}</span></div>}
    <p className="text-sm text-muted-foreground">预占只是临时冻结，不是已消费。文字按输入及输出上限估算，图片按尺寸、质量与张数估算；视频完成后结算并释放差额。用量不明的请求保留资金待核对，不会因超时自动退款。</p>
    {rows.map((r:any)=><div key={r.requestId} className="rounded border p-3 text-sm break-all">{r.requestId} · {money(r.amount)} · {({reserved:"调用中",pending:"结算重试中",review:"待人工核对"} as any)[r.status]??r.status}{r.reason&&<span> · {r.reason}</span>}{admin&&r.status==="review"&&<div className="flex gap-2 mt-2"><Button variant="outline" onClick={()=>resolve(r.requestId,"retry")}>重试结算</Button><Button variant="outline" onClick={()=>resolve(r.requestId,"release")}>核对后免收并释放</Button></div>}</div>)}
    {data&&rows.length===0&&<p className="text-sm text-muted-foreground">暂无预占或待核对请求</p>}
    {!admin&&<p className="text-xs text-muted-foreground">升级前消费作为期初余额保留；“一致”不代表历史缺失账单已补全。</p>}
  </CardContent></Card>
}
