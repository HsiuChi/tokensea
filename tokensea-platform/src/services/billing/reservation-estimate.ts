import { badRequest } from "../../lib/errors.js";
import { calculateTokenPrice } from "./token-pricing.js";
import { quoteVideo } from "./video-pricing.js";

const IMAGE_SOURCE = "https://developers.openai.com/api/docs/guides/image-generation";
// Official rounded output-only USD estimates, NOT the older GPT Image 1 token table.
const IMAGE_2_OUTPUT: Record<string, Record<string, number>> = {
  "1024x1024": { low: 0.006, medium: 0.053, high: 0.211 },
  "1024x1536": { low: 0.005, medium: 0.041, high: 0.165 },
  "1536x1024": { low: 0.005, medium: 0.041, high: 0.165 },
};

function positiveInteger(value: unknown, fallback: number, maximum: number, name: string) {
  const n = Number(value ?? fallback);
  if (!Number.isSafeInteger(n) || n < 1 || n > maximum) throw badRequest(`Invalid ${name}`);
  return n;
}

// Do not tokenize URL/base64 bytes as text, and never fetch remote inputs to quote a request.
function inspectInput(body: any) {
  let images = 0, opaque = false, blocks = 0;
  const visit = (value: any): any => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    blocks++;
    if (value.type === "image_url" || value.type === "input_image" || (value.type === "image" && value.source)) {
      images++;
      return { type: "image" };
    }
    if (["input_audio", "input_file", "file"].includes(value.type) || value.file_id || value.file_url) opaque = true;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      if (key === "input_audio") { opaque = true; return [key, "[audio]"]; }
      return [key, visit(item)];
    }));
  };
  // Only prompt-bearing fields; model names, sampling options, and output caps aren't prompt tokens.
  const prompt = visit({ messages: body.messages, input: body.input, prompt: body.prompt,
    instructions: body.instructions, system: body.system, tools: body.tools,
    response_format: body.response_format, text: body.text, images: body.images });
  if (images > 64) throw badRequest("Too many input images");
  return { textTokens: Buffer.byteLength(JSON.stringify(prompt), "utf8") + 64 + blocks * 16, images, opaque };
}

/** Temporary hold estimate only. Final settlement always uses reported usage and frozen tariffs. */
export function quoteReservation(alias: any, body: any, planMultiplier = 1, channelMultiplier = 1, image = false) {
  if (alias.category === "video") return quoteVideo(alias.alias, body, Number(alias.pricing?.cnyPerUsd ?? process.env.KSYUN_CNY_PER_USD ?? 7.2), planMultiplier, channelMultiplier, alias.pricing?.saleMultiplier ?? 1);
  const rates = [alias.inputPrice, alias.outputPrice, alias.cacheReadPrice ?? 0, alias.cacheWrite5mPrice ?? 0,
    alias.cacheWrite1hPrice ?? 0, alias.pricing?.imageInputPrice ?? 0, planMultiplier, channelMultiplier];
  if (rates.some(price => !Number.isFinite(price) || price < 0)) throw badRequest("Invalid billing configuration");
  const n = positiveInteger(body.n, 1, 10, "n");
  const input = inspectInput(body);
  const assumptions: string[] = ["Input text uses UTF-8 bytes plus message overhead, not exact tokenization"];
  let outputTokens: number;
  if (image) {
    if (alias.alias !== "gpt-image-2") throw badRequest("Image reservation pricing is not configured for this model");
    const quality = body.quality ?? "auto", size = body.size ?? "auto";
    if (!["low", "medium", "high", "auto"].includes(quality)) throw badRequest("Invalid image quality");
    const tier = quality === "auto" ? "high" : quality;
    let outputUsd: number;
    if (size === "auto") {
      outputUsd = Math.max(...Object.values(IMAGE_2_OUTPUT).map(row => row[tier]));
      assumptions.push("Auto size uses the highest common-size estimate; explicit size gives a more precise hold");
    } else if (IMAGE_2_OUTPUT[size]) outputUsd = IMAGE_2_OUTPUT[size][tier];
    else {
      const dimensions = /^(\d+)x(\d+)$/.exec(size);
      if (!dimensions) throw badRequest("Invalid image size");
      const width = Number(dimensions[1]), height = Number(dimensions[2]);
      if (width < 64 || height < 64 || width > 8192 || height > 8192 || width * height > 36000000) throw badRequest("Image size exceeds reservation estimate limits");
      outputUsd = IMAGE_2_OUTPUT["1024x1024"][tier] * Math.max(1, width * height / 1048576);
      assumptions.push("Custom-size hold is a pixel-scaled estimate, not an official fixed quote");
    }
    if (quality === "auto") assumptions.push("Auto quality reserves the high-quality tier");
    // Rounded table + observed variation: add 25% and half a millidollar rounding allowance.
    // Convert at the table's official $30/M output rate, then price at the configured tariff.
    outputTokens = Math.ceil((outputUsd + 0.0005) * 1.25 / 30 * 1e6) * n;
    assumptions.push("Output estimate includes a 25% margin; unused funds are released at settlement");
  } else outputTokens = positiveInteger(body.max_completion_tokens ?? body.max_output_tokens ?? body.max_tokens, 4096, 1048576, "output token limit") * n;

  let inputTokens = input.textTokens;
  const imageInputTokens = input.images * 4096;
  if (input.images) assumptions.push("Input images estimated at 4096 tokens each; actual usage may differ");
  if (input.opaque) {
    inputTokens = Math.max(inputTokens, alias.maxContext || 200000);
    assumptions.push("Unresolved file/audio input retains a conservative context estimate");
  }
  const normalized = { ...alias, cacheReadPrice: alias.cacheReadPrice ?? 0, cacheWrite5mPrice: alias.cacheWrite5mPrice ?? 0,
    inputPrice: Math.max(alias.inputPrice, alias.cacheReadPrice ?? 0, alias.cacheWrite5mPrice ?? 0, alias.cacheWrite1hPrice ?? 0) };
  const usage = { inputTokens, imageInputTokens, outputTokens, cacheReadTokens: 0, cacheCreationTokens: 0 };
  const price = calculateTokenPrice(normalized, usage, planMultiplier, channelMultiplier);
  const usd = price.detail.totalUsd * planMultiplier * channelMultiplier;
  if (!Number.isFinite(usd) || usd < 0 || usd * 1e6 > Number.MAX_SAFE_INTEGER) throw badRequest("Invalid reservation estimate");
  return { amount: BigInt(Math.ceil(usd * 1e6)), detail: { version: 2, kind: image ? "image" : "text", currency: "USD",
    estimatedUsd: Math.ceil(usd * 1e6) / 1e6, usage, size: image ? body.size ?? "auto" : undefined,
    quality: image ? body.quality ?? "auto" : undefined, n, planMultiplier, channelMultiplier,
    source: image ? IMAGE_SOURCE : null, assumptions, finalCharge: "reported_usage" } };
}
