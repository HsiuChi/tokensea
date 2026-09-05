BEGIN;
ALTER TABLE "api_keys" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE TABLE "billing_reservations" (
  "requestId" VARCHAR(36) PRIMARY KEY, "userId" BIGINT NOT NULL, "apiKeyId" BIGINT NOT NULL,
  "keyGroupId" BIGINT, "amount" BIGINT NOT NULL CHECK ("amount" >= 0), "charged" BIGINT NOT NULL DEFAULT 0 CHECK ("charged" >= 0),
  "status" VARCHAR(20) NOT NULL DEFAULT 'reserved' CHECK ("status" IN ('reserved','pending','settled','released','review')),
  "pricing" JSONB NOT NULL, "payload" JSONB, "reason" VARCHAR(128),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("apiKeyId") REFERENCES "api_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("keyGroupId") REFERENCES "key_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX ON "billing_reservations" ("userId", "status");
CREATE INDEX ON "billing_reservations" ("apiKeyId", "status");
CREATE INDEX ON "billing_reservations" ("keyGroupId", "status");
CREATE TABLE "billing_baselines" (
  "scope" VARCHAR(10) NOT NULL, "accountId" BIGINT NOT NULL, "openingUsed" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY ("scope", "accountId")
);
INSERT INTO "billing_baselines" ("scope", "accountId", "openingUsed") SELECT 'user', "id", "usedQuota" FROM "users";
INSERT INTO "billing_baselines" ("scope", "accountId", "openingUsed") SELECT 'key', "id", "usedQuota" FROM "api_keys";
INSERT INTO "billing_baselines" ("scope", "accountId", "openingUsed") SELECT 'group', "id", "usedQuota" FROM "key_groups";

COMMIT;
