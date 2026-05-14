import type { PrismaClient } from "@prisma/client";
import { randomBytes } from "crypto";
import { notFound, badRequest, internalError } from "../../lib/errors.js";
import Stripe from "stripe";
import type { Env } from "../../config/env.js";

export class TopupService {
  private stripe: Stripe | null = null;

  constructor(
    private prisma: PrismaClient,
    private env: Env,
  ) {
    if (env.STRIPE_SECRET_KEY) {
      this.stripe = new Stripe(env.STRIPE_SECRET_KEY);
    }
  }

  async createOrder(userId: bigint, paymentMethod: string, amount: number) {
    if (amount <= 0) throw badRequest("Amount must be positive");

    // Convert CNY yuan to quota units (1 yuan = 100 quota units, matching formatQuota)
    const quota = BigInt(Math.floor(amount * 100));
    const tradeNo = `TS${Date.now()}${randomBytes(4).toString("hex").toUpperCase()}`;

    const order = await this.prisma.topUpOrder.create({
      data: {
        userId,
        tradeNo,
        paymentMethod,
        amount: quota,
        money: amount,
        status: "pending",
      },
    });

    // If Stripe, create a checkout session
    if (paymentMethod === "stripe" && this.stripe) {
      try {
        const session = await this.stripe.checkout.sessions.create({
          payment_intent_data: { metadata: { orderId: order.id.toString(), userId: userId.toString() } },
          line_items: [{
            price_data: {
              currency: "usd",
              product_data: { name: `TokenSea Top-up ¥${amount}` },
              unit_amount: Math.floor(amount * 100), // cents
            },
            quantity: 1,
          }],
          mode: "payment",
          success_url: `${this.env.FRONTEND_URL}/app/topup?status=success`,
          cancel_url: `${this.env.FRONTEND_URL}/app/topup?status=cancelled`,
        });

        return { order, checkoutUrl: session.url };
      } catch (err) {
        await this.prisma.topUpOrder.update({ where: { id: order.id }, data: { status: "failed" } });
        throw internalError("Failed to create Stripe checkout session");
      }
    }

    // For other payment methods, return order info (to be integrated later)
    return { order, checkoutUrl: null };
  }

  async handleStripeWebhook(payload: string, sig: string) {
    if (!this.stripe || !this.env.STRIPE_WEBHOOK_SECRET) {
      throw badRequest("Stripe not configured");
    }

    const event = this.stripe.webhooks.constructEvent(payload, sig, this.env.STRIPE_WEBHOOK_SECRET);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const pi = session.payment_intent;
      const piId = typeof pi === "string" ? pi : pi?.id;
      const metadata = typeof pi === "string" ? null : pi?.metadata;
      const orderId = metadata?.orderId;
      if (!orderId) return { received: true };

      await this.fulfillOrder(BigInt(orderId), piId ?? null);
    }

    return { received: true };
  }

  async fulfillOrder(orderId: bigint, gatewayTradeNo: string | null) {
    const order = await this.prisma.topUpOrder.findUnique({ where: { id: orderId } });
    if (!order) throw notFound("Order not found");
    if (order.status !== "pending") return; // Already processed

    await this.prisma.$transaction(async (tx) => {
      // Add quota to user
      await tx.user.update({
        where: { id: order.userId },
        data: { quota: { increment: order.amount } },
      });

      // Mark order as success
      await tx.topUpOrder.update({
        where: { id: orderId },
        data: { status: "success", gatewayTradeNo },
      });
    });
  }

  async listOrders(userId: bigint, page = 1, pageSize = 20) {
    const [items, total] = await Promise.all([
      this.prisma.topUpOrder.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.topUpOrder.count({ where: { userId } }),
    ]);
    return { items, total, page, pageSize };
  }

  async getOrder(userId: bigint, orderId: bigint) {
    const order = await this.prisma.topUpOrder.findFirst({
      where: { id: orderId, userId },
    });
    if (!order) throw notFound("Order not found");
    return order;
  }
}
