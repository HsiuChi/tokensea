-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('user', 'admin', 'root');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "ApiKeyStatus" AS ENUM ('active', 'disabled', 'expired');

-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('free', 'starter', 'pro', 'max');

-- CreateEnum
CREATE TYPE "QuotaMode" AS ENUM ('request_count', 'token_count', 'mixed');

-- CreateEnum
CREATE TYPE "BindingStatus" AS ENUM ('active', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('claude', 'codex', 'openai', 'anthropic', 'gemini', 'deepseek', 'custom');

-- CreateEnum
CREATE TYPE "ChannelStatus" AS ENUM ('active', 'disabled', 'maintenance');

-- CreateEnum
CREATE TYPE "NodeStatus" AS ENUM ('healthy', 'degraded', 'unhealthy');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('succeeded', 'failed', 'timeout', 'rate_limited', 'consumer_abort');

-- CreateEnum
CREATE TYPE "RouteStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "RedemptionStatus" AS ENUM ('active', 'used', 'disabled');

-- CreateEnum
CREATE TYPE "TopUpStatus" AS ENUM ('pending', 'success', 'failed', 'refunded');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('final', 'adjusted');

-- CreateTable
CREATE TABLE "users" (
    "id" BIGSERIAL NOT NULL,
    "username" VARCHAR(32) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255),
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "name" VARCHAR(64),
    "avatar" VARCHAR(512),
    "role" "UserRole" NOT NULL DEFAULT 'user',
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "quota" BIGINT NOT NULL DEFAULT 0,
    "usedQuota" BIGINT NOT NULL DEFAULT 0,
    "inviteCode" VARCHAR(16) NOT NULL,
    "invitedBy" BIGINT,
    "requestCount" BIGINT NOT NULL DEFAULT 0,
    "createdBy" BIGINT,
    "remark" VARCHAR(512),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "displayName" VARCHAR(64) NOT NULL,
    "description" VARCHAR(512),
    "tier" "PlanTier" NOT NULL,
    "quotaMode" "QuotaMode" NOT NULL DEFAULT 'mixed',
    "requestLimit" BIGINT NOT NULL DEFAULT -1,
    "tokenLimit" BIGINT NOT NULL DEFAULT -1,
    "billableUnitLimit" BIGINT NOT NULL DEFAULT -1,
    "dailyBillableUnitLimit" BIGINT NOT NULL DEFAULT -1,
    "qpsLimit" INTEGER NOT NULL DEFAULT 5,
    "rpmLimit" INTEGER NOT NULL DEFAULT 60,
    "tpmLimit" INTEGER NOT NULL DEFAULT 100000,
    "maxTokensPerRequest" INTEGER NOT NULL DEFAULT 128000,
    "allowedModelAliases" JSONB NOT NULL,
    "billingCycleType" TEXT NOT NULL DEFAULT 'monthly',
    "billingMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "price" INTEGER NOT NULL DEFAULT 0,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "isSubscription" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_plan_bindings" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "planId" BIGINT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "status" "BindingStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_plan_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "keyPrefix" VARCHAR(12) NOT NULL,
    "keyHash" VARCHAR(64) NOT NULL,
    "keyPlain" VARCHAR(128),
    "name" VARCHAR(64) NOT NULL,
    "status" "ApiKeyStatus" NOT NULL DEFAULT 'active',
    "quota" BIGINT NOT NULL DEFAULT -1,
    "usedQuota" BIGINT NOT NULL DEFAULT 0,
    "maxCalls" BIGINT NOT NULL DEFAULT -1,
    "usedCalls" BIGINT NOT NULL DEFAULT 0,
    "dailyLimit" BIGINT NOT NULL DEFAULT -1,
    "tokenLimit" BIGINT NOT NULL DEFAULT -1,
    "models" JSONB,
    "planId" BIGINT,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "allowedIps" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_aliases" (
    "id" BIGSERIAL NOT NULL,
    "alias" VARCHAR(64) NOT NULL,
    "displayName" VARCHAR(64) NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "inputPrice" INTEGER NOT NULL DEFAULT 0,
    "outputPrice" INTEGER NOT NULL DEFAULT 0,
    "supportsStream" BOOLEAN NOT NULL DEFAULT true,
    "supportsTools" BOOLEAN NOT NULL DEFAULT true,
    "supportsVision" BOOLEAN NOT NULL DEFAULT false,
    "maxContext" INTEGER NOT NULL DEFAULT 200000,
    "status" "RouteStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "model_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_routes" (
    "id" BIGSERIAL NOT NULL,
    "aliasId" BIGINT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "channelId" BIGINT NOT NULL,
    "upstreamModel" VARCHAR(64) NOT NULL,
    "status" "RouteStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "model_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channels" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "type" "ChannelType" NOT NULL,
    "status" "ChannelStatus" NOT NULL DEFAULT 'active',
    "cpaUpstreamKey" VARCHAR(64),
    "baseUrl" VARCHAR(512),
    "models" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "testModel" VARCHAR(64),
    "lastTestAt" TIMESTAMP(3),
    "lastTestLatency" INTEGER,
    "totalRequests" BIGINT NOT NULL DEFAULT 0,
    "failedRequests" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_nodes" (
    "id" BIGSERIAL NOT NULL,
    "channelId" BIGINT NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "internalUrl" VARCHAR(256) NOT NULL,
    "internalApiKey" VARCHAR(128) NOT NULL,
    "status" "NodeStatus" NOT NULL DEFAULT 'healthy',
    "accountId" VARCHAR(64),
    "oauthExpiresAt" TIMESTAMP(3),
    "maxConcurrent" INTEGER NOT NULL DEFAULT 5,
    "currentLoad" INTEGER NOT NULL DEFAULT 0,
    "totalRequests" BIGINT NOT NULL DEFAULT 0,
    "failedRequests" BIGINT NOT NULL DEFAULT 0,
    "last429At" TIMESTAMP(3),
    "lastHealthCheck" TIMESTAMP(3),
    "healthStatus" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_logs" (
    "id" BIGSERIAL NOT NULL,
    "requestId" VARCHAR(36) NOT NULL,
    "userId" BIGINT NOT NULL,
    "apiKeyId" BIGINT NOT NULL,
    "endpoint" VARCHAR(32) NOT NULL,
    "requestedModel" VARCHAR(64) NOT NULL,
    "actualUpstreamModel" VARCHAR(64),
    "channelId" BIGINT,
    "nodeId" BIGINT,
    "stream" BOOLEAN NOT NULL DEFAULT false,
    "status" "RequestStatus" NOT NULL,
    "httpStatus" INTEGER,
    "errorCode" VARCHAR(32),
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "billableUnits" BIGINT NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,

    CONSTRAINT "request_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_ledgers" (
    "id" BIGSERIAL NOT NULL,
    "requestId" VARCHAR(36) NOT NULL,
    "userId" BIGINT NOT NULL,
    "apiKeyId" BIGINT NOT NULL,
    "billingPeriod" VARCHAR(8) NOT NULL,
    "billedRequests" INTEGER NOT NULL DEFAULT 1,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "billableUnits" BIGINT NOT NULL DEFAULT 0,
    "settlementStatus" "SettlementStatus" NOT NULL DEFAULT 'final',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_ledgers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "redemptions" (
    "id" BIGSERIAL NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'quota',
    "quota" BIGINT NOT NULL DEFAULT 0,
    "keyQuota" BIGINT NOT NULL DEFAULT -1,
    "keyModels" JSONB,
    "keyMaxCalls" BIGINT NOT NULL DEFAULT -1,
    "keyName" VARCHAR(64),
    "keyDailyLimit" BIGINT NOT NULL DEFAULT -1,
    "keyTokenLimit" BIGINT NOT NULL DEFAULT -1,
    "keyExpiresAt" TIMESTAMP(3),
    "count" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "usedBy" JSONB,
    "status" "RedemptionStatus" NOT NULL DEFAULT 'active',
    "createdBy" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "top_up_orders" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "tradeNo" VARCHAR(32) NOT NULL,
    "gatewayTradeNo" VARCHAR(64),
    "paymentMethod" VARCHAR(16) NOT NULL,
    "amount" BIGINT NOT NULL DEFAULT 0,
    "money" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "status" "TopUpStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "top_up_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "actorId" BIGINT,
    "actorName" VARCHAR(32),
    "action" VARCHAR(64) NOT NULL,
    "targetType" VARCHAR(32) NOT NULL,
    "targetId" VARCHAR(64),
    "detail" JSONB,
    "ip" VARCHAR(45),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "options" (
    "key" VARCHAR(64) NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "options_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_inviteCode_key" ON "users"("inviteCode");

-- CreateIndex
CREATE INDEX "users_invitedBy_idx" ON "users"("invitedBy");

-- CreateIndex
CREATE INDEX "users_createdBy_idx" ON "users"("createdBy");

-- CreateIndex
CREATE UNIQUE INDEX "plans_name_key" ON "plans"("name");

-- CreateIndex
CREATE INDEX "user_plan_bindings_userId_status_startAt_endAt_idx" ON "user_plan_bindings"("userId", "status", "startAt", "endAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_plan_bindings_userId_planId_startAt_key" ON "user_plan_bindings"("userId", "planId", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "api_keys_userId_status_idx" ON "api_keys"("userId", "status");

-- CreateIndex
CREATE INDEX "api_keys_keyHash_idx" ON "api_keys"("keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "model_aliases_alias_key" ON "model_aliases"("alias");

-- CreateIndex
CREATE INDEX "model_routes_aliasId_priority_idx" ON "model_routes"("aliasId", "priority");

-- CreateIndex
CREATE INDEX "channels_status_priority_idx" ON "channels"("status", "priority");

-- CreateIndex
CREATE INDEX "channel_nodes_channelId_status_idx" ON "channel_nodes"("channelId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "request_logs_requestId_key" ON "request_logs"("requestId");

-- CreateIndex
CREATE INDEX "request_logs_userId_startedAt_idx" ON "request_logs"("userId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "request_logs_apiKeyId_startedAt_idx" ON "request_logs"("apiKeyId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "request_logs_channelId_startedAt_idx" ON "request_logs"("channelId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "usage_ledgers_userId_billingPeriod_idx" ON "usage_ledgers"("userId", "billingPeriod");

-- CreateIndex
CREATE INDEX "usage_ledgers_apiKeyId_billingPeriod_idx" ON "usage_ledgers"("apiKeyId", "billingPeriod");

-- CreateIndex
CREATE UNIQUE INDEX "usage_ledgers_requestId_settlementStatus_key" ON "usage_ledgers"("requestId", "settlementStatus");

-- CreateIndex
CREATE UNIQUE INDEX "redemptions_code_key" ON "redemptions"("code");

-- CreateIndex
CREATE INDEX "redemptions_status_idx" ON "redemptions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "top_up_orders_tradeNo_key" ON "top_up_orders"("tradeNo");

-- CreateIndex
CREATE INDEX "top_up_orders_userId_createdAt_idx" ON "top_up_orders"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_actorId_created_at_idx" ON "audit_logs"("actorId", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_targetType_targetId_idx" ON "audit_logs"("targetType", "targetId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_invitedBy_fkey" FOREIGN KEY ("invitedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_plan_bindings" ADD CONSTRAINT "user_plan_bindings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_plan_bindings" ADD CONSTRAINT "user_plan_bindings_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_routes" ADD CONSTRAINT "model_routes_aliasId_fkey" FOREIGN KEY ("aliasId") REFERENCES "model_aliases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_routes" ADD CONSTRAINT "model_routes_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_nodes" ADD CONSTRAINT "channel_nodes_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "api_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_ledgers" ADD CONSTRAINT "usage_ledgers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_ledgers" ADD CONSTRAINT "usage_ledgers_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "api_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "top_up_orders" ADD CONSTRAINT "top_up_orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
