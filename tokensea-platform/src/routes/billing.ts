import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { userAuthHook, adminAuthHook } from "../middleware/user-auth.js";
import { ReservationService } from "../services/billing/reservation-service.js";
import { quoteReservation } from "../services/billing/reservation-estimate.js";
import { VideoTaskService } from '../services/billing/video-task-service.js';
import { badRequest, forbidden, notFound } from "../lib/errors.js";

export async function billingRoutes(app: FastifyInstance) {
  const billing=new ReservationService(app.prisma);
  app.get('/video-tasks',{preHandler:userAuthHook},async request=>{
    const user=await app.prisma.user.findUnique({where:{id:request.userId!}});
    if(!user||user.status!=='active') throw forbidden('Account is disabled');
    return {data:await new VideoTaskService(app.prisma).list(user.id)};
  });
  app.post("/estimate",{preHandler:userAuthHook},async request=>{
    const {apiKeyId,model,parameters}=z.object({apiKeyId:z.coerce.bigint().positive(),model:z.string().min(1).max(64),parameters:z.record(z.any()).default({})}).parse(request.body);
    const key=await app.prisma.apiKey.findFirst({where:{id:apiKeyId,userId:request.userId!,deletedAt:null,status:"active"},include:{plan:true,keyGroup:true}});
    if(!key) throw notFound("API key not found");
    if((key.expiresAt && key.expiresAt<=new Date()) || (key.keyGroup && key.keyGroup.status!=="active")) throw forbidden("API key or group unavailable");
    for(const models of [key.models,key.keyGroup?.models]) if(Array.isArray(models)&&models.length&&!models.includes(model)) throw forbidden("Model not allowed on this key");
    const alias=await app.prisma.modelAlias.findFirst({where:{alias:model,status:"active"},include:{routes:{where:{status:"active",channel:{status:"active"}},include:{channel:true}}}});
    if(!alias?.routes.length) throw badRequest("No active route for this model");
    const multiplier=Math.max(...alias.routes.map(r=>r.channel.billingMultiplier));
    const quote=quoteReservation(alias,parameters,key.plan?.billingMultiplier??1,multiplier,alias.category==="image");
    return {data:{amount:quote.amount,...quote.detail,notice:"估算不冻结余额；实际提交时按当时的价格、路由和余额重新校验。"}};
  });
  app.get("/self",{preHandler:userAuthHook},async request=>({data:await billing.reconcile(request.userId!)}));
  app.get("/reconcile/:userId",{preHandler:adminAuthHook},async request=>{
    const {userId}=z.object({userId:z.coerce.bigint().positive()}).parse(request.params);
    return {data:await billing.reconcile(userId)};
  });
  app.post("/review/:requestId",{preHandler:adminAuthHook},async request=>{
    const {requestId}=z.object({requestId:z.string().uuid()}).parse(request.params);
    const {action,reason}=z.object({action:z.enum(["retry","release"]),reason:z.string().trim().min(8).max(500)}).parse(request.body);
    const r=await billing.resolveReview(requestId,action,reason,request.userId!);
    return {data:{requestId:r.requestId,status:r.status,charged:r.charged}};
  });
  app.get("/pending",{preHandler:adminAuthHook},async()=>({data:await app.prisma.billingReservation.findMany({where:{status:{in:["reserved","pending","review"]}},select:{requestId:true,userId:true,apiKeyId:true,amount:true,status:true,reason:true,createdAt:true},orderBy:{createdAt:"asc"},take:100})}));
}
