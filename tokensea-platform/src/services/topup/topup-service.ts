import type { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import Stripe from 'stripe';
import type { Env } from '../../config/env.js';
import { badRequest,notFound } from '../../lib/errors.js';
import { paymentQuote,PAYMENT_UNIT_VERSION } from './money.js';
import { walletChange } from '../quota/wallet-service.js';
export function validatePaidSession(order:any,session:any){
 if(order.unitVersion!==PAYMENT_UNIT_VERSION)throw badRequest('历史订单需人工核对，禁止自动换算入账');
 if(session.payment_status!=='paid')throw badRequest('支付尚未确认');
 if(session.metadata?.orderId!==order.id.toString()||session.metadata?.tradeNo!==order.tradeNo||session.metadata?.unitVersion!==PAYMENT_UNIT_VERSION
  ||session.currency!==order.currency||session.amount_total!==order.paymentMinor
  ||(order.checkoutId&&session.id!==order.checkoutId))throw badRequest('支付订单或金额不匹配');
 if(!session.payment_intent||typeof session.payment_intent!=='string')throw badRequest('缺少支付流水号');
}
export class TopupService {
 private stripe:Stripe|null;
 constructor(private p:PrismaClient,private env:Env){this.stripe=env.STRIPE_SECRET_KEY?new Stripe(env.STRIPE_SECRET_KEY):null;}
 methods(){return {enabled:this.env.PAYMENTS_ENABLED==='true',currency:'CNY',ledgerCurrency:'USD',methods:[
  {id:'alipay',name:'支付宝',enabled:false,reason:'尚未配置商户'},
  {id:'wechat',name:'微信支付',enabled:false,reason:'尚未配置商户'},
  {id:'stripe',name:'Stripe',enabled:this.env.PAYMENTS_ENABLED==='true'&&!!this.stripe&&!!this.env.STRIPE_WEBHOOK_SECRET,reason:'需启用支付并配置商户及回调'},
 ]};}
 async createOrder(userId:bigint,method:string,amount:number,idempotencyKey:string){
  if(!this.methods().methods.some(m=>m.id===method&&m.enabled))throw badRequest('该支付方式尚未开放，未创建订单');
  if(!/^[a-zA-Z0-9_-]{16,64}$/.test(idempotencyKey))throw badRequest('缺少有效的幂等标识');
  const quote=paymentQuote(amount);
  const order=await this.p.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM users WHERE id=${userId} FOR UPDATE`;
   const user=await tx.user.findUniqueOrThrow({where:{id:userId}});
   if(user.status!=='active'||user.quota<0n)throw badRequest('该账户不支持充值');
   const existing=await tx.topUpOrder.findUnique({where:{userId_idempotencyKey:{userId,idempotencyKey}}});
   if(existing){if(existing.paymentMethod!==method||existing.paymentMinor!==quote.paymentMinor)throw badRequest('重复下单参数不一致');return existing;}
   if(await tx.topUpOrder.count({where:{userId,status:'pending',createdAt:{gte:new Date(Date.now()-3600000)}}})>=5)throw badRequest('待支付订单过多，请先处理已有订单');
   return tx.topUpOrder.create({data:{userId,tradeNo:'TS'+Date.now()+randomBytes(4).toString('hex'),paymentMethod:method,idempotencyKey,...quote,expiresAt:new Date(Date.now()+3600000)}});
  });
  if(order.status!=='pending'||order.checkoutUrl)return {order,checkoutUrl:order.status==='pending'?order.checkoutUrl:null};
  if(order.expiresAt&&order.expiresAt<=new Date())throw badRequest('订单已过期，请刷新订单状态');
  // Leave ambiguous upstream failures pending. Retrying reuses gateway idempotency.
  const session=await this.stripe!.checkout.sessions.create({mode:'payment',expires_at:Math.floor(order.expiresAt!.getTime()/1000),
   metadata:{orderId:order.id.toString(),tradeNo:order.tradeNo,unitVersion:PAYMENT_UNIT_VERSION},
   line_items:[{price_data:{currency:order.currency,product_data:{name:'TokenSea 钱包充值'},unit_amount:order.paymentMinor!},quantity:1}],
   success_url:this.env.FRONTEND_URL+'/app/topup?status=returned',cancel_url:this.env.FRONTEND_URL+'/app/topup?status=cancelled',
  },{idempotencyKey:order.tradeNo});
  await this.p.topUpOrder.updateMany({where:{id:order.id,status:'pending'},data:{checkoutId:session.id,checkoutUrl:session.url}});
  return {order:await this.p.topUpOrder.findUniqueOrThrow({where:{id:order.id}}),checkoutUrl:session.url};
 }
 async handleStripeWebhook(raw:string|Buffer,sig:string){
  if(!this.stripe||!this.env.STRIPE_WEBHOOK_SECRET)throw badRequest('Stripe 未配置');
  let event:Stripe.Event;
  try{event=this.stripe.webhooks.constructEvent(raw,sig,this.env.STRIPE_WEBHOOK_SECRET);}catch{throw badRequest('支付通知签名无效');}
  if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)){
   const s=event.data.object as Stripe.Checkout.Session;if(s.payment_status==='paid')await this.fulfillSession(s);
  }
  return {received:true};
 }
 async fulfillSession(session:Stripe.Checkout.Session){
  const id=session.metadata?.orderId;if(!id||!/^\d+$/.test(id))throw badRequest('缺少订单标识');
  return this.p.$transaction(async tx=>{
   const initial=await tx.topUpOrder.findUniqueOrThrow({where:{id:BigInt(id)}});
   await tx.$queryRaw`SELECT id FROM users WHERE id=${initial.userId} FOR UPDATE`;
   await tx.$queryRaw`SELECT id FROM top_up_orders WHERE id=${initial.id} FOR UPDATE`;
   const order=await tx.topUpOrder.findUniqueOrThrow({where:{id:initial.id}});validatePaidSession(order,session);
   if(order.status==='success')return order;
   if(order.status!=='pending')throw badRequest('订单状态异常，需人工核对');
   await walletChange(tx,order.userId,order.amount,'topup:'+order.id,'topup','支付确认到账');
   return tx.topUpOrder.update({where:{id:order.id},data:{status:'success',paidAt:new Date(),checkoutId:session.id,gatewayTradeNo:session.payment_intent as string}});
  });
 }
 async refreshOrder(userId:bigint,id:bigint){
  const order=await this.getOrder(userId,id);
  if(order.unitVersion!==PAYMENT_UNIT_VERSION||order.status!=='pending'||!order.checkoutId||!this.stripe)return order;
  const session=await this.stripe.checkout.sessions.retrieve(order.checkoutId);
  if(session.payment_status==='paid')await this.fulfillSession(session);
  else if(session.status==='expired')await this.p.topUpOrder.updateMany({where:{id,status:'pending'},data:{status:'failed'}});
  return this.getOrder(userId,id);
 }
 async recover(){
  if(!this.stripe)return;
  for(const order of await this.p.topUpOrder.findMany({where:{unitVersion:PAYMENT_UNIT_VERSION,status:'pending',checkoutId:{not:null}},take:50,orderBy:{updatedAt:'asc'}})){
   try{await this.refreshOrder(order.userId,order.id);}catch{/* Never infer payment from timeout. */}
  }
 }
 async listOrders(userId:bigint,page=1,pageSize=20){const [items,total]=await Promise.all([this.p.topUpOrder.findMany({where:{userId},orderBy:{createdAt:'desc'},skip:(page-1)*pageSize,take:pageSize}),this.p.topUpOrder.count({where:{userId}})]);return {items,total,page,pageSize};}
 async getOrder(userId:bigint,id:bigint){const o=await this.p.topUpOrder.findFirst({where:{id,userId}});if(!o)throw notFound('订单不存在');return o;}
}
