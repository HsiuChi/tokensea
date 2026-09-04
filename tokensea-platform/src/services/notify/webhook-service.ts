import type { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import { notFound } from "../../lib/errors.js";

export const WEBHOOK_EVENTS = [
  "node.unhealthy",
  "node.degraded",
  "node.recovered",
  "node.oauth_expired",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

interface DeliveryPayload {
  event: string;
  payload: Record<string, any>;
  timestamp: string;
}

function sign(secret: string | null, body: string): string | null {
  if (!secret) return null;
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

/** Fire-and-forget POST to every active webhook subscribed to the event. */
export function dispatchWebhookEvent(
  prisma: PrismaClient,
  event: WebhookEvent,
  payload: Record<string, any>,
): void {
  void (async () => {
    try {
      const hooks = await prisma.webhook.findMany({ where: { status: "active" } });
      const targets = hooks.filter((h) => {
        const events = (h.events as string[]) ?? [];
        return events.includes("*") || events.includes(event);
      });
      await Promise.allSettled(targets.map((h) => deliver(h.url, h.secret, { event, payload, timestamp: new Date().toISOString() })));
    } catch (err) {
      console.error("[webhook] dispatch error:", err);
    }
  })();
}

async function deliver(url: string, secret: string | null, body: DeliveryPayload): Promise<void> {
  const text = JSON.stringify(body);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const sig = sign(secret, text);
  if (sig) headers["x-tokensea-signature"] = sig;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: text,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.error(`[webhook] ${body.event} -> ${url} responded ${res.status}`);
  } catch (err: any) {
    console.error(`[webhook] ${body.event} -> ${url} failed: ${err.message}`);
  }
}

export class WebhookService {
  constructor(private prisma: PrismaClient) {}

  async list() {
    return this.prisma.webhook.findMany({ orderBy: { createdAt: "desc" } });
  }

  async create(data: { url: string; events: string[]; secret?: string }) {
    return this.prisma.webhook.create({ data: { url: data.url, events: data.events, secret: data.secret } });
  }

  async update(id: bigint, data: Record<string, any>) {
    return this.prisma.webhook.update({ where: { id }, data });
  }

  async delete(id: bigint) {
    return this.prisma.webhook.delete({ where: { id } });
  }

  /** Send a ping event to this webhook and report the outcome. */
  async test(id: bigint) {
    const hook = await this.prisma.webhook.findUnique({ where: { id } });
    if (!hook) throw notFound("Webhook not found");
    const start = Date.now();
    const body: DeliveryPayload = { event: "ping", payload: { webhookId: id.toString() }, timestamp: new Date().toISOString() };
    const text = JSON.stringify(body);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const sig = sign(hook.secret, text);
    if (sig) headers["x-tokensea-signature"] = sig;
    try {
      const res = await fetch(hook.url, { method: "POST", headers, body: text, signal: AbortSignal.timeout(5000) });
      return { ok: res.ok, status: res.status, latencyMs: Date.now() - start };
    } catch (err: any) {
      return { ok: false, latencyMs: Date.now() - start, error: err.message };
    }
  }
}
