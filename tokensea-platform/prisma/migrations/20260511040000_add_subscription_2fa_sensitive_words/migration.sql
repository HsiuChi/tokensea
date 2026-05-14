-- AlterTable: Add 2FA fields to users
ALTER TABLE "users" ADD COLUMN   "totpSecret" VARCHAR(64);
ALTER TABLE "users" ADD COLUMN   "totpEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN   "recoveryCodes" JSON;

-- AlterTable: Add subscription fields to user_plan_bindings
ALTER TABLE "user_plan_bindings" ADD COLUMN "autoRenew" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "user_plan_bindings" ADD COLUMN "quotaGranted" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "user_plan_bindings" ADD COLUMN "quotaUsed" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "user_plan_bindings" ADD COLUMN "cancelledAt" TIMESTAMP(3);

-- CreateTable: Subscription orders
CREATE TABLE "subscription_orders" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "planId" BIGINT NOT NULL,
    "bindingId" BIGINT NOT NULL,
    "tradeNo" VARCHAR(32) NOT NULL,
    "gatewayTradeNo" VARCHAR(64),
    "paymentMethod" VARCHAR(16) NOT NULL DEFAULT 'balance',
    "amount" BIGINT NOT NULL DEFAULT 0,
    "money" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "durationDays" INT NOT NULL DEFAULT 30,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subscription_orders_tradeNo_key" ON "subscription_orders"("tradeNo");
CREATE INDEX "subscription_orders_userId_createdAt_idx" ON "subscription_orders"("userId", "createdAt" DESC);

-- CreateTable: Sensitive words
CREATE TABLE "sensitive_words" (
    "id" BIGSERIAL NOT NULL,
    "word" VARCHAR(128) NOT NULL,
    "category" VARCHAR(32) NOT NULL DEFAULT 'general',
    "action" VARCHAR(16) NOT NULL DEFAULT 'block',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sensitive_words_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sensitive_words_word_key" ON "sensitive_words"("word");
CREATE INDEX "sensitive_words_enabled_category_idx" ON "sensitive_words"("enabled", "category");
