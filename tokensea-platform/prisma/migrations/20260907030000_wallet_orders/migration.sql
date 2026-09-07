ALTER TABLE "top_up_orders"
 ADD COLUMN "currency" VARCHAR(8) NOT NULL DEFAULT 'legacy',
 ADD COLUMN "unitVersion" VARCHAR(32) NOT NULL DEFAULT 'legacy',
 ADD COLUMN "paymentMinor" INTEGER,
 ADD COLUMN "fxRate" DECIMAL(12,6),
 ADD COLUMN "idempotencyKey" VARCHAR(64),
 ADD COLUMN "checkoutId" VARCHAR(128),
 ADD COLUMN "checkoutUrl" TEXT,
 ADD COLUMN "expiresAt" TIMESTAMP(3),
 ADD COLUMN "paidAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "top_up_orders_checkoutId_key" ON "top_up_orders"("checkoutId");
CREATE UNIQUE INDEX "top_up_orders_userId_idempotencyKey_key" ON "top_up_orders"("userId","idempotencyKey");
CREATE TABLE "wallet_entries" (
 "id" BIGSERIAL PRIMARY KEY, "userId" BIGINT NOT NULL,
 "reference" VARCHAR(128) NOT NULL UNIQUE, "kind" VARCHAR(32) NOT NULL,
 "delta" BIGINT NOT NULL, "before" BIGINT NOT NULL, "after" BIGINT NOT NULL,
 "actorId" BIGINT, "reason" VARCHAR(256) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "wallet_entries_userId_createdAt_idx" ON "wallet_entries"("userId","createdAt" DESC);
CREATE TABLE "webhook_deliveries" (
 "id" BIGSERIAL PRIMARY KEY,"webhookId" BIGINT NOT NULL,"event" VARCHAR(64) NOT NULL,
 "payload" JSONB NOT NULL,"attempts" INTEGER NOT NULL DEFAULT 0,"status" VARCHAR(16) NOT NULL DEFAULT 'pending',
 "nextAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"lastStatus" INTEGER,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "webhook_deliveries_status_nextAt_idx" ON "webhook_deliveries"("status","nextAt");
