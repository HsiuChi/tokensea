import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteReservation } from '../src/services/billing/reservation-estimate.ts';
import { quoteVideo, videoSettlement } from '../src/services/billing/video-pricing.ts';
import { REVIEWED_OPENAI_MODELS } from '../src/config/reviewed-openai-models.ts';
import { videoRequestHash } from '../src/services/billing/video-task-service.ts';
const image=REVIEWED_OPENAI_MODELS.find(m=>m.alias==='gpt-image-2');
const text=REVIEWED_OPENAI_MODELS.find(m=>m.alias==='gpt-6-astra');
test('Image2 hold follows quality, dimensions, count and configured multipliers, not 65536 tokens',()=>{
  const low=quoteReservation(image,{prompt:'a boat',size:'1024x1024',quality:'low'},1,1.5,true);
  const high=quoteReservation(image,{prompt:'a boat',size:'1024x1024',quality:'high'},1,1.5,true);
  assert(low.amount<20000n); assert(high.amount>low.amount*10n);
  assert.equal(quoteReservation(image,{prompt:'a boat',size:'1024x1024',quality:'low',n:2},1,1.5,true).detail.usage.outputTokens,low.detail.usage.outputTokens*2);
  assert(quoteReservation(image,{quality:'high',size:'1536x1024'},1,1,true).amount<quoteReservation(image,{quality:'high',size:'1024x1024'},1,1,true).amount);
  assert(quoteReservation(image,{quality:'low',size:'2048x2048'},1,1,true).amount>low.amount);
  assert.throws(()=>quoteReservation(image,{quality:'invalid'},1,1,true));
  assert.throws(()=>quoteReservation(image,{n:0},1,1,true));
  assert(quoteReservation(image,{},1,1,true).detail.assumptions.some(s=>s.includes('Auto quality')));
});
test('text reserves actual prompt and requested output cap; image references exclude base64 payload bytes',()=>{
  const short=quoteReservation(text,{messages:[{role:'user',content:'hello'}],max_tokens:100});
  assert(short.detail.usage.inputTokens<1000);
  assert.equal(short.detail.usage.outputTokens,100);
  assert(quoteReservation(text,{prompt:'a'.repeat(2000),max_tokens:100}).amount>short.amount);
  const withImage=data=>quoteReservation(text,{messages:[{role:'user',content:[{type:'image_url',image_url:{url:data}}]}],max_tokens:100});
  assert.equal(withImage('data:image/png;base64,'+'A'.repeat(20000)).amount,withImage('https://example.com/a.png').amount);
  assert.equal(withImage('https://example.com/a.png').detail.usage.imageInputTokens,4096);
  assert(quoteReservation(image,{images:[{type:'input_image'},{type:'input_image'}],quality:'low'},1,1,true).amount>quoteReservation(image,{quality:'low'},1,1,true).amount);
  assert.throws(()=>quoteReservation(text,{max_tokens:1.5}));
});
test('Kling and Hailuo quotes use exact verified CNY tiers, not text rates',()=>{
  const k=quoteVideo('kling-v3',{duration:5,mode:'std',sound:'on'},7.2,1,1.5);
  assert.equal(k.detail.baseCny,4.5);assert.equal(k.amount,937500n);
  assert.equal(videoSettlement(k.detail).billableUnits,k.amount);
  assert.equal(quoteVideo('kling-v3-omni',{duration:5,mode:'std',sound:'on'},7.2).detail.baseCny,4);
  assert.equal(quoteVideo('hailuo-2.3-fast',{duration:6,resolution:'1080P',first_frame_image:'https://example.com/x'},7.2).detail.baseCny,2.31);
  assert.throws(()=>quoteVideo('hailuo-2.3',{duration:10,resolution:'1080P'},7.2));
  assert.throws(()=>quoteVideo('kling-v3',{voice_id:'unknown'},7.2));
  assert.throws(()=>quoteVideo('hailuo-2.3-fast',{},7.2));
  assert.throws(()=>quoteVideo('hailuo-02',{duration:6,resolution:'512P'},7.2),/first-frame/);
  assert.equal(quoteVideo('hailuo-02',{duration:6,resolution:'512P',first_frame_image:'https://example.com/x.png'},7.2).detail.baseCny,0.6);
});
test('Seedance reserves an estimate but settles reported tokens; unreviewed variants fail individually',()=>{
  const body={content:[{type:'text',text:'sea'}],duration:5,resolution:'720p'};
  const q=quoteVideo('seedance-2.0-domestic',body,7.2);
  assert.equal(q.detail.rateCny,46);
  assert(videoSettlement(q.detail,108000).billableUnits<q.amount);
  assert.throws(()=>videoSettlement(q.detail,0));
  assert.throws(()=>videoSettlement(q.detail,-10));
  assert.throws(()=>quoteVideo('seedance-2.0-o',body,7.2));
  assert.throws(()=>quoteVideo('seedance-2.5',{...body,content:[{type:'video_url'}]},7.2));
  assert.throws(()=>quoteVideo('seedance-2.5',body,0));
});
test('video idempotency fingerprint is key-order independent but parameter sensitive',()=>{
  assert.equal(videoRequestHash('kling-v3',{duration:5,mode:'std'}),videoRequestHash('kling-v3',{mode:'std',duration:5}));
  assert.notEqual(videoRequestHash('kling-v3',{duration:5}),videoRequestHash('kling-v3',{duration:10}));
});
