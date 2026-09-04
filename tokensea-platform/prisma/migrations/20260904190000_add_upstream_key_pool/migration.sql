ALTER TABLE "channel_nodes"
  ALTER COLUMN "internalApiKey" TYPE TEXT,
  ADD COLUMN "keyFingerprint" VARCHAR(64),
  ADD COLUMN "keyPrefix" VARCHAR(24),
  ADD COLUMN "adapter" VARCHAR(32) NOT NULL DEFAULT 'dario',
  ADD COLUMN "authType" VARCHAR(32) NOT NULL DEFAULT 'x-api-key';

CREATE UNIQUE INDEX "channel_nodes_channelId_keyFingerprint_key"
  ON "channel_nodes"("channelId", "keyFingerprint");
