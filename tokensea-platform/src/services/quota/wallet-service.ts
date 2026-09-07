import type { Prisma,PrismaClient } from '@prisma/client';
import { badRequest } from '../../lib/errors.js';
export async function walletChange(tx:Prisma.TransactionClient,userId:bigint,delta:bigint,reference:string,kind:string,reason:string,actorId?:bigint){
 await tx.$queryRaw`SELECT id FROM users WHERE id=${userId} FOR UPDATE`;
 const old=await tx.walletEntry.findUnique({where:{reference}});
 if(old){if(old.userId!==userId||old.delta!==delta)throw badRequest('钱包流水标识冲突');return old;}
 const user=await tx.user.findUniqueOrThrow({where:{id:userId}});
 if(user.quota<0n)throw badRequest('无限额度账户不支持充值或扣减');
 const holds=await tx.billingReservation.aggregate({where:{userId,status:{in:['reserved','pending','review']}},_sum:{amount:true}});
 if(delta<0n&&user.quota+delta-user.usedQuota-(holds._sum.amount??0n)<0n)throw badRequest('可用余额不足，不能扣减已消费或冻结的金额');
 const after=user.quota+delta;
 await tx.user.update({where:{id:userId},data:{quota:after}});
 return tx.walletEntry.create({data:{userId,reference,kind,delta,before:user.quota,after,reason,actorId}});
}
export class WalletService {
 constructor(private p:PrismaClient){}
 async summary(userId:bigint){return this.p.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM users WHERE id=${userId} FOR UPDATE`;
  const user=await tx.user.findUniqueOrThrow({where:{id:userId}});
  const held=await tx.billingReservation.aggregate({where:{userId,status:{in:['reserved','pending','review']}},_sum:{amount:true}});
  const entries=await tx.walletEntry.findMany({where:{userId},orderBy:{id:'asc'}});
  const opening=entries[0]?.before??user.quota;
  const expected=opening+entries.reduce((n,e)=>n+e.delta,0n);
  const chainOk=entries.every((e,i)=>e.after===e.before+e.delta&&(i===0||e.before===entries[i-1].after));
  return {currency:'USD',unit:'micro-usd',total:user.quota,used:user.usedQuota,held:held._sum.amount??0n,
   available:user.quota<0n?null:user.quota-user.usedQuota-(held._sum.amount??0n),opening,expectedTotal:expected,balanced:chainOk&&expected===user.quota,
   history:'历史余额作为期初余额；流水仅覆盖启用之后的变动。'};
 });}
 async entries(userId:bigint,page=1){return this.p.walletEntry.findMany({where:{userId},orderBy:{id:'desc'},skip:(page-1)*20,take:20});}
}
