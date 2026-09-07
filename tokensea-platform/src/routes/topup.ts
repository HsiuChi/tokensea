import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { TopupService } from "../services/topup/topup-service.js";
import { userAuthHook } from "../middleware/user-auth.js";
import { WalletService } from '../services/quota/wallet-service.js';

export async function topupRoutes(app: FastifyInstance) {
  const topupService = new TopupService(app.prisma, app.env);
  const wallet=new WalletService(app.prisma);
  app.get('/methods',async()=>({data:topupService.methods()}));
  app.get('/wallet',{preHandler:userAuthHook},async request=>({data:await wallet.summary(request.userId!)}));
  app.get('/wallet/entries',{preHandler:userAuthHook},async request=>{
    const q=z.object({page:z.coerce.number().int().min(1).default(1)}).parse(request.query);
    return {data:await wallet.entries(request.userId!,q.page)};
  });

  // Create top-up order
  app.post("/order", { preHandler: userAuthHook }, async (request) => {
    const body = z.object({
      paymentMethod: z.enum(["stripe", "alipay", "wechat", "paypal"]),
      amount: z.number().positive(),
      idempotencyKey:z.string().regex(/^[a-zA-Z0-9_-]{16,64}$/),
    }).parse(request.body);

    return { data: await topupService.createOrder(request.userId!, body.paymentMethod, body.amount,body.idempotencyKey) };
  });

  // Stripe webhook (no auth - called by Stripe)
  await app.register(async hook=>{
   hook.removeContentTypeParser('application/json');
   hook.addContentTypeParser('application/json',{parseAs:'buffer',bodyLimit:262144},(_req,body,done)=>done(null,body));
   hook.post("/stripe/webhook", async (request, reply) => {
    const sig = request.headers["stripe-signature"] as string;
    if (!sig) return reply.code(400).send({ error: "Missing stripe-signature" });

    const payload = request.body as Buffer;
    return { data: await topupService.handleStripeWebhook(payload, sig) };
  });
  });
  app.post('/orders/:id/refresh',{preHandler:userAuthHook},async request=>{
    const {id}=z.object({id:z.coerce.bigint()}).parse(request.params);
    return {data:await topupService.refreshOrder(request.userId!,id)};
  });

  // List own orders
  app.get("/orders", { preHandler: userAuthHook }, async (request) => {
    const query = z.object({
      page: z.coerce.number().min(1).default(1),
      pageSize: z.coerce.number().min(1).max(100).default(20),
    }).parse(request.query);

    return { data: await topupService.listOrders(request.userId!, query.page, query.pageSize) };
  });

  // Get specific order
  app.get("/orders/:id", { preHandler: userAuthHook }, async (request) => {
    const { id } = z.object({ id: z.coerce.bigint() }).parse(request.params);
    return { data: await topupService.getOrder(request.userId!, id) };
  });
}
