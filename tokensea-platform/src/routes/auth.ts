import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AuthService } from "../services/auth/auth-service.js";
import { TotpService } from "../services/totp/totp-service.js";
import { userAuthHook } from "../middleware/user-auth.js";
import { badRequest } from "../lib/errors.js";

const registerSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9]+$/, "Username must be alphanumeric"),
  password: z.string().min(8).max(128),
  email: z.string().email(),
  code: z.string().length(6),
  inviteCode: z.string().optional(),
});

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  totpCode: z.string().optional(),
});

export async function authRoutes(app: FastifyInstance) {
  const authService = new AuthService(app.prisma, app.env, app.redis);

  app.post("/send-register-code", async (request) => {
    const { email } = z.object({ email: z.string().email() }).parse(request.body);
    await authService.sendRegisterCode(email);
    return { data: { message: "Verification code sent" } };
  });

  app.post("/register", async (request, reply) => {
    const input = registerSchema.parse(request.body);
    const { user, token } = await authService.register(input);

    reply.code(201).send({
      data: {
        user: sanitizeUser(user),
        token,
      },
    });
  });

  app.post("/login", async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const { user, token, requires2FA } = await authService.login(input);

    if (requires2FA) {
      reply.send({
        data: {
          requires2FA: true,
          message: "2FA code required",
          userId: user.id.toString(),
        },
      });
      return;
    }

    reply.send({
      data: {
        user: sanitizeUser(user),
        token,
      },
    });
  });

  // Forgot password - send reset email
  app.post("/forgot-password", async (request) => {
    const { email } = z.object({ email: z.string().email() }).parse(request.body);
    await authService.forgotPassword(email);
    return { data: { message: "If that email exists, a reset link has been sent" } };
  });

  // Reset password with token
  app.post("/reset-password", async (request) => {
    const { token, newPassword } = z.object({
      token: z.string().min(1),
      newPassword: z.string().min(8).max(128),
    }).parse(request.body);

    await authService.resetPassword(token, newPassword);
    return { data: { message: "Password has been reset" } };
  });

  // Verify email with code
  app.post("/verify-email", async (request) => {
    const { code } = z.object({ code: z.string().length(6) }).parse(request.body);
    await authService.verifyEmail(code);
    return { data: { message: "Email verified successfully" } };
  });

  // Resend verification email
  app.post("/resend-verification", async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) throw badRequest("Authorization required");
    const { verifyToken } = await import("../lib/jwt.js");
    const payload = verifyToken(authHeader.slice(7), app.env.JWT_SECRET);

    await authService.resendVerification(payload.userId);
    return { data: { message: "Verification email sent" } };
  });

  // 2FA setup — generate secret and QR code URL
  app.post("/2fa/setup", { preHandler: userAuthHook }, async (request) => {
    const totpService = new TotpService(app.prisma);
    const result = await totpService.setup(request.userId!);
    return { data: result };
  });

  // 2FA enable — verify code and activate
  app.post("/2fa/enable", { preHandler: userAuthHook }, async (request) => {
    const { code } = z.object({ code: z.string().length(6) }).parse(request.body);
    const totpService = new TotpService(app.prisma);
    const result = await totpService.enable(request.userId!, code);
    return { data: result };
  });

  // 2FA disable — verify code and deactivate
  app.post("/2fa/disable", { preHandler: userAuthHook }, async (request) => {
    const { code } = z.object({ code: z.string().min(1) }).parse(request.body);
    const totpService = new TotpService(app.prisma);
    const result = await totpService.disable(request.userId!, code);
    return { data: result };
  });
}

function sanitizeUser(user: any) {
  const { passwordHash, emailVerifyToken, resetToken, resetTokenExpires, emailVerifyTokenExpires, totpSecret, recoveryCodes, ...safe } = user;
  return safe;
}
