import { decryptUpstreamSecret } from "../../lib/upstream-secret.js";

export type UpstreamNodeAuth = {
  internalApiKey: string;
  adapter?: string | null;
  authType?: string | null;
};

export function upstreamHeaders(node: UpstreamNodeAuth, requestPath = ""): Record<string, string> {
  const key = decryptUpstreamSecret(node.internalApiKey);
  const authType = node.adapter === "ksyun"
    ? (requestPath.startsWith("/v1/messages") ? "x-api-key" : "bearer")
    : (node.authType || "x-api-key");
  if (authType === "bearer") return { authorization: `Bearer ${key}` };
  if (authType === "both") return { authorization: `Bearer ${key}`, "x-api-key": key };
  return { "x-api-key": key };
}

export function upstreamUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}
