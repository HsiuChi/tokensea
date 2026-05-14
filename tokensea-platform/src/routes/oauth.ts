import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { signToken } from "../lib/jwt.js";
import { generateInviteCode } from "../lib/crypto.js";
import { hashPassword } from "../lib/password.js";
import { badRequest } from "../lib/errors.js";

export async function oauthRoutes(app: FastifyInstance) {

  // ===== GitHub OAuth =====

  app.get("/github", async (request, reply) => {
    if (!app.env.GITHUB_CLIENT_ID) throw badRequest("GitHub OAuth not configured");
    const redirectUri = `${app.env.FRONTEND_URL.replace(/\/$/, "")}/api/oauth/github/callback`;
    const state = Math.random().toString(36).slice(2);
    const url = `https://github.com/login/oauth/authorize?client_id=${app.env.GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&scope=user:email`;
    reply.redirect(url);
  });

  app.get("/github/callback", async (request, reply) => {
    const { code } = z.object({ code: z.string() }).parse(request.query);

    // Exchange code for access token
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: app.env.GITHUB_CLIENT_ID,
        client_secret: app.env.GITHUB_CLIENT_SECRET,
        code,
      }),
    });

    const tokenData = await tokenRes.json() as any;
    if (!tokenData.access_token) throw badRequest("GitHub OAuth failed");

    // Get user info
    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const ghUser = await userRes.json() as any;

    // Get email if not public
    let email = ghUser.email;
    if (!email) {
      const emailsRes = await fetch("https://api.github.com/user/emails", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const emails = await emailsRes.json() as any[];
      const primary = emails?.find((e: any) => e.primary);
      email = primary?.email;
    }

    const result = await findOrCreateOAuthUser(app, {
      provider: "github",
      providerId: String(ghUser.id),
      username: ghUser.login,
      email: email || undefined,
      name: ghUser.name || ghUser.login,
      avatar: ghUser.avatar_url,
    });

    // Redirect to frontend with token
    reply.redirect(`${app.env.FRONTEND_URL}/app?token=${result.token}`);
  });

  // ===== Google OAuth =====

  app.get("/google", async (request, reply) => {
    if (!app.env.GOOGLE_CLIENT_ID) throw badRequest("Google OAuth not configured");
    const redirectUri = `${app.env.FRONTEND_URL.replace(/\/$/, "")}/api/oauth/google/callback`;
    const params = new URLSearchParams({
      client_id: app.env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      access_type: "offline",
    });
    reply.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  app.get("/google/callback", async (request, reply) => {
    const { code } = z.object({ code: z.string() }).parse(request.query);

    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: app.env.GOOGLE_CLIENT_ID!,
        client_secret: app.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: `${app.env.FRONTEND_URL.replace(/\/$/, "")}/api/oauth/google/callback`,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenRes.json() as any;
    if (!tokenData.id_token) throw badRequest("Google OAuth failed");

    // Decode ID token (simple JWT decode, no verification for now - in production use google-auth-library)
    const payload = JSON.parse(Buffer.from(tokenData.id_token.split(".")[1], "base64").toString());

    const result = await findOrCreateOAuthUser(app, {
      provider: "google",
      providerId: payload.sub,
      username: payload.name?.replace(/\s/g, "").toLowerCase() || `g_${payload.sub.slice(0, 8)}`,
      email: payload.email,
      name: payload.name,
      avatar: payload.picture,
    });

    reply.redirect(`${app.env.FRONTEND_URL}/app?token=${result.token}`);
  });
}

async function findOrCreateOAuthUser(
  app: FastifyInstance,
  data: { provider: string; providerId: string; username: string; email?: string; name?: string; avatar?: string },
) {
  // Try to find user by email first
  let user: any = null;
  if (data.email) {
    user = await app.prisma.user.findUnique({ where: { email: data.email } });
  }

  if (!user) {
    // Check if username is taken, add suffix if needed
    let username = data.username;
    let existing = await app.prisma.user.findUnique({ where: { username } });
    let suffix = 1;
    while (existing) {
      username = `${data.username}${suffix}`;
      existing = await app.prisma.user.findUnique({ where: { username } });
      suffix++;
    }

    // Create user with random password (they'll use OAuth to login)
    const passwordHash = await hashPassword(Math.random().toString(36) + Date.now().toString());
    user = await app.prisma.user.create({
      data: {
        username,
        passwordHash,
        email: data.email || null,
        name: data.name || null,
        avatar: data.avatar || null,
        emailVerified: !!data.email,
        inviteCode: generateInviteCode(),
        role: "user",
        status: "active",
        quota: 0n,
        usedQuota: 0n,
      },
    });
  } else {
    // Update avatar if user exists
    if (data.avatar && !user.avatar) {
      await app.prisma.user.update({
        where: { id: user.id },
        data: { avatar: data.avatar },
      });
    }
  }

  const token = signToken(
    { userId: user.id, role: user.role },
    app.env.JWT_SECRET,
    app.env.JWT_EXPIRES_IN,
  );

  return { user, token };
}
