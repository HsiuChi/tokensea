import test from 'node:test';
import assert from 'node:assert/strict';
import {paymentQuote,PAYMENT_UNIT_VERSION} from '../src/services/topup/money.ts';
import {TopupService,validatePaidSession} from '../src/services/topup/topup-service.ts';
import {SubscriptionService} from '../src/services/subscription/subscription-service.ts';
import {tokenBudget,checkPlanModel} from '../src/services/relay/admission.ts';
test('RMB quote credits exact charged USD cents in micro-USD',()=>{
 const q=paymentQuote(7.2);assert.equal(q.paymentMinor,100);assert.equal(q.amount,1000000n);
 assert.equal(paymentQuote(50).amount,6940000n);
 for(const n of [0,-1,.1,NaN,Infinity,10001,1.001])assert.throws(()=>paymentQuote(n));
});
test('closed payment methods reject before any DB write',async()=>{
 const svc=new TopupService({},{});
 for(const m of ['stripe','alipay','wechat','paypal'])await assert.rejects(svc.createOrder(1n,m,50,'test-000000000000'),/尚未开放/);
 assert(svc.methods().methods.every(m=>!m.enabled));
});
test('all subscription purchase paths fail closed before grants',async()=>{
 const svc=new SubscriptionService({});
 for(const m of ['balance','stripe','alipay','wechat']){
  await assert.rejects(svc.subscribe(1n,1n,m),/暂未开放/);await assert.rejects(svc.renew(1n,1n,m),/暂未开放/);
 }
});
test('payment confirmation validates version, amount, currency and paid state',()=>{
 const order={id:1n,tradeNo:'test',unitVersion:PAYMENT_UNIT_VERSION,paymentMinor:100,currency:'usd',checkoutId:'cs_test'};
 const s={id:'cs_test',payment_status:'paid',currency:'usd',amount_total:100,payment_intent:'pi_test',metadata:{orderId:'1',tradeNo:'test',unitVersion:PAYMENT_UNIT_VERSION}};
 validatePaidSession(order,s);
 for(const patch of [{payment_status:'unpaid'},{currency:'cny'},{amount_total:99},{id:'other'},{metadata:{}},{payment_intent:null}])assert.throws(()=>validatePaidSession(order,{...s,...patch}));
 assert.throws(()=>validatePaidSession({...order,unitVersion:'legacy'},s));
});
test('TPM admission bounds input bytes and output reservation',()=>{
 assert(tokenBudget({messages:[{content:'中文'}],max_tokens:100})>100);
 assert.throws(()=>tokenBudget({max_tokens:-1}));
 checkPlanModel({allowedModelAliases:[]},'a');
 assert.throws(()=>checkPlanModel({allowedModelAliases:['a']},'b'));
});
