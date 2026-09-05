import { billingRoutes } from "./billing.js";
import type { FastifyInstance } from "fastify";
import { authRoutes } from "./auth.js";
import { tokenRoutes } from "./token.js";
import { userRoutes } from "./user.js";
import { relayRoutes } from "./relay.js";
import { planRoutes } from "./plan.js";
import { channelRoutes } from "./channel.js";
import { keyGroupRoutes } from "./keygroup.js";
import { redemptionRoutes } from "./redemption.js";
import { logRoutes } from "./log.js";
import { adminRoutes } from "./admin.js";
import { topupRoutes } from "./topup.js";
import { oauthRoutes } from "./oauth.js";
import { publicRoutes } from "./public.js";
import { subscriptionRoutes } from "./subscription.js";
import { sensitiveRoutes } from "./sensitive.js";
import { webhookRoutes } from "./webhook.js";

export async function registerRoutes(app: FastifyInstance) {
  await app.register(billingRoutes, {prefix:"/api/billing"});
  // Health check
  app.get("/api/health", async () => ({ status: "ok", timestamp: new Date().toISOString() }));

  // Auth (includes 2FA endpoints)
  await app.register(authRoutes, { prefix: "/api/auth" });

  // User
  await app.register(userRoutes, { prefix: "/api/user" });

  // Token (API Key)
  await app.register(tokenRoutes, { prefix: "/api/token" });

  // Plans (public + admin)
  await app.register(planRoutes, { prefix: "/api/plan" });

  // Channels (admin)
  await app.register(channelRoutes, { prefix: "/api/channel" });

  // Key groups (admin)
  await app.register(keyGroupRoutes, { prefix: "/api/keygroup" });

  // Redemptions
  await app.register(redemptionRoutes, { prefix: "/api/redemption" });

  // Logs
  await app.register(logRoutes, { prefix: "/api/log" });

  // Admin (users, models, options, announcements)
  await app.register(adminRoutes, { prefix: "/api/admin" });

  // Topup / Payment
  await app.register(topupRoutes, { prefix: "/api/topup" });

  // Subscriptions
  await app.register(subscriptionRoutes, { prefix: "/api/subscription" });

  // OAuth
  await app.register(oauthRoutes, { prefix: "/api/oauth" });

  // Public (announcements, model pricing)
  await app.register(publicRoutes, { prefix: "/api/public" });

  // Sensitive words (admin)
  await app.register(sensitiveRoutes, { prefix: "/api/sensitive" });

  // Webhooks (admin)
  await app.register(webhookRoutes, { prefix: "/api/webhook" });

  // Relay (v1/*)
  await app.register(relayRoutes);
}
