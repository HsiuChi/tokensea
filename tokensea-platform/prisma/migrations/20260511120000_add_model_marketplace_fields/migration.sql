-- AlterTable: add marketplace fields to model_aliases
ALTER TABLE "model_aliases" ADD COLUMN "description" VARCHAR(512);
ALTER TABLE "model_aliases" ADD COLUMN "category" VARCHAR(32) NOT NULL DEFAULT 'chat';
ALTER TABLE "model_aliases" ADD COLUMN "tags" JSONB;
ALTER TABLE "model_aliases" ADD COLUMN "iconUrl" VARCHAR(512);
ALTER TABLE "model_aliases" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Index for category filtering
CREATE INDEX "model_aliases_category_idx" ON "model_aliases"("category");
