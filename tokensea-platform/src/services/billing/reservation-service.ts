import type { PrismaClient, Prisma } from "@prisma/client";
import { badRequest, rateLimited } from "../../lib/errors.js";
import { calculateTokenPrice, type TokenUsage } from "./token-pricing.js";
import { quoteReservation } from "./reservation-estimate.js";
import { videoSettlement } from "./video-pricing.js";

const HELD = ["reserved", "pending", "review"];
const json = (v: any) => JSON.parse(JSON.stringify(v, (_, x) => typeof x === "bigint" ? x.toString() : x));
const min = (...v: bigint[]) => v.reduce((a, b) => a < b ? a : b);

export function estimateReservation(alias: any, body: any, planMultiplier: number, channelMultiplier: number, image = false) {
  return quoteReservation(alias, body, planMultiplier, channelMultiplier, image).amount;
}

export class ReservationService {
  constructor(private p: PrismaClient) {}

  async markForReview(requestId: string, reason: string) {
    await this.p.billingReservation.updateMany({where:{requestId,status:"reserved"},data:{status:"review",reason}});
  }

  private async lock(tx: Prisma.TransactionClient, userId: bigint, groupId: bigint | null) {
    // Row locks serialize all keys belonging to a wallet, across processes/replicas.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    if (groupId) await tx.$queryRaw`SELECT id FROM key_groups WHERE id = ${groupId} FOR UPDATE`;
  }

  async reserve(requestId: string, keyId: bigint, alias: any, body: any, channelMultipliers: Record<string, number>, image = false) {
    return this.p.$transaction(async tx => {
      const initial = await tx.apiKey.findUniqueOrThrow({where: {id:keyId}});
      await this.lock(tx, initial.userId, initial.keyGroupId);
      await tx.$queryRaw`SELECT id FROM api_keys WHERE id = ${keyId} FOR UPDATE`;
      const existing = await tx.billingReservation.findUnique({where:{requestId}});
      if (existing) { if(existing.apiKeyId !== keyId) throw badRequest("Reservation ownership mismatch"); return existing; }
      const key = await tx.apiKey.findUniqueOrThrow({where:{id:keyId},include:{user:true,keyGroup:true,plan:true}});
      if(key.deletedAt || key.status !== "active" || key.user.status !== "active" || (key.expiresAt && key.expiresAt <= new Date()) || (key.keyGroup && key.keyGroup.status !== "active")) throw rateLimited("Account or key unavailable");
      const planMultiplier = key.plan?.billingMultiplier ?? 1;
      const quote = quoteReservation(alias, body, planMultiplier, Math.max(...Object.values(channelMultipliers)), image);
      const amount = quote.amount;
      if(await tx.billingReservation.count({where:{userId:key.userId,status:"review"}})) throw rateLimited("A previous request requires billing review");
      const holds = await tx.billingReservation.findMany({where:{status:{in:HELD},OR:[{userId:key.userId},...(key.keyGroupId?[{keyGroupId:key.keyGroupId}]:[])]}});
      const sum = (f:(r:any)=>boolean) => holds.filter(f).reduce((a,r)=>a+r.amount,0n);
      for (const [scope, account, held] of [["user",key.user,sum(r=>r.userId===key.userId)],["key",key,sum(r=>r.apiKeyId===key.id)],["group",key.keyGroup,sum(r=>r.keyGroupId===key.keyGroupId)]] as const) {
        if(!account) continue;
        if(account.quota >= 0n && account.quota-account.usedQuota-held < amount) throw rateLimited(`Insufficient ${scope} available quota; temporary reservation requires USD ${(Number(amount)/1e6).toFixed(6)}`);
        await tx.billingBaseline.upsert({where:{scope_accountId:{scope,accountId:account.id}},create:{scope,accountId:account.id,openingUsed:account.usedQuota},update:{}});
      }
      if(key.maxCalls >= 0n && key.usedCalls + BigInt(holds.filter(r=>r.apiKeyId===key.id).length) >= key.maxCalls) throw rateLimited("API key call limit reached");
      if(key.dailyLimit >= 0n) {
        const start = new Date(); start.setUTCHours(0,0,0,0);
        const spent = await tx.usageLedger.aggregate({where:{userId:key.userId,createdAt:{gte:start}},_sum:{billableUnits:true}});
        if((spent._sum.billableUnits??0n)+sum(r=>r.userId===key.userId)+amount > key.dailyLimit) throw rateLimited("Daily available quota insufficient");
      }
      return tx.billingReservation.create({data:{requestId,userId:key.userId,apiKeyId:key.id,keyGroupId:key.keyGroupId,amount,pricing:json({alias,planMultiplier,channelMultipliers,estimate:quote.detail})}});
    },{timeout:15000});
  }

  // Save the result before settlement. A crash after this write is replayable;
  // a crash before it leaves a visible, held request for manual review.
  async finish(ctx: any, usage: TokenUsage, status: string, httpStatus: number, errorCode?: string) {
    if(Object.values(usage).some(v=>!Number.isSafeInteger(v)||Number(v)<0||Number(v)>2147483647)) {
      await this.markForReview(ctx.requestId,"invalid_upstream_usage");
      throw badRequest("Invalid upstream usage; reservation retained for review");
    }
    const result = json({ctx:{requestId:ctx.requestId,model:ctx.model,upstreamModel:ctx.upstreamModel,channelId:ctx.channelId,nodeId:ctx.nodeId,endpoint:ctx.endpoint??"/v1/chat/completions",stream:!!ctx.stream,startedAt:ctx.startedAt},usage,status,httpStatus,errorCode,finishedAt:new Date()});
    await this.p.billingReservation.updateMany({where:{requestId:ctx.requestId,status:"reserved"},data:{status:"pending",payload:result}});
    const finalized=await this.finalize(ctx.requestId);
    if(finalized.status==="review") throw badRequest("Billing review required; request ID: "+ctx.requestId);
    return finalized;
  }

  async finishVideo(requestId: string, videoJob: any, status: "succeeded" | "failed", usageTokens?: number) {
    const payload = json({ videoJob, videoSettlement: true, usageTokens, status,
      httpStatus: status === "succeeded" ? 200 : 502, errorCode: status === "failed" ? "video_generation_failed" : undefined,
      ctx: { ...videoJob.ctx, requestId, endpoint: "/v1/video/generations", stream: false },
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }, finishedAt: new Date() });
    await this.p.billingReservation.updateMany({where:{requestId,status:"reserved"},data:{status:"pending",payload}});
    return this.finalize(requestId);
  }

  async finalize(requestId: string) {
    return this.p.$transaction(async tx=>{
      const first=await tx.billingReservation.findUniqueOrThrow({where:{requestId}});
      await this.lock(tx,first.userId,first.keyGroupId);
      await tx.$queryRaw`SELECT id FROM api_keys WHERE id = ${first.apiKeyId} FOR UPDATE`;
      const r=await tx.billingReservation.findUniqueOrThrow({where:{requestId}});
      if(r.status!=="pending") return r;
      const {ctx,usage,status,httpStatus,errorCode,finishedAt}=r.payload as any;
      const frozen=r.pricing as any;
      const isVideo = (r.payload as any).videoSettlement === true;
      let priced;
      try {
        priced = isVideo && status === "succeeded" ? videoSettlement(frozen.estimate, (r.payload as any).usageTokens)
          : calculateTokenPrice(frozen.alias,usage,frozen.planMultiplier,frozen.channelMultipliers[ctx.channelId]??1);
      } catch (error) {
        if (!isVideo) throw error;
        return tx.billingReservation.update({where:{requestId},data:{status:"review",reason:"missing_or_invalid_video_usage"}});
      }
      const unknown = !isVideo && (status === "succeeded" || errorCode === "transport_unknown" || errorCode === "stream_interrupted") && Object.values(usage).every(v=>v===0) && r.amount>0n;
      if(unknown) return tx.billingReservation.update({where:{requestId},data:{status:"review",reason:"missing_upstream_usage"}});
      // Failed calls are released only when the captured usage is zero.
      // Partial streams with reported usage remain billable, using the same tariff.
      const charge=priced.billableUnits;
      const key=await tx.apiKey.findUniqueOrThrow({where:{id:r.apiKeyId},include:{user:true,keyGroup:true}});
      const other=await tx.billingReservation.findMany({where:{requestId:{not:requestId},status:{in:HELD},OR:[{userId:r.userId},...(r.keyGroupId?[{keyGroupId:r.keyGroupId}]:[])]}});
      const finite=[key.user,key,key.keyGroup].filter((a):a is NonNullable<typeof a>=>!!a);
      const capacities=finite.map(a=>{
        const held=other.filter(x=>a===key.user?x.userId===r.userId:a===key?x.apiKeyId===r.apiKeyId:x.keyGroupId===r.keyGroupId).reduce((n,x)=>n+x.amount,0n);
        return a.quota<0n?charge:a.quota-a.usedQuota-held;
      });
      if(key.dailyLimit>=0n) {
        const start=new Date();start.setUTCHours(0,0,0,0);
        const spent=await tx.usageLedger.aggregate({where:{userId:r.userId,createdAt:{gte:start}},_sum:{billableUnits:true}});
        capacities.push(key.dailyLimit-(spent._sum.billableUnits??0n)-other.filter(x=>x.userId===r.userId).reduce((n,x)=>n+x.amount,0n));
      }
      if(charge>min(...capacities)) return tx.billingReservation.update({where:{requestId},data:{status:"review",reason:"actual_cost_exceeds_available_quota"}});
      const finished=new Date(finishedAt);
      await tx.requestLog.create({data:{requestId,userId:r.userId,apiKeyId:r.apiKeyId,endpoint:ctx.endpoint,requestedModel:ctx.model,actualUpstreamModel:ctx.upstreamModel,channelId:BigInt(ctx.channelId),nodeId:ctx.nodeId?BigInt(ctx.nodeId):null,stream:ctx.stream,status,httpStatus,errorCode:errorCode??null,inputTokens:usage.inputTokens,outputTokens:usage.outputTokens,cacheCreationTokens:usage.cacheCreationTokens,cacheReadTokens:usage.cacheReadTokens,billableUnits:charge,pricingDetail:json({...priced.detail,reservedUsd:Number(r.amount)/1e6,reviewedUsage:(r.payload as any)?.reviewedUsage??null}),startedAt:new Date(ctx.startedAt),finishedAt:finished,durationMs:finished.getTime()-new Date(ctx.startedAt).getTime()}});
      await tx.usageLedger.create({data:{requestId,userId:r.userId,apiKeyId:r.apiKeyId,channelId:BigInt(ctx.channelId),billingPeriod:finished.toISOString().slice(0,7).replace("-",""),billedRequests:1,inputTokens:usage.inputTokens,outputTokens:usage.outputTokens,cacheCreationTokens:usage.cacheCreationTokens,cacheReadTokens:usage.cacheReadTokens,billableUnits:charge,cost:priced.detail.costUsd,billingMultiplier:priced.detail.billingMultiplier,settlementStatus:"final"}});
      await tx.apiKey.update({where:{id:r.apiKeyId},data:{usedQuota:{increment:charge},usedCalls:{increment:1n},lastUsedAt:finished}});
      await tx.user.update({where:{id:r.userId},data:{usedQuota:{increment:charge},requestCount:{increment:1n}}});
      if(r.keyGroupId) await tx.keyGroup.update({where:{id:r.keyGroupId},data:{usedQuota:{increment:charge}}});
      return tx.billingReservation.update({where:{requestId},data:{status:charge>0n?"settled":"released",charged:charge,reason:null}});
    },{timeout:15000});
  }

  async resolveReview(requestId:string, action:"retry"|"release", reason:string, actorId:bigint) {
    await this.p.$transaction(async tx=>{
      const r=await tx.billingReservation.findUniqueOrThrow({where:{requestId}});
      await this.lock(tx,r.userId,r.keyGroupId);
      const current=await tx.billingReservation.findUniqueOrThrow({where:{requestId}});
      if(current.status!=="review") throw badRequest("Request is not awaiting review");
      let payload:any=current.payload;
      if(action==="retry" && (!payload?.ctx || !payload?.usage)) throw badRequest("No saved settlement result available; cannot retry settlement");
      if(action==="release") {
        const frozen=current.pricing as any;
        payload={...(payload??{}),ctx:payload?.ctx??{requestId,model:frozen.alias.alias,upstreamModel:frozen.alias.alias,channelId:Object.keys(frozen.channelMultipliers)[0],nodeId:null,endpoint:"/billing/review",startedAt:current.createdAt,stream:false},reviewedUsage:payload?.usage??null,usage:{inputTokens:0,outputTokens:0,cacheReadTokens:0,cacheCreationTokens:0},status:"failed",httpStatus:502,errorCode:"admin_release",finishedAt:new Date().toISOString()};
      }
      await tx.auditLog.create({data:{actorId,action:"billing_review_"+action,targetType:"billing_reservation",targetId:requestId,detail:json({reason,previousReason:current.reason,previousUsage:(current.payload as any)?.usage??null,amount:current.amount})}});
      await tx.billingReservation.update({where:{requestId},data:{status:"pending",payload,reason:null}});
    });
    return this.finalize(requestId);
  }

  async recover() {
    for(const r of await this.p.billingReservation.findMany({where:{status:"pending"},take:50,orderBy:{createdAt:"asc"}})) await this.finalize(r.requestId);
    // Upstream calls are bounded to < 15 minutes. Age marks uncertainty, not permission to refund.
    const stale = await this.p.billingReservation.findMany({where:{status:"reserved",createdAt:{lt:new Date(Date.now()-20*60*1000)}}});
    for (const r of stale) {
      const job = (r.payload as any)?.videoJob;
      if (job?.state === "running" && r.createdAt.getTime() > Date.now()-24*60*60*1000) continue;
      await this.p.billingReservation.updateMany({where:{requestId:r.requestId,status:"reserved",updatedAt:r.updatedAt},
        data:{status:"review",reason:job ? "video_task_requires_review" : "interrupted_before_usage_saved"}});
    }
  }

  async reconcile(userId: bigint) {
    return this.p.$transaction(async tx=>{
      await this.lock(tx,userId,null);
      const user=await tx.user.findUniqueOrThrow({where:{id:userId}});
      const reservations=await tx.billingReservation.findMany({where:{userId}});
      const keys=await tx.apiKey.findMany({where:{userId}});
      const groups=await tx.keyGroup.findMany({where:{userId}});
      const accounts=[];
      for(const [scope,list] of [["user",[user]],["key",keys],["group",groups]] as const) for(const a of list) {
        const baseline=await tx.billingBaseline.findUnique({where:{scope_accountId:{scope,accountId:a.id}}});
        const rows=reservations.filter(r=>scope==="user"|| (scope==="key"?r.apiKeyId===a.id:r.keyGroupId===a.id));
        const charged=rows.reduce((n,r)=>n+r.charged,0n),held=rows.filter(r=>HELD.includes(r.status)).reduce((n,r)=>n+r.amount,0n);
        const expected=(baseline?.openingUsed??a.usedQuota)+charged;
        accounts.push({scope,id:a.id,quota:a.quota,used:a.usedQuota,held,available:a.quota<0n?null:a.quota-a.usedQuota-held,expectedUsed:expected,difference:a.usedQuota-expected});
      }
      const ids=reservations.filter(r=>["settled","released"].includes(r.status)).map(r=>r.requestId);
      const ledgers=await tx.usageLedger.findMany({where:{requestId:{in:ids}}});
      const logs=await tx.requestLog.findMany({where:{requestId:{in:ids}}});
      const mismatches=reservations.filter(r=>ids.includes(r.requestId)).filter(r=>{const l=ledgers.filter(x=>x.requestId===r.requestId);const log=logs.find(x=>x.requestId===r.requestId);return l.length!==1||l[0].billableUnits!==r.charged||!log||log.billableUnits!==r.charged;}).map(r=>r.requestId);
      return {accounts,mismatches,balanced:accounts.every(a=>a.difference===0n)&&mismatches.length===0,reservations:reservations.filter(r=>HELD.includes(r.status)).map(({requestId,amount,status,reason,createdAt})=>({requestId,amount,status,reason,createdAt})),history:"Historical balances are opening baselines, not proof of historical ledger completeness."};
    },{timeout:15000});
  }
}
