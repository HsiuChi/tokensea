import {useEffect,useState} from 'react'
import {api} from '@/services/api'
import {Card,CardContent,CardHeader,CardTitle} from '@/components/ui/card'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Dialog,DialogContent,DialogHeader,DialogTitle} from '@/components/ui/dialog'
const initial={name:'',displayName:'',description:'',qpsLimit:5,rpmLimit:60,tpmLimit:100000,allowedModelAliases:''}
export function AdminPlans(){
 const [plans,setPlans]=useState<any[]>([]),[form,setForm]=useState(initial),[editing,setEditing]=useState<string|null>(null),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const load=()=>api.listPlans().then(setPlans).catch(e=>setError(e.message))
 useEffect(()=>{void load()},[])
 const edit=(p:any)=>{setEditing(p.id);setForm({name:p.name,displayName:p.displayName,description:p.description??'',qpsLimit:p.qpsLimit,rpmLimit:p.rpmLimit,tpmLimit:p.tpmLimit,allowedModelAliases:(p.allowedModelAliases??[]).join(',')});setOpen(true)}
 async function save(){setBusy(true);setError('');try{
  const payload={...form,allowedModelAliases:form.allowedModelAliases.split(',').map(s=>s.trim()).filter(Boolean)}
  if(editing)await api.updatePlan(editing,payload)
  else await api.createPlan({...payload,tier:'starter',isSubscription:false,isPublic:false})
  setOpen(false);await load()
 }catch(e:any){setError(e.message)}finally{setBusy(false)}}
 return <div className="space-y-5"><div className="flex justify-between"><h1 className="text-2xl font-bold">套餐与访问策略</h1><Button onClick={()=>{setEditing(null);setForm(initial);setOpen(true)}}>添加访问策略</Button></div>
  <p className="rounded-xl bg-amber-500/10 p-4 text-sm">套餐销售与续费已关闭，不会扣款或发放额度。这里只管理已有 API Key 绑定策略的权限与限流，不改动历史套餐价格和额度。</p>
  <p className="text-xs text-muted-foreground">TPM 按请求输入及最大输出预算预留，60 秒窗口自动释放；不是计费 Token 数。用户并发默认 4，可由服务器 USER_MAX_CONCURRENT 配置。</p>
  {error&&<p role="alert" className="text-sm text-red-600">{error}</p>}
  <div className="grid gap-4 md:grid-cols-2">{plans.map(p=><Card key={p.id}><CardHeader><CardTitle>{p.displayName||p.name}</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm text-muted-foreground">{p.description}</p><p className="text-sm">QPS {p.qpsLimit||'不限'} · RPM {p.rpmLimit||'不限'} · TPM {p.tpmLimit||'不限'}</p><p className="break-all text-xs text-muted-foreground">允许模型：{p.allowedModelAliases?.join(', ')||'不额外限制'}</p><Button variant="outline" onClick={()=>edit(p)}>编辑策略</Button></CardContent></Card>)}</div>
  <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>{editing?'编辑策略':'添加策略'}</DialogTitle></DialogHeader>
   {(['name','displayName','description','allowedModelAliases'] as const).map((key,i)=><label className="text-sm" key={key}>{['标识名称','显示名称','说明','允许模型（逗号分隔）'][i]}<Input value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>)}
   {(['qpsLimit','rpmLimit','tpmLimit'] as const).map((key,i)=><label className="text-sm" key={key}>{['每秒请求数','每分钟请求数','每分钟 Token 预算'][i]}（0 不限）<Input type="number" min="0" value={form[key]} onChange={e=>setForm({...form,[key]:Number(e.target.value)})}/></label>)}
   <Button disabled={busy} onClick={save}>{busy?'保存中…':'保存'}</Button>
  </DialogContent></Dialog>
 </div>
}
