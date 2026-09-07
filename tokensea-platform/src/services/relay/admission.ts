import type Redis from 'ioredis';
import type { FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { rateLimited,forbidden } from '../../lib/errors.js';
export function checkPlanModel(plan:any,model:string){
 if(Array.isArray(plan?.allowedModelAliases)&&plan.allowedModelAliases.length&&!plan.allowedModelAliases.includes(model))throw forbidden('该模型不在访问策略允许范围内');
}

export function tokenBudget(body:any){
 // UTF-8 bytes conservatively bound normal text input tokens. Multimodal requests
 // need a separate allowance; this is admission reservation, not billable usage.
 const input=Buffer.byteLength(JSON.stringify(body?.messages??body?.input??''));
 const output=Number(body?.max_completion_tokens??body?.max_output_tokens??body?.max_tokens??4096);
 if(!Number.isSafeInteger(output)||output<1||output>2000000)throw rateLimited('无效的输出 Token 上限');
 return input+output;
}
const LUA=`
local now=tonumber(ARGV[1]);local id=ARGV[2]
redis.call('ZREMRANGEBYSCORE',KEYS[4],'-inf',now)
if redis.call('ZCARD',KEYS[4])>=tonumber(ARGV[6]) then return 'concurrency' end
for i=1,3 do
 local cap=tonumber(ARGV[i+2]);local increment=1;if i==3 then increment=tonumber(ARGV[7]) end
 if cap>0 and tonumber(redis.call('GET',KEYS[i]) or '0')+increment>cap then return ({'QPS','RPM','TPM'})[i] end
end
for i=1,3 do
 local increment=1;if i==3 then increment=tonumber(ARGV[7]) end
 local n=redis.call('INCRBY',KEYS[i],increment)
 if n==increment then if i==1 then redis.call('EXPIRE',KEYS[i],1) else redis.call('EXPIRE',KEYS[i],60) end end
end
redis.call('ZADD',KEYS[4],now+900000,id);redis.call('EXPIRE',KEYS[4],901)
return 'ok'`;
export async function admit(redis:Redis,userId:bigint,plan:any,body:any,reply:FastifyReply,text:boolean){
 const prefix='admission:'+userId+':',id=randomUUID();
 const maxConcurrent=Math.max(1,Math.min(100,Number(process.env.USER_MAX_CONCURRENT)||4));
 const result=await redis.eval(LUA,4,prefix+'qps',prefix+'rpm',prefix+'tpm',prefix+'active',Date.now(),id,plan?.qpsLimit??5,plan?.rpmLimit??60,plan?.tpmLimit??100000,maxConcurrent,text?tokenBudget(body):0);
 if(result!=='ok')throw rateLimited(result==='concurrency'?'当前并发已满，请等待已有请求完成':result+' 限制已达到，请稍后重试（TPM 按输入及最大输出预留）');
 const release=()=>{void redis.zrem(prefix+'active',id).catch(()=>{});};
 reply.raw.once('finish',release);
 // A disconnected client does not prove the upstream stopped. Keep that lease
 // until its bounded expiry rather than allow connection-churn to bypass limits.
}
