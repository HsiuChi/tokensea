import type {PrismaClient} from '@prisma/client';
import type Redis from 'ioredis';
import type {Env} from '../../config/env.js';
import {randomUUID} from 'node:crypto';
import {OperationsService} from './operations-service.js';
import {TopupService} from '../topup/topup-service.js';
import {SubscriptionService} from '../subscription/subscription-service.js';
import {deliverPending} from '../notify/delivery-worker.js';
export function startOperationsWorker(p:PrismaClient,r:Redis,env:Env,log:{error:Function}){
 let stopped=false;const running=new Set<Promise<unknown>>();
 const run=(name:string,ttl:number,fn:()=>Promise<unknown>)=>{
  if(stopped)return;
  const promise=(async()=>{const token=randomUUID(),key='worker:'+name;
   if(!await r.set(key,token,'EX',ttl,'NX'))return;
   try{await fn();}finally{await r.eval("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0",1,key,token);}
  })().catch(()=>log.error({worker:name},'Operations worker failed; retry on next interval'));
  running.add(promise);void promise.finally(()=>running.delete(promise));
 };
 const quota=()=>run('account-quota',600,async()=>{await new OperationsService(p,r).overview();});
 const delivery=()=>run('webhook-delivery',90,()=>deliverPending(p));
 const orders=()=>run('payment-reconcile',120,async()=>{await new TopupService(p,env).recover();await new SubscriptionService(p).expireSubscriptions();});
 const timers=[setInterval(quota,300000),setInterval(delivery,15000),setInterval(orders,60000)];
 timers.forEach(t=>t.unref());quota();delivery();orders();
 return {stop:async()=>{stopped=true;timers.forEach(clearInterval);await Promise.allSettled([...running]);}};
}
