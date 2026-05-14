import type { PrismaClient, User } from "@prisma/client";
import { randomBytes } from "crypto";
import type Redis from "ioredis";
import { hashPassword, comparePassword } from "../../lib/password.js";
import { signToken } from "../../lib/jwt.js";
import { generateInviteCode } from "../../lib/crypto.js";
import { badRequest, notFound, unauthorized, forbidden } from "../../lib/errors.js";
import { EmailService } from "../email/email-service.js";
import { TotpService } from "../totp/totp-service.js";
import type { Env } from "../../config/env.js";

export class AuthService {
  private emailService: EmailService;
  private totpService: TotpService;

  constructor(
    private prisma: PrismaClient,
    private env: Env,
    private redis: Redis,
  ) {
    this.emailService = new EmailService(env);
    this.totpService = new TotpService(prisma);
  }

  async sendRegisterCode(email: string) {
    const verifiedUser = await this.prisma.user.findFirst({
      where: { email, emailVerified: true },
    });
    if (verifiedUser) throw badRequest("Email already registered");

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await this.redis.setex(`register:code:${email}`, 300, code);

    if (this.emailService.isConfigured()) {
      await this.emailService.sendEmailVerification(email, code);
    } else {
      throw badRequest("Email service not configured");
    }
  }

  async register(input: {
    username: string;
    password: string;
    email: string;
    code: string;
    inviteCode?: string;
  }): Promise<{ user: User; token: string }> {
    const { username, password, email, code, inviteCode } = input;

    const existing = await this.prisma.user.findUnique({ where: { username } });
    if (existing) throw badRequest("Username already taken");

    const verifiedUser = await this.prisma.user.findFirst({
      where: { email, emailVerified: true },
    });
    if (verifiedUser) throw badRequest("Email already registered");

    // Clear email from any unverified user so the unique constraint doesn't block new registration
    const unverifiedUser = await this.prisma.user.findUnique({ where: { email } });
    if (unverifiedUser && !unverifiedUser.emailVerified) {
      await this.prisma.user.update({
        where: { id: unverifiedUser.id },
        data: { email: null, emailVerified: false, emailVerifyToken: null, emailVerifyTokenExpires: null },
      });
    }

    const storedCode = await this.redis.get(`register:code:${email}`);
    if (!storedCode || storedCode !== code) {
      throw badRequest("Invalid or expired verification code");
    }

    let inviterId: bigint | undefined;
    if (inviteCode) {
      const inviter = await this.prisma.user.findUnique({ where: { inviteCode } });
      if (!inviter) throw badRequest("Invalid invite code");
      inviterId = inviter.id;
    }

    const passwordHash = await hashPassword(password);
    const newInviteCode = generateInviteCode();

    const user = await this.prisma.user.create({
      data: {
        username,
        passwordHash,
        email,
        emailVerified: true,
        inviteCode: newInviteCode,
        invitedBy: inviterId ?? null,
        role: "user",
        status: "active",
        quota: 0n,
        usedQuota: 0n,
      },
    });

    await this.redis.del(`register:code:${email}`);

    const token = signToken(
      { userId: user.id, role: user.role },
      this.env.JWT_SECRET,
      this.env.JWT_EXPIRES_IN,
    );

    return { user, token };
  }

  async login(input: {
    username: string;
    password: string;
    totpCode?: string;
  }): Promise<{ user: User; token: string; requires2FA?: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { username: input.username } });
    if (!user) throw unauthorized("Invalid username or password");
    if (user.status === "disabled") throw forbidden("Account is disabled");

    const valid = await comparePassword(input.password, user.passwordHash);
    if (!valid) throw unauthorized("Invalid username or password");

    // 2FA check
    if (user.totpEnabled) {
      if (!input.totpCode) {
        return { user, token: "", requires2FA: true };
      }
      const validTotp = await this.totpService.verify(user.id, input.totpCode);
      if (!validTotp) throw unauthorized("Invalid 2FA code");
    }

    const token = signToken(
      { userId: user.id, role: user.role },
      this.env.JWT_SECRET,
      this.env.JWT_EXPIRES_IN,
    );

    return { user, token };
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return; // Don't reveal whether email exists

    const resetToken = randomBytes(24).toString("hex");
    const resetTokenExpires = new Date(Date.now() + 3600 * 1000); // 1 hour

    await this.prisma.user.update({
      where: { id: user.id },
      data: { resetToken, resetTokenExpires },
    });

    if (this.emailService.isConfigured()) {
      await this.emailService.sendPasswordResetEmail(email, resetToken);
    } else {
      throw badRequest("Email service not configured");
    }
  }

  async resetPassword(token: string, newPassword: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        resetToken: token,
        resetTokenExpires: { gt: new Date() },
      },
    });

    if (!user) throw badRequest("Invalid or expired reset token");

    const passwordHash = await hashPassword(newPassword);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, resetToken: null, resetTokenExpires: null },
    });
  }

  async verifyEmail(code: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        emailVerifyToken: code,
        emailVerifyTokenExpires: { gt: new Date() },
      },
    });

    if (!user) throw badRequest("Invalid or expired verification code");

    await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, emailVerifyToken: null, emailVerifyTokenExpires: null },
    });
  }

  async resendVerification(userId: bigint) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw notFound("User not found");
    if (!user.email) throw badRequest("No email on file");
    if (user.emailVerified) throw badRequest("Email already verified");

    const newCode = Math.floor(100000 + Math.random() * 900000).toString();
    await this.prisma.user.update({
      where: { id: userId },
      data: { emailVerifyToken: newCode, emailVerifyTokenExpires: new Date(Date.now() + 24 * 3600 * 1000) },
    });

    if (this.emailService.isConfigured()) {
      await this.emailService.sendEmailVerification(user.email, newCode);
    }
  }

  async getSelf(userId: bigint) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw notFound("User not found");
    return user;
  }

  async updateSelf(userId: bigint, data: { name?: string; email?: string }) {
    if (data.email) {
      const existing = await this.prisma.user.findUnique({ where: { email: data.email } });
      if (existing && existing.id !== userId) throw badRequest("Email already in use");
    }
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.email !== undefined && { email: data.email }),
      },
    });
  }

  async changePassword(userId: bigint, oldPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw notFound("User not found");

    const valid = await comparePassword(oldPassword, user.passwordHash);
    if (!valid) throw badRequest("Current password is incorrect");

    const passwordHash = await hashPassword(newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  async deleteAccount(userId: bigint) {
    await this.prisma.apiKey.deleteMany({ where: { userId } });
    await this.prisma.user.delete({ where: { id: userId } });
  }
}
