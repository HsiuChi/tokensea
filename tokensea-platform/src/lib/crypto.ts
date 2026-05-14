import { randomBytes, createHash } from "crypto";

export function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const bytes = randomBytes(24);
  const hex = bytes.toString("hex");
  const raw = `tsk-${hex}`;
  const prefix = raw.slice(0, 8);
  const hash = sha256(raw);
  return { raw, prefix, hash };
}

export function hashApiKey(key: string): string {
  return sha256(key);
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function generateInviteCode(): string {
  return randomBytes(6).toString("hex").slice(0, 12).toUpperCase();
}

export function generateRedemptionCode(): string {
  return `TS-${randomBytes(8).toString("hex").toUpperCase().slice(0, 16)}`;
}
