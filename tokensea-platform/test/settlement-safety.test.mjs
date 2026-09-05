import test from 'node:test';
import assert from 'node:assert/strict';
import {RelayService} from '../src/services/relay/relay-service.ts';

function fixture({writeFails=false}={}) {
  const row={status:'reserved'},writes=[];
  const prisma={billingReservation:{
    findUnique:async()=>row,
    updateMany:async({where,data})=>{
      writes.push(data);
      if(writeFails)throw Error('database unavailable');
      if(where.status!==row.status)return {count:0};
      Object.assign(row,data);return {count:1};
    },
  }};
  const svc=new RelayService(prisma,{set:async()=>{}});
  svc.resolveApiKey=async()=>({id:1n,userId:1n,user:{status:'active'},models:[]});
  svc.checkQuota=svc.checkRateLimit=svc.reserveQuota=async()=>{};
  svc.resolveRoute=async()=>({alias:{},routes:[{channelId:1n,upstreamModel:'fixture'}]});
  svc.resolveChannels=async()=>[{id:1n,status:'active',priority:1,weight:1,billingMultiplier:1,
    retryPolicy:{rules:[{status:400,action:'continue'},{status:502,action:'continue'}]}}];
  const nodes=[1n,2n].map(id=>({id,channelId:1n,status:'healthy',internalUrl:'https://fixture.invalid',internalApiKey:'test-only',adapter:'cpa'}));
  svc.getHealthyNodesForChannels=async()=>nodes;
  svc.selectNodeFromPool=(pool,tried)=>pool.find(n=>!tried.has(n.id.toString()));
  return {svc,row,writes};
}
for(const endpoint of ['chat','stream','image','edit']) {
  for(const writeFails of [false,true]) test(endpoint+': invalid usage / persistence failure never becomes zero-charge fallback ('+writeFails+')',async()=>{
    const {svc,row,writes}=fixture({writeFails});
    let calls=0;
    const old=globalThis.fetch;
    globalThis.fetch=async()=>{
      calls++;
      if(endpoint==='stream')return new Response('data: {"usage":{"prompt_tokens":1,"completion_tokens":0.5}}\n\ndata: [DONE]\n\n');
      return Response.json({data:[{b64_json:'fixture'}],usage:{prompt_tokens:1,input_tokens:1,completion_tokens:0.5,output_tokens:0.5}});
    };
    const request={url:'/v1/chat/completions',headers:{},query:{},body:{model:'fixture',messages:[],stream:endpoint==='stream'},log:{error(){},warn(){}}};
    const reply={code(){return this},header(){return this},send(){return this},raw:{writeHead(){},write(){},end(){}}};
    if(endpoint==='edit')request.parts=async function*(){yield {type:'field',fieldname:'model',value:'fixture'};};
    try {
      const invoke=()=>endpoint==='image'?svc.handleImageGeneration(request,reply):endpoint==='edit'?svc.handleImageEdit(request,reply):svc.handleRequest(request,reply);
      await assert.rejects(invoke(),e=>e.code==='BILLING_REVIEW_REQUIRED');
      assert.equal(calls,1,'even a continue retry policy cannot replay accepted generation');
      assert.equal(row.status,writeFails?'reserved':'review');
      assert(!writes.some(w=>w.payload?.status==='failed'),'never persist zero-usage failed settlement');
    } finally {globalThis.fetch=old;}
  });
}
test('accepted but malformed JSON retains hold without failover',async()=>{
  const {svc,row}=fixture();let calls=0;const old=globalThis.fetch;
  globalThis.fetch=async()=>{calls++;return new Response('not JSON',{status:200});};
  try{
    await assert.rejects(svc.handleRequest({url:'/v1/chat/completions',headers:{},query:{},body:{model:'fixture',messages:[]},log:{error(){},warn(){}}},{}),e=>e.code==='BILLING_REVIEW_REQUIRED');
    assert.equal(calls,1);assert.equal(row.status,'review');assert.equal(row.reason,'accepted_result_unavailable');
  }finally{globalThis.fetch=old;}
});
test('valid usage save failure retains hold and cannot be replayed',async()=>{
  const {svc,row,writes}=fixture({writeFails:true});let calls=0;const old=globalThis.fetch;
  globalThis.fetch=async()=>{calls++;return Response.json({usage:{prompt_tokens:1,completion_tokens:1}});};
  try{
    await assert.rejects(svc.handleRequest({url:'/v1/chat/completions',headers:{},query:{},body:{model:'fixture',messages:[]},log:{error(){},warn(){}}},{}),e=>e.code==='BILLING_REVIEW_REQUIRED');
    assert.equal(calls,1);assert.equal(row.status,'reserved');
    assert.equal(writes.length,1);assert.equal(writes[0].payload.status,'succeeded');
  }finally{globalThis.fetch=old;}
});
