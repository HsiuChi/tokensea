import type {PrismaClient} from '@prisma/client';
import {createHmac} from 'node:crypto';
export async function deliverPending(p:PrismaClient){
 const jobs=await p.webhookDelivery.findMany({where:{status:'pending',nextAt:{lte:new Date()}},orderBy:{nextAt:'asc'},take:10});
 for(const job of jobs){
  const claimed=await p.webhookDelivery.updateMany({where:{id:job.id,status:'pending',nextAt:job.nextAt},data:{nextAt:new Date(Date.now()+60000)}});
  if(!claimed.count)continue;
  const hook=await p.webhook.findUnique({where:{id:job.webhookId}});
  if(!hook||hook.status!=='active'){await p.webhookDelivery.update({where:{id:job.id},data:{status:'cancelled'}});continue;}
  const body=JSON.stringify(job.payload),headers:Record<string,string>={'content-type':'application/json','x-tokensea-delivery-id':job.id.toString()};
  if(hook.secret)headers['x-tokensea-signature']='sha256='+createHmac('sha256',hook.secret).update(body).digest('hex');
  let status:number|null=null;
  try{const r=await fetch(hook.url,{method:'POST',headers,body,redirect:'error',signal:AbortSignal.timeout(5000)});status=r.status;await r.body?.cancel();}catch{}
  const attempts=job.attempts+1,ok=status!==null&&status>=200&&status<300;
  const permanent=status!==null&&status>=400&&status<500&&status!==429;
  await p.$transaction(async tx=>{
   await tx.webhookDelivery.update({where:{id:job.id},data:{attempts,lastStatus:status,status:ok?'delivered':permanent||attempts>=5?'failed':'pending',nextAt:new Date(Date.now()+Math.min(3600,30*2**attempts)*1000)}});
   await tx.auditLog.create({data:{action:ok?'webhook.delivered':'webhook.failed',targetType:'webhook_delivery',targetId:job.webhookId.toString(),detail:{deliveryId:job.id.toString(),attempts,status,ok,event:job.event}}});
  });
 }
}
