import type { FastifyInstance } from "fastify";
import { AuthService } from "../services/auth/auth-service.js";
import { PlanService } from "../services/plan/plan-service.js";
import { TopupService } from "../services/topup/topup-service.js";
import { userAuthHook } from "../middleware/user-auth.js";
import { z } from "zod";

export async function userRoutes(app: FastifyInstance) {
  const authService = new AuthService(app.prisma, app.env, app.redis);
  const planService = new PlanService(app.prisma);
  const topupService = new TopupService(app.prisma, app.env);

  app.get("/self", { preHandler: userAuthHook }, async (request) => {
    const user = await authService.getSelf(request.userId!);
    const { passwordHash, emailVerifyToken, resetToken, resetTokenExpires, emailVerifyTokenExpires, totpSecret, recoveryCodes, ...safe } = user;
    return { data: safe };
  });

  app.put("/self", { preHandler: userAuthHook }, async (request) => {
    const body = z.object({
      name: z.string().max(64).optional(),
      email: z.string().email().optional(),
    }).parse(request.body);

    const user = await authService.updateSelf(request.userId!, body);
    const { passwordHash, emailVerifyToken, resetToken, resetTokenExpires, emailVerifyTokenExpires, totpSecret, recoveryCodes, ...safe } = user;
    return { data: safe };
  });

  app.put("/self/password", { preHandler: userAuthHook }, async (request) => {
    const body = z.object({
      oldPassword: z.string().min(1),
      newPassword: z.string().min(8).max(128),
    }).parse(request.body);

    await authService.changePassword(request.userId!, body.oldPassword, body.newPassword);
    return { data: { message: "Password updated" } };
  });

  // Delete own account
  app.delete("/self", { preHandler: userAuthHook }, async (request) => {
    await authService.deleteAccount(request.userId!);
    return { data: { message: "Account deleted" } };
  });

  // Get plan bindings
  app.get("/self/bindings", { preHandler: userAuthHook }, async (request) => {
    const bindings = await app.prisma.userPlanBinding.findMany({
      where: { userId: request.userId! },
      include: { plan: true },
      orderBy: { createdAt: "desc" },
    });
    return { data: bindings };
  });

  // Get topup orders
  app.get("/self/orders", { preHandler: userAuthHook }, async (request) => {
    const query = z.object({
      page: z.coerce.number().min(1).default(1),
      pageSize: z.coerce.number().min(1).max(100).default(20),
    }).parse(request.query);

    return { data: await topupService.listOrders(request.userId!, query.page, query.pageSize) };
  });
}
