// Run inside the application container; no credential is printed or written.
import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';
import {generateApiKey} from './src/lib/crypto.ts';
import {signToken} from './src/lib/jwt.ts';
import {ReservationService} from './src/services/billing/reservation-service.ts';
const p=new PrismaClient();
const [mode,revision]=process.argv.slice(2);
assert(['start','check','close'].includes(mode)&&/^[a-f0-9]{7,40}$/.test(revision??''),'mode and git revision required');
const username='release_verify_'+revision.slice(0,8),models=['gpt-6-astra','gpt-image-2','kling-v3'];
const emit=value=>console.log(JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v));
try {
  let user=await p.user.findUnique({where:{username}});
  if(mode==='start'){
    assert(!user,'Verification already started; never repeat paid calls');
    user=await p.user.create({data:{username,passwordHash:'no-password-release-fixture',inviteCode:revision.slice(0,12),quota:5000000n,remark:'Release verification '+revision}});
    const secret=generateApiKey();
    const group=await p.keyGroup.create({data:{name:username,userId:user.id,quota:5000000n}});
    await p.apiKey.create({data:{userId:user.id,keyGroupId:group.id,name:'release-validation',keyHash:secret.hash,keyPrefix:secret.prefix,models,quota:5000000n}});
    emit({stage:'created',userId:user.id});
    const jwt=signToken({userId:user.id,role:'user'},process.env.JWT_SECRET,'15m');
    const call=async(path,body,auth=secret.raw,extra={})=>{
      const r=await fetch('http://127.0.0.1:3000'+path,{method:'POST',headers:{authorization:'Bearer '+auth,'content-type':'application/json',...extra},body:JSON.stringify(body),signal:AbortSignal.timeout(240000)});
      const b=await r.json();assert(r.ok,JSON.stringify({path,status:r.status,code:b.error?.code,message:b.error?.message}));return b;
    };
    const key=await p.apiKey.findFirstOrThrow({where:{userId:user.id}});
    const estimate=await call('/api/billing/estimate',{apiKeyId:String(key.id),model:'gpt-image-2',parameters:{prompt:'A simple blue circle on white',size:'1024x1024',quality:'low',n:1}},jwt);
    assert(Number(estimate.data.estimatedUsd)>0&&Number(estimate.data.estimatedUsd)<0.1);
    emit({stage:'estimate',usd:estimate.data.estimatedUsd});
    const chat=await call('/v1/chat/completions',{model:'gpt-6-astra',messages:[{role:'user',content:'Reply with OK only.'}],max_completion_tokens:64});
    assert(chat.usage && Array.isArray(chat.choices));emit({stage:'chat',usage:chat.usage});
    const image=await call('/v1/images/generations',{model:'gpt-image-2',prompt:'A simple blue circle on white',size:'1024x1024',quality:'low',n:1});
    assert(image.usage&&image.data?.length===1);emit({stage:'image',usage:image.usage});
    const body={prompt:'A static blue ocean with gentle waves, no people, no text.',duration:3,mode:'std',sound:'off'};
    const extra={'idempotency-key':'release-'+revision};
    const video=await call('/v1/video/kling-v3/v1/videos/text2video',body,secret.raw,extra);
    const repeated=await call('/v1/video/kling-v3/v1/videos/text2video',body,secret.raw,extra);
    assert.equal(video.id,repeated.id);assert.equal(await p.billingReservation.count({where:{userId:user.id}}),3);
    emit({stage:'video',id:video.id,status:video.status,idempotencyVerified:true});
  } else {
    assert(user,'Verification user missing');
    const rows=await p.billingReservation.findMany({where:{userId:user.id},orderBy:{createdAt:'asc'}});
    const service=new ReservationService(p),reconciliation=await service.reconcile(user.id);
    assert(reconciliation.balanced,'Wallet/key/group reconciliation mismatch');
    emit({stage:'reconcile',balanced:true,rows:rows.map(r=>({id:r.requestId,model:r.pricing.alias.alias,status:r.status,amount:r.amount,charged:r.charged,reason:r.reason}))});
    if(mode==='close'){
      assert.equal(rows.length,3);assert(rows.every(r=>r.status==='settled'),'Not every smoke call settled');
      const jwt=signToken({userId:user.id,role:'user'},process.env.JWT_SECRET,'5m');
      const video=rows.find(r=>r.pricing.alias.category==='video');
      const before=await p.usageLedger.count({where:{userId:user.id}});
      for(let i=0;i<2;i++){
        const result=await fetch('http://127.0.0.1:3000/v1/video/kling-v3/tasks/'+video.requestId,{headers:{authorization:'Bearer '+jwt}});
        assert(result.ok);const b=await result.json();assert.equal(b.status,'succeeded');assert(b.result?.videos?.length);
      }
      assert.equal(await p.usageLedger.count({where:{userId:user.id}}),before);
      await p.apiKey.updateMany({where:{userId:user.id},data:{status:'disabled'}});
      await p.keyGroup.updateMany({where:{userId:user.id},data:{status:'disabled'}});
      const fresh=await p.user.findUniqueOrThrow({where:{id:user.id}});
      await p.user.update({where:{id:user.id},data:{status:'disabled',quota:fresh.usedQuota}});
      emit({stage:'closed',paidUnits:fresh.usedQuota,historyRetained:true,credentialsDisabled:true});
    }
  }
} finally {await p.$disconnect();}
