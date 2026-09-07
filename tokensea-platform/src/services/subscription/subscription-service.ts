import type { PrismaClient } from '@prisma/client';
import { badRequest,notFound,forbidden } from '../../lib/errors.js';
export class SubscriptionService {
 constructor(private prisma:PrismaClient){}
 // Fail closed until entitlement accounting and payment-confirmed fulfillment exist.
 async subscribe(_userId:bigint,_planId:bigint,_paymentMethod='balance',_durationDays=30){throw badRequest('套餐购买暂未开放；不会扣款或发放额度');}
 async renew(_userId:bigint,_bindingId:bigint,_paymentMethod='balance'){throw badRequest('套餐续费暂未开放；不会扣款或发放额度');}
 async cancel(userId:bigint,bindingId:bigint){
  const b=await this.prisma.userPlanBinding.findUnique({where:{id:bindingId}});
  if(!b)throw notFound('Subscription not found');if(b.userId!==userId)throw forbidden('Not your subscription');
  return this.prisma.userPlanBinding.update({where:{id:bindingId},data:{autoRenew:false,cancelledAt:new Date()}});
 }
 async expireSubscriptions(){
  // Never remove historical wallet credits or disable unrelated keys automatically.
  const result=await this.prisma.userPlanBinding.updateMany({where:{status:'active',endAt:{lte:new Date()}},data:{status:'expired',autoRenew:false}});
  return {expired:result.count};
 }
 async listSubscriptions(userId:bigint){return this.prisma.userPlanBinding.findMany({where:{userId},include:{plan:{select:{id:true,name:true,displayName:true,tier:true}}},orderBy:{createdAt:'desc'}});}
 async listOrders(userId:bigint,page=1,pageSize=20){
  const [items,total]=await Promise.all([this.prisma.subscriptionOrder.findMany({where:{userId},orderBy:{createdAt:'desc'},skip:(page-1)*pageSize,take:pageSize}),this.prisma.subscriptionOrder.count({where:{userId}})]);
  return {items,total,page,pageSize};
 }
}
