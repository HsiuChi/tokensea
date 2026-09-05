import nodemailer from "nodemailer";
import type { Env } from "../../config/env.js";
import { internalError } from "../../lib/errors.js";

export class EmailService {
  private transporter: ReturnType<typeof nodemailer.createTransport> | null = null;
  private from: string;
  private frontendUrl: string;
  private configured: boolean;

  constructor(env: Env) {
    this.from = env.SMTP_FROM;
    this.frontendUrl = env.FRONTEND_URL;
    this.configured = !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);

    if (this.configured) {
      this.transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE === "true",
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      });
    }
  }

  private async sendMail(to: string, subject: string, html: string) {
    if (!this.configured || !this.transporter) {
      throw internalError("Email service not configured");
    }
    await this.transporter.sendMail({ from: this.from, to, subject, html });
  }

  async sendPasswordResetEmail(email: string, token: string) {
    const url = `${this.frontendUrl}/reset-password?token=${token}`;
    await this.sendMail(
      email,
      "Reset your TokenSea password",
      `<p>Click <a href="${url}">here</a> to reset your password. This link expires in 1 hour.</p>
       <p>If you did not request this, ignore this email.</p>`,
    );
  }

  async sendEmailVerification(email: string, code: string) {
    await this.sendMail(
      email,
      "Verify your TokenSea email",
      `<p>Your TokenSea verification code is: <strong style="font-size: 24px; letter-spacing: 4px;">${code}</strong></p>
       <p>Enter this code on the verification page to verify your email address.</p>
       <p>This code expires in 5 minutes.</p>`,
    );
  }

  async sendQuotaAlert(email: string, remaining: string) {
    await this.sendMail(
      email,
      "TokenSea quota alert",
      `<p>Your remaining quota is <strong>${remaining}</strong>. Consider topping up to avoid service interruption.</p>`,
    );
  }

  async sendWelcomeEmail(email: string, username: string) {
    await this.sendMail(
      email,
      "Welcome to TokenSea!",
      `<p>Hello ${username},</p><p>Welcome to TokenSea! You can now access our AI API gateway.</p>`,
    );
  }

  isConfigured() {
    return this.configured;
  }
}
