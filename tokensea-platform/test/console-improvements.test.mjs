import { test } from "node:test";
import assert from "node:assert/strict";
import { timeRange, qualityStats } from "../src/services/log/statistics.ts";
import { ipAllowed, validIpRule } from "../src/lib/ip-policy.ts";
import { openAiUsage, calculateTokenPrice } from "../src/services/billing/token-pricing.ts";
import { REVIEWED_OPENAI_MODELS } from "../src/config/reviewed-openai-models.ts";
import { csvCell, safeErrorCode } from "../src/services/log/request-detail.ts";
import { quotaWindows } from "../src/services/channel/operations-service.ts";
import { LogService } from "../src/services/log/log-service.ts";
import { RelayService } from "../src/services/relay/relay-service.ts";

test("fixed month is bounded, inclusive date end becomes exclusive next day", () => {
  const r=timeRange("202608");
  assert.equal(r.gte.toISOString(),"2026-08-01T00:00:00.000Z");
  assert.equal(r.lt.toISOString(),"2026-09-01T00:00:00.000Z");
  assert.equal(timeRange("7d","2026-08-01","2026-08-02").lt.toISOString(),"2026-08-03T00:00:00.000Z");
  assert.throws(()=>timeRange("invalid")); assert.throws(()=>timeRange("30d","2026-09-05","2026-01-01"));
});
test("quality uses all requests, excludes absent/failed latency, reports actual nearest-rank P95", () => {
  const rows=Array.from({length:20},(_,i)=>({status:"succeeded",durationMs:(i+1)*100,httpStatus:200}));
  rows.push({status:"failed",durationMs:99999,httpStatus:429});
  const q=qualityStats(rows);
  assert.equal(q.p95LatencyMs,1900);assert.equal(q.avgLatencyMs,1050);
  assert.equal(q.successRate,20/21*100);assert.equal(q.rateLimited,1);
  assert.equal(qualityStats([]).successRate,null);
  assert.equal(qualityStats([{status:"succeeded",durationMs:null,httpStatus:200}]).avgLatencyMs,null);
});
test("IPv4, mapped IPv4, IPv6 and CIDR policies fail closed",()=>{
  assert(validIpRule("2001:db8::/32"));assert(!validIpRule("10.0.0.0/33"));assert(!validIpRule("0.0.0.0/-1"));assert(!validIpRule("localhost"));
  assert(ipAllowed("::ffff:203.0.113.5",["203.0.113.0/24"]));
  assert(!ipAllowed("203.0.114.5",["203.0.113.0/24"]));
  assert(ipAllowed("2001:db8::5",["2001:db8::/32"]));
  assert(!ipAllowed("10.0.0.1",["invalid"]));
});
test("OpenAI cache tokens are not charged twice; Responses usage supported",()=>{
  const u=openAiUsage({input_tokens:1000,output_tokens:100,input_tokens_details:{cached_tokens:800}});
  assert.equal(u.inputTokens,200);assert.equal(u.cacheReadTokens,800);
  const p=calculateTokenPrice(REVIEWED_OPENAI_MODELS[0],u);
  assert.equal(p.billableUnits,7800n);
});
test("Astra long-context whole-request threshold and multipliers",()=>{
  const p=calculateTokenPrice(REVIEWED_OPENAI_MODELS[0],{inputTokens:272001,outputTokens:1000,cacheReadTokens:0,cacheCreationTokens:0},2,1.5);
  assert.equal(p.detail.inputPrice,20);assert.equal(p.detail.outputPrice,75);
  assert.equal(p.detail.billingMultiplier,3);assert.equal(p.billableUnits,16545060n);
  assert.equal(calculateTokenPrice(REVIEWED_OPENAI_MODELS[0],{inputTokens:272000,outputTokens:0,cacheReadTokens:0,cacheCreationTokens:0}).detail.longContext,false);
});
test("Image2 native usage bills text, image input and image output separately",()=>{
  const u=openAiUsage({input_tokens:1014,input_tokens_details:{image_tokens:1000,text_tokens:14},output_tokens:229});
  const p=calculateTokenPrice(REVIEWED_OPENAI_MODELS[1],u);
  assert.equal(p.billableUnits,14940n);assert.equal(p.detail.imageInputCostUsd,.008);
  const actual=openAiUsage({input_tokens:14,input_tokens_details:{image_tokens:0,text_tokens:14},output_tokens:229});
  assert.equal(calculateTokenPrice(REVIEWED_OPENAI_MODELS[1],actual).billableUnits,6940n);
});
test("CSV protects formulas and quotes; error codes never contain raw upstream secrets",()=>{
  assert.equal(csvCell('=HYPERLINK("bad")'),'"\'=HYPERLINK(""bad"")"');
  assert.equal(safeErrorCode('{"error":{"code":"insufficient_quota","message":"secret"}}',429),"insufficient_quota");
  assert.equal(safeErrorCode('{"error":{"code":"Bearer secret key"}}',500),"upstream_500");
});
test("unknown quota is not zero or 100%; percentages stay bounded",()=>{
  assert.deepEqual(quotaWindows({}),[]);
  const q=quotaWindows({rate_limit:{primary_window:{used_percent:97,reset_at:123},secondary_window:{used_percent:null}}});
  assert.equal(q[0].remainingPercent,3);assert.equal(q[1].remainingPercent,null);
});
test("request detail is owner-scoped and strips infrastructure IDs",async()=>{
  const svc=new LogService({requestLog:{findFirst:async({where})=>{
    assert.deepEqual(where,{requestId:"request",userId:7n});
    return {requestId:"request",nodeId:3n,channelId:2n,status:"succeeded",billableUnits:0n};
  }}});
  const d=await svc.requestDetail(7n,"request");assert(!("nodeId" in d));assert(!("channelId" in d));
  await assert.rejects(()=>new LogService({requestLog:{findFirst:async()=>null}}).requestDetail(8n,"request"),/not found/);
});
test("zero key quota blocks; -1 is unlimited",async()=>{
  const svc=new RelayService({}, {get:async()=>null});
  await assert.rejects(()=>svc.checkQuota({user:{quota:-1n},quota:0n,usedQuota:0n}),/quota exhausted/);
  await svc.checkQuota({user:{quota:-1n},quota:-1n,maxCalls:-1n,dailyLimit:-1n});
});
test("fragment-safe SSE parser recognizes cumulative Responses usage",()=>{
  const svc=new RelayService({},{});
  const u=svc.extractTokensFromSSE('data: {"type":"response.completed","response":{"usage":{"input_tokens":100,"output_tokens":9,"input_tokens_details":{"cached_tokens":70}}}}\n',"openai");
  assert.equal(u.inputTokens,30);assert.equal(u.cacheReadTokens,70);assert.equal(u.outputTokens,9);
});
