-- AlterTable
ALTER TABLE "users" ADD COLUMN     "emailVerifyToken" VARCHAR(64),
ADD COLUMN     "emailVerifyTokenExpires" TIMESTAMP(3),
ADD COLUMN     "resetToken" VARCHAR(64),
ADD COLUMN     "resetTokenExpires" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "announcements" (
    "id" BIGSERIAL NOT NULL,
    "title" VARCHAR(128) NOT NULL,
    "content" TEXT NOT NULL,
    "type" VARCHAR(16) NOT NULL DEFAULT 'info',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "announcements_status_pinned_createdAt_idx" ON "announcements"("status", "pinned", "createdAt" DESC);
