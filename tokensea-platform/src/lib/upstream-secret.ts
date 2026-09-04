import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "enc:v1";

function encryptionKeys(): Buffer[] {
  const secrets = [process.env.UPSTREAM_KEY_ENCRYPTION_SECRET, process.env.JWT_SECRET].filter(
    (secret, index, all): secret is string => Boolean(secret) && all.indexOf(secret) === index,
  );
  if (!secrets.length) throw new Error("UPSTREAM_KEY_ENCRYPTION_SECRET or JWT_SECRET is required");
  return secrets.map((secret) => createHash("sha256").update(secret).digest());
}

export function encryptUpstreamSecret(value: string): string {
  if (value.startsWith(`${PREFIX}:`)) return value;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKeys()[0], iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(":");
}

export function decryptUpstreamSecret(value: string): string {
  if (!value.startsWith(`${PREFIX}:`)) return value; // legacy plaintext rows
  const [, , ivValue, tagValue, ciphertext] = value.split(":");
  if (!ivValue || !tagValue || !ciphertext) throw new Error("Invalid encrypted upstream secret");
  for (const key of encryptionKeys()) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64url"));
      decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
    } catch {
      // Try the JWT fallback so a dedicated key can be introduced after migration.
    }
  }
  throw new Error("Unable to decrypt upstream secret with configured keys");
}

export function upstreamSecretFingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function maskUpstreamSecret(value: string): string {
  const clean = value.trim();
  if (clean.length <= 10) return `${clean.slice(0, 3)}••••`;
  return `${clean.slice(0, 7)}••••${clean.slice(-4)}`;
}
