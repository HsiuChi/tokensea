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
    : node.adapter === "cpa" ? "bearer" : (node.authType || "x-api-key");
  if (authType === "bearer") return { authorization: `Bearer ${key}` };
  if (authType === "both") return { authorization: `Bearer ${key}`, "x-api-key": key };
  return { "x-api-key": key };
}

export function upstreamUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

/** CPA health requires accepted credentials and a valid model catalogue. */
export async function probeCpa(node: UpstreamNodeAuth & { internalUrl: string; probeTimeoutMs?: number | null }) {
  const start = Date.now();
  const response = await fetch(upstreamUrl(node.internalUrl, "/v1/models"), {
    headers: upstreamHeaders(node, "/v1/models"),
    signal: AbortSignal.timeout(node.probeTimeoutMs ?? 10000),
  });
  const body = await response.json().catch(() => null) as any;
  const valid = response.ok && Array.isArray(body?.data) && body.data.every((m: any) => typeof m?.id === "string" && m.id.length > 0 && m.id.length <= 64);
  return { healthy: valid && body.data.length > 0, valid, models: valid ? body.data as { id: string; owned_by?: string }[] : [], latency: Date.now() - start, status: response.status };
}
