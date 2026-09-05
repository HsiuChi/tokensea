import { badRequest } from "../../lib/errors.js";

export const VIDEO_PRICE_SOURCE = "https://docs.ksyun.com/documents/44741";
export const VIDEO_PRICE_VERSION = "ksyun-2026-08-26";
const HAILUO: Record<string, Record<string, number>> = {
  "hailuo-2.3-fast": { "768P:6": 1.35, "768P:10": 2.25, "1080P:6": 2.31 },
  "hailuo-2.3": { "768P:6": 2, "768P:10": 4, "1080P:6": 3.5 },
  "hailuo-02": { "512P:6": 0.6, "512P:10": 1, "768P:6": 2, "768P:10": 4, "1080P:6": 3.5 },
};

function allow(body: any, keys: string[]) {
  const unknown = Object.keys(body).filter(k => !keys.includes(k));
  if (unknown.length) throw badRequest("Video parameters not yet reviewed for billing: " + unknown.join(", "));
}
function duration(value: any, fallback: number, min: number, max: number) {
  const n = Number(value ?? fallback);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw badRequest("Invalid video duration");
  return n;
}

/** Prices are the actual KSP upstream rate card, not another provider's converted prices. */
export function quoteVideo(model: string, body: any, cnyPerUsd: number, planMultiplier = 1, channelMultiplier = 1) {
  if ([cnyPerUsd, planMultiplier, channelMultiplier].some(n => !Number.isFinite(n) || n < 0) || cnyPerUsd === 0) throw badRequest("Invalid video currency conversion or multiplier");
  let family: "seedance" | "kling" | "hailuo", path: string, upstreamBody: any;
  let baseCny: number, rateCny = 0, estimatedTokens = 0;
  let unit: "second" | "video" | "1M tokens", seconds: number;
  const assumptions: string[] = [];
  if (model === "kling-v3" || model === "kling-v3-omni") {
    allow(body, ["model", "model_name", "prompt", "negative_prompt", "duration", "mode", "sound", "aspect_ratio", "image", "image_tail"]);
    family = "kling"; unit = "second"; seconds = duration(body.duration, 5, 3, 15);
    const mode = body.mode ?? "std", sound = body.sound ?? "off";
    if (!["std", "pro"].includes(mode) || !["on", "off"].includes(sound)) throw badRequest("Invalid Kling mode or sound");
    const omni = model.endsWith("omni");
    rateCny = mode === "std" ? (sound === "on" ? (omni ? 0.8 : 0.9) : 0.6) : (sound === "on" ? (omni ? 1 : 1.2) : 0.8);
    if (omni && (body.image || body.image_tail)) throw badRequest("Omni reference inputs require separate billing validation");
    path = omni ? "v1/videos/omni-video" : body.image ? "v1/videos/image2video" : "v1/videos/text2video";
    upstreamBody = { ...body, model_name: model, duration: String(seconds), mode, sound };
    delete upstreamBody.model;
    baseCny = seconds * rateCny;
  } else if (HAILUO[model]) {
    allow(body, ["model", "prompt", "duration", "resolution", "first_frame_image", "last_frame_image", "prompt_optimizer"]);
    family = "hailuo"; unit = "video"; seconds = duration(body.duration, 6, 6, 10);
    const resolution = String(body.resolution ?? "768P").toUpperCase();
    baseCny = HAILUO[model][resolution + ":" + seconds];
    if (baseCny === undefined) throw badRequest("No verified Hailuo price for this resolution/duration");
    if (resolution === "512P" && !body.first_frame_image) throw badRequest("Hailuo 512P requires a first-frame image");
    if (model === "hailuo-2.3-fast" && !body.first_frame_image) throw badRequest("Hailuo Fast requires a first-frame image");
    path = "v1/video_generation";
    upstreamBody = { ...body, model, duration: seconds, resolution };
  } else if (model === "seedance-2.0-domestic" || model === "seedance-2.5") {
    allow(body, ["model", "content", "duration", "resolution", "ratio", "generate_audio", "watermark", "seed"]);
    family = "seedance"; unit = "1M tokens"; seconds = duration(body.duration, 5, 4, 15);
    const resolution = body.resolution ?? "720p", ratio = body.ratio ?? "16:9";
    if (!["480p", "720p", "1080p"].includes(resolution) || !["16:9", "9:16", "1:1", "4:3", "3:4"].includes(ratio)) throw badRequest("Video resolution/ratio is not yet supported for billing");
    if (!Array.isArray(body.content) || !body.content.length || body.content.some((c: any) => !["text", "image_url"].includes(c.type))) throw badRequest("Seedance currently accepts text/image references; video/audio references require separate billing validation");
    if (JSON.stringify(body.content).match(/--(?:duration|dur|resolution|rs|fps|ratio)\b/i)) throw badRequest("Use structured video parameters instead of inline parameter flags");
    rateCny = model === "seedance-2.5" ? (resolution === "1080p" ? 77 : 70) : (resolution === "1080p" ? 51 : 46);
    const pixels = resolution === "1080p" ? 1920 * 1080 : resolution === "720p" ? 1280 * 720 : 854 * 480;
    estimatedTokens = Math.ceil(seconds * pixels * 24 / 1024 * 1.25);
    baseCny = estimatedTokens / 1e6 * rateCny;
    assumptions.push("Pixel/frame formula with 25% margin is a hold estimate; settle only from positive reported video usage");
    path = "v3/contents/generations/tasks";
    upstreamBody = { ...body, model, duration: seconds, resolution, ratio };
  } else throw badRequest("Video model has no verified billing adapter: " + model);
  const estimatedUsd = Math.ceil(baseCny / cnyPerUsd * planMultiplier * channelMultiplier * 1e6) / 1e6;
  if (!Number.isSafeInteger(Math.round(estimatedUsd * 1e6))) throw badRequest("Video estimate exceeds billing limits");
  return { amount: BigInt(Math.round(estimatedUsd * 1e6)), detail: {
    version: 1, kind: "video" as const, priceVersion: VIDEO_PRICE_VERSION, source: VIDEO_PRICE_SOURCE,
    currency: "USD", upstreamCurrency: "CNY", cnyPerUsd, model, family, path, unit, seconds, rateCny,
    baseCny, estimatedTokens, estimatedUsd, planMultiplier, channelMultiplier, assumptions,
    parameters: { duration: seconds, resolution: upstreamBody.resolution, mode: upstreamBody.mode, sound: upstreamBody.sound },
  }, upstreamBody };
}

export function videoSettlement(quote: any, usageTokens?: number) {
  let upstreamCny = quote.baseCny;
  if (quote.unit === "1M tokens") {
    if (!Number.isSafeInteger(usageTokens) || usageTokens! <= 0 || usageTokens! > 2147483647) throw badRequest("Missing or invalid final video usage; reservation retained");
    upstreamCny = usageTokens! / 1e6 * quote.rateCny;
  }
  const usd = upstreamCny / quote.cnyPerUsd * quote.planMultiplier * quote.channelMultiplier;
  if (!Number.isFinite(usd) || usd < 0 || usd * 1e6 > Number.MAX_SAFE_INTEGER) throw badRequest("Invalid final video price");
  const billableUnits = BigInt(Math.round(usd * 1e6));
  return { billableUnits, detail: { ...quote, upstreamCny, videoTokens: usageTokens ?? null,
    totalUsd: upstreamCny / quote.cnyPerUsd, billingMultiplier: quote.planMultiplier * quote.channelMultiplier,
    costUsd: Number(billableUnits) / 1e6, actual: true } };
}
