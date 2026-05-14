import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { randomBytes, createHmac } from "crypto";
import { notFound, badRequest, unauthorized } from "../../lib/errors.js";

const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf: Buffer): string {
  let bits = "";
  for (const byte of buf) bits += byte.toString(2).padStart(8, "0");
  let result = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    result += BASE32_CHARS[parseInt(bits.slice(i, i + 5), 2)];
  }
  return result;
}

function generateTOTP(secret: string, timeStep = 30, digits = 6): string {
  const key = Buffer.from(secret, "base64");
  const counter = Math.floor(Date.now() / 1000 / timeStep);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter & 0xffffffff, 4);

  const hmac = createHmac("sha1", key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24 | (hmac[offset + 1] & 0xff) << 16 | (hmac[offset + 2] & 0xff) << 8 | (hmac[offset + 3] & 0xff)) % (10 ** digits);
  return code.toString().padStart(digits, "0");
}

function verifyTOTP(secret: string, code: string, window = 1): boolean {
  for (let i = -window; i <= window; i++) {
    // Adjust time step by shifting
    const key = Buffer.from(secret, "base64");
    const counter = Math.floor(Date.now() / 1000 / 30) + i;
    const counterBuf = Buffer.alloc(8);
    counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
    counterBuf.writeUInt32BE(counter & 0xffffffff, 4);
    const hmac = createHmac("sha1", key).update(counterBuf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const expected = ((hmac[offset] & 0x7f) << 24 | (hmac[offset + 1] & 0xff) << 16 | (hmac[offset + 2] & 0xff) << 8 | (hmac[offset + 3] & 0xff)) % 1000000;
    if (expected.toString().padStart(6, "0") === code) return true;
  }
  return false;
}

function generateRecoveryCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    codes.push(randomBytes(4).toString("hex").toUpperCase());
  }
  return codes;
}

export class TotpService {
  constructor(private prisma: PrismaClient) {}

  /** Generate a new TOTP secret for a user (does not enable yet) */
  async setup(userId: bigint) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw notFound("User not found");
    if (user.totpEnabled) throw badRequest("2FA is already enabled");

    const secret = randomBytes(20).toString("base64");
    const secretBase32 = base32Encode(Buffer.from(secret, "base64"));

    // Store secret temporarily (not yet enabled)
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: secret },
    });

    const issuer = "TokenSea";
    const accountName = user.email || user.username;
    const otpAuthUrl = `otpauth://totp/${issuer}:${accountName}?secret=${secretBase32}&issuer=${issuer}`;

    return { secret: secretBase32, otpAuthUrl };
  }

  /** Enable 2FA after verifying the user can generate valid codes */
  async enable(userId: bigint, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw notFound("User not found");
    if (user.totpEnabled) throw badRequest("2FA is already enabled");
    if (!user.totpSecret) throw badRequest("2FA not set up yet — call setup first");

    if (!verifyTOTP(user.totpSecret, code)) {
      throw badRequest("Invalid verification code");
    }

    const recoveryCodes = generateRecoveryCodes();

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        totpEnabled: true,
        recoveryCodes,
      },
    });

    return { recoveryCodes };
  }

  /** Disable 2FA (requires password or recovery code) */
  async disable(userId: bigint, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw notFound("User not found");
    if (!user.totpEnabled) throw badRequest("2FA is not enabled");

    // Accept TOTP code or recovery code
    const recoveryCodes = (user.recoveryCodes as string[]) ?? [];
    const isRecoveryCode = recoveryCodes.includes(code.toUpperCase());

    if (!isRecoveryCode && !verifyTOTP(user.totpSecret!, code)) {
      throw badRequest("Invalid verification code");
    }

    // If recovery code used, remove it from the list
    let newRecoveryCodes = recoveryCodes;
    if (isRecoveryCode) {
      newRecoveryCodes = recoveryCodes.filter(c => c !== code.toUpperCase());
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        totpEnabled: false,
        totpSecret: null,
        recoveryCodes: newRecoveryCodes.length > 0 ? newRecoveryCodes : Prisma.JsonNull,
      },
    });

    return { message: "2FA disabled" };
  }

  /** Verify a TOTP code — used during login */
  async verify(userId: bigint, code: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.totpEnabled || !user.totpSecret) return false;

    // Check TOTP code
    if (verifyTOTP(user.totpSecret, code)) return true;

    // Check recovery codes
    const recoveryCodes = (user.recoveryCodes as string[]) ?? [];
    const normalizedCode = code.toUpperCase();
    if (recoveryCodes.includes(normalizedCode)) {
      // Remove used recovery code
      const remaining = recoveryCodes.filter(c => c !== normalizedCode);
      await this.prisma.user.update({
        where: { id: userId },
        data: { recoveryCodes: remaining.length > 0 ? remaining : Prisma.JsonNull },
      });
      return true;
    }

    return false;
  }
}
