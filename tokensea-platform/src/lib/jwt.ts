import jwt from "jsonwebtoken";
import type { Env } from "../config/env.js";

export interface JwtPayload {
  userId: bigint;
  role: string;
}

export function signToken(payload: JwtPayload, secret: string, expiresIn: string): string {
  return jwt.sign(
    { userId: payload.userId.toString(), role: payload.role },
    secret,
    { expiresIn: expiresIn as any },
  );
}

export function verifyToken(token: string, secret: string): JwtPayload {
  const decoded = jwt.verify(token, secret) as { userId: string; role: string };
  return {
    userId: BigInt(decoded.userId),
    role: decoded.role,
  };
}
