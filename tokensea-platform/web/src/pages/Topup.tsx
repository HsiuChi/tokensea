import {useEffect,useState,useRef} from 'react'
import {api} from '@/services/api'
import {useAuth} from '@/hooks/useAuth'
import {Card,CardHeader,CardTitle,CardContent} from '@/components/ui/card'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {formatQuota,formatMoney} from '@/lib/utils'
import {Wallet,RefreshCw} from 'lucide-react'

const statusName:Record<string,string>={pending:'待确认',success:'已到账',failed:'已关闭／失败',refunded:'已退款'}
export function TopupPage(){
 const {refreshUser}=useAuth(),[wallet,setWallet]=useState<any>(null),[methods,setMethods]=useState<any[]>([])
 const [orders,setOrders]=useState<any[]>([]),[entries,setEntries]=useState<any[]>([]),[amount,setAmount]=useState('50')
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[code,setCode]=useState('')
 const [page,setPage]=useState(1),[entryPage,setEntryPage]=useState(1),[total,setTotal]=useState(0)
 const submission=useRef<{id:string;amount:number;method:string}|null>(null)
 const load=async()=>{try{
  const [w,m,o,e]=await Promise.all([api.walletSummary(),api.paymentMethods(),api.getTopupOrders(page),api.walletEntries(entryPage)])
  setWallet(w);setMethods(m.methods);setOrders(o.items);setTotal(o.total);setEntries(e)
 }catch(e:any){setError(e.message)}}
 useEffect(()=>{void load()},[page,entryPage])
 useEffect(()=>{const timer=setInterval(()=>void load(),15000);return()=>clearInterval(timer)},[page,entryPage])
 async function pay(method:string){
  if(busy)return;setBusy(true);setError('');setNotice('')
  try{
   const value=Number(amount)
   if(!submission.current||submission.current.amount!==value||submission.current.method!==method)submission.current={id:crypto.randomUUID(),amount:value,method}
   const result=await api.createTopupOrder(method,value,submission.current.id)
   if(result.checkoutUrl)window.location.assign(result.checkoutUrl)
   else setNotice('订单已创建，请查看订单状态。只有服务端确认支付后才会到账。')
   await load()
  }catch(e:any){setError(e.message+'；如提交结果不明，请保持金额和支付方式不变重试。')}finally{setBusy(false)}
 }
 async function redeem(){if(busy)return;setBusy(true);setError('');setNotice('');try{const r=await api.redeemCode(code.trim());setNotice(r.message||'兑换成功');setCode('');await load();await refreshUser()}catch(e:any){setError(e.message)}finally{setBusy(false)}}
 async function refresh(id:string){if(busy)return;setBusy(true);setError('');try{await api.refreshTopup(id);await load();await refreshUser()}catch(e:any){setError(e.message)}finally{setBusy(false)}}
 return <div className="space-y-6">
  <div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold">钱包与充值</h1><p className="mt-1 text-sm text-muted-foreground">人民币展示，美元账本；消费与资金变动分别记账。</p></div><Button variant="outline" onClick={()=>void load()}><RefreshCw className="mr-2 size-4"/>刷新</Button></div>
  {error&&<p role="alert" className="rounded-xl bg-red-500/10 p-4 text-sm text-red-600">{error}</p>}
  {notice&&<p role="status" className="rounded-xl bg-emerald-500/10 p-4 text-sm">{notice}</p>}
  <div className="grid gap-4 sm:grid-cols-3">{[['可用余额',wallet?.available],['处理中冻结',wallet?.held],['累计已用',wallet?.used]].map(([label,value])=><Card key={label}><CardHeader><CardTitle className="text-sm text-muted-foreground">{label}</CardTitle></CardHeader><CardContent className="text-xl font-semibold">{wallet?value===null?'不限额':formatMoney(Number(value)/1e6):'—'}</CardContent></Card>)}</div>
  {wallet&&!wallet.balanced&&<p className="text-sm text-amber-600">钱包流水存在差异，请联系管理员核对；系统不会自动改动余额。</p>}
  <Card><CardHeader><CardTitle className="flex items-center gap-2"><Wallet className="size-5"/>余额充值</CardTitle></CardHeader><CardContent className="space-y-4">
   {!methods.some(m=>m.enabled)&&<p className="rounded-xl bg-blue-500/5 p-4 text-sm">在线支付暂未开放，支付宝和微信商户尚未配置。你仍可使用兑换码充值。</p>}
   <label className="block text-sm">充值预算（人民币元）<Input aria-label="充值金额" className="mt-2 max-w-xs" type="number" min="1" max="10000" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
   <p className="text-xs text-muted-foreground">固定参考汇率 ¥7.2 / $1。Stripe 按美元分取整，实际收费以结账页为准，按实付美元等额入账。</p>
   <div className="grid gap-3 sm:grid-cols-3">{methods.map(m=><div key={m.id} className="rounded-xl border p-3"><Button className="w-full" disabled={!m.enabled||busy} onClick={()=>pay(m.id)}>{m.name}{!m.enabled?' · 未开放':''}</Button>{!m.enabled&&<p className="mt-2 text-xs text-muted-foreground">{m.reason}</p>}</div>)}</div>
  </CardContent></Card>
  <Card><CardHeader><CardTitle>兑换码</CardTitle></CardHeader><CardContent className="flex gap-3"><Input aria-label="兑换码" value={code} onChange={e=>setCode(e.target.value)} placeholder="输入兑换码"/><Button disabled={busy||!code.trim()} onClick={redeem}>兑换</Button></CardContent></Card>
  <Card><CardHeader><CardTitle>充值订单</CardTitle></CardHeader><CardContent className="space-y-3">
   {!orders.length&&<p className="text-sm text-muted-foreground">暂无充值订单</p>}
   {orders.map(o=><div key={o.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 text-sm"><div><p className="font-semibold">{o.currency==='usd'?'$':o.currency==='cny'?'¥':''}{o.money} {o.currency==='legacy'?'（历史单位待核对）':''} · {statusName[o.status]||o.status}</p><p className="break-all text-xs text-muted-foreground">{o.tradeNo} · {new Date(o.createdAt).toLocaleString()}</p>{o.unitVersion!=='legacy'&&<p className="text-xs text-muted-foreground">入账额度：{formatQuota(o.amount)}</p>}</div>{o.status==='pending'&&<Button variant="outline" disabled={busy} onClick={()=>refresh(o.id)}>核验支付状态</Button>}</div>)}
   <div className="flex gap-2"><Button variant="ghost" disabled={page===1} onClick={()=>setPage(page-1)}>上一页</Button><Button variant="ghost" disabled={page*20>=total} onClick={()=>setPage(page+1)}>下一页</Button></div>
  </CardContent></Card>
  <Card><CardHeader><CardTitle>资金变动流水</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-xs text-muted-foreground">{wallet?.history} API 消费明细请查看“使用记录”。</p>
   {!entries.length&&<p className="text-sm text-muted-foreground">暂无新资金变动</p>}
   {entries.map(e=><div key={e.id} className="flex flex-wrap justify-between gap-2 border-b py-3 text-sm"><div><p>{e.reason}</p><p className="text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString()} · {e.reference}</p></div><span className={Number(e.delta)>=0?'text-emerald-600':'text-amber-600'}>{Number(e.delta)>=0?'+':''}{formatMoney(Number(e.delta)/1e6)}</span></div>)}
   <div className="flex gap-2"><Button variant="ghost" disabled={entryPage===1} onClick={()=>setEntryPage(entryPage-1)}>上一页</Button><Button variant="ghost" disabled={entries.length<20} onClick={()=>setEntryPage(entryPage+1)}>下一页</Button></div>
  </CardContent></Card>
 </div>
}
