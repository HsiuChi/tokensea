import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { signToken } from "../src/lib/jwt.js";
import { calculateTokenPrice, openAiUsage } from "../src/services/billing/token-pricing.js";
import { REVIEWED_OPENAI_MODELS } from "../src/config/reviewed-openai-models.js";
if(!process.argv.includes("--run")) throw new Error("Explicit --run required: creates and cleans isolated test fixtures; sends one small chat and optionally one low-quality image");
const p=new PrismaClient();
const redis=new Redis(process.env.REDIS_URL!);
const suffix=Date.now().toString(36);
const user=await p.user.create({data:{username:"verify_"+suffix,passwordHash:"disabled-test-login-"+randomBytes(16).toString("hex"),inviteCode:randomBytes(6).toString("hex"),quota:1000000n,remark:"Temporary release verification fixture"}});
const jwt=signToken({userId:user.id,role:"user"},process.env.JWT_SECRET!,"10m");
const base=process.env.VERIFY_BASE_URL??"http://127.0.0.1:3000";
async function request(path:string,body?:any,token=jwt,method=body?"POST":"GET") {
  const r=await fetch(base+path,{method,headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(180000)});
  const d=await r.json();return {status:r.status,d:d as any};
}
try {
  assert.equal((await request("/api/channel/operations")).status,403);
  const create=await request("/api/token/",{name:"release-test",quota:"100000",models:["gpt-6-astra","gpt-image-2"],allowedIps:["127.0.0.1"]});
  assert.equal(create.status,201);
  const {key,apiKey}=create.d.data;
  const sample={model:"gpt-6-astra",messages:[{role:"user",content:"Reply OK."}],max_tokens:5};
  const set=async(body:any)=>{assert.equal((await request("/api/token/"+apiKey.id,body,jwt,"PUT")).status,200)};
  assert.equal((await request("/api/token/"+apiKey.id,{allowedIps:["not-ip"]},jwt,"PUT")).status,400);
  await set({allowedIps:["203.0.113.0/24"]});assert.equal((await request("/v1/chat/completions",sample,key)).status,403);
  await set({allowedIps:[],quota:"0"});assert.equal((await request("/v1/chat/completions",sample,key)).status,429);
  await set({quota:"100000",expiresAt:"2020-01-01T00:00:00.000Z"});assert.equal((await request("/v1/chat/completions",sample,key)).status,401);
  await set({expiresAt:null,models:["gpt-image-2"]});assert.equal((await request("/v1/chat/completions",sample,key)).status,403);
  await set({models:["gpt-6-astra","gpt-image-2"]});
  const configuredChannel=await p.channel.findUniqueOrThrow({where:{id:2}});
  const savedKey=await p.apiKey.findUniqueOrThrow({where:{id:apiKey.id},include:{plan:true}});
  const planMultiplier=savedKey.plan?.billingMultiplier??1;
  const channelMultiplier=configuredChannel.billingMultiplier;
  const chat=await request("/v1/chat/completions",sample,key);assert.equal(chat.status,200);assert.equal(chat.d.model,"gpt-6-astra");
  const chatLog=await p.requestLog.findFirst({where:{userId:user.id,requestedModel:"gpt-6-astra"}});
  assert(chatLog && chatLog.billableUnits>0n);
  assert.equal(chatLog.billableUnits,calculateTokenPrice(REVIEWED_OPENAI_MODELS[0],openAiUsage(chat.d.usage),planMultiplier,channelMultiplier).billableUnits);
  const detail=await request("/api/log/self/"+chatLog.requestId);assert.equal(detail.status,200);assert(!("nodeId" in detail.d.data));assert.equal(detail.d.data.pricingDetail.version,2);
  const stats=await request("/api/log/self/stats?period=24h");assert.equal(stats.d.data.quality.totalRequests,1);assert.equal(stats.d.data.quality.successRate,100);
  const csv=await request("/api/log/self/export");assert(csv.d.data.csv.includes(chatLog.requestId));
  let imageChecked=false;
  if(process.argv.includes("--image")) {
    const img=await request("/v1/images/generations",{model:"gpt-image-2",prompt:"One blue dot on white",quality:"low",size:"1024x1024",n:1},key);
    assert.equal(img.status,200);assert(img.d.data[0].b64_json);
    const log=await p.requestLog.findFirst({where:{userId:user.id,requestedModel:"gpt-image-2"}});
    assert(log && log.billableUnits>0n);assert.equal(log.billableUnits,calculateTokenPrice(REVIEWED_OPENAI_MODELS[1],openAiUsage(img.d.usage),planMultiplier,channelMultiplier).billableUnits);
    imageChecked=true;
  }
  console.log(JSON.stringify({passed:true,planMultiplier,channelMultiplier,keyPolicies:true,adminAccessDenied:true,chatBilling:true,requestDetail:true,statistics:true,csv:true,imageBilling:imageChecked}));
} finally {
  // Only fixtures created by this invocation are removed; no user data is touched.
  await p.$transaction(async tx=>{
    await tx.usageLedger.deleteMany({where:{userId:user.id}});
    await tx.requestLog.deleteMany({where:{userId:user.id}});
    await tx.apiKey.deleteMany({where:{userId:user.id}});
    await tx.user.delete({where:{id:user.id}});
  });
  await redis.del("tokensea:ratelimit:user:"+user.id+":qps","tokensea:ratelimit:user:"+user.id+":rpm");
  const day=new Date().toISOString().slice(0,10).replaceAll("-","");
  await redis.del("tokensea:quota:user:"+user.id+":daily:"+day);
  await redis.quit();await p.$disconnect();
  console.log("Temporary verification user, key and request records cleaned up");
}
