-- Earlier releases used db push. Record their additive schema for fresh installs,
-- without resetting production rows, prices, quota counters or channel settings.
BEGIN;
DO $$ BEGIN CREATE TYPE "SubOrderStatus" AS ENUM ('pending','success','failed','refunded'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS "key_groups" (
 "id" BIGSERIAL PRIMARY KEY, "name" VARCHAR(64) NOT NULL, "userId" BIGINT NOT NULL,
 "models" JSONB, "quota" BIGINT NOT NULL DEFAULT -1, "usedQuota" BIGINT NOT NULL DEFAULT 0,
 "priority" INTEGER NOT NULL DEFAULT 0, "status" "ApiKeyStatus" NOT NULL DEFAULT 'active',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "key_groups_name_key" ON "key_groups"("name");
CREATE INDEX IF NOT EXISTS "key_groups_userId_status_idx" ON "key_groups"("userId","status");
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "keyGroupId" BIGINT;
CREATE INDEX IF NOT EXISTS "api_keys_keyGroupId_idx" ON "api_keys"("keyGroupId");
ALTER TABLE "channel_nodes" ADD COLUMN IF NOT EXISTS "consecutiveFails" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS "consecutiveSuccesses" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS "probeLatency" INTEGER, ADD COLUMN IF NOT EXISTS "probePath" VARCHAR(64),
 ADD COLUMN IF NOT EXISTS "probeTimeoutMs" INTEGER NOT NULL DEFAULT 5000;
ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "billingMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1,
 ADD COLUMN IF NOT EXISTS "probeEnabled" BOOLEAN NOT NULL DEFAULT true, ADD COLUMN IF NOT EXISTS "retryPolicy" JSONB;
ALTER TABLE "model_aliases" ADD COLUMN IF NOT EXISTS "cacheReadPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS "cacheWrite1hPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS "cacheWrite5mPrice" DOUBLE PRECISION NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS "pricing" JSONB;
ALTER TABLE "model_aliases" ALTER COLUMN "inputPrice" TYPE DOUBLE PRECISION, ALTER COLUMN "outputPrice" TYPE DOUBLE PRECISION;
ALTER TABLE "request_logs" ADD COLUMN IF NOT EXISTS "cacheCreationTokens" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS "cacheReadTokens" INTEGER NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS "pricingDetail" JSONB;
ALTER TABLE "usage_ledgers" ADD COLUMN IF NOT EXISTS "billingMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1,
 ADD COLUMN IF NOT EXISTS "cacheCreationTokens" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS "cacheReadTokens" INTEGER NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS "channelId" BIGINT,
 ADD COLUMN IF NOT EXISTS "cost" DOUBLE PRECISION NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS "usage_ledgers_channelId_billingPeriod_idx" ON "usage_ledgers"("channelId","billingPeriod");
CREATE TABLE IF NOT EXISTS "webhooks" (
 "id" BIGSERIAL PRIMARY KEY,"url" VARCHAR(512) NOT NULL,"events" JSONB NOT NULL DEFAULT '[]',"secret" VARCHAR(128),
 "status" VARCHAR(16) NOT NULL DEFAULT 'active',"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL
);
ALTER TABLE "users" ALTER COLUMN "recoveryCodes" TYPE JSONB USING "recoveryCodes"::jsonb;
ALTER TABLE "subscription_orders" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "subscription_orders" ALTER COLUMN "status" TYPE "SubOrderStatus" USING "status"::text::"SubOrderStatus";
ALTER TABLE "subscription_orders" ALTER COLUMN "status" SET DEFAULT 'pending';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='api_keys_keyGroupId_fkey') THEN ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_keyGroupId_fkey" FOREIGN KEY ("keyGroupId") REFERENCES "key_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='key_groups_userId_fkey') THEN ALTER TABLE "key_groups" ADD CONSTRAINT "key_groups_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='usage_ledgers_channelId_fkey') THEN ALTER TABLE "usage_ledgers" ADD CONSTRAINT "usage_ledgers_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF;
END $$;
COMMIT;
