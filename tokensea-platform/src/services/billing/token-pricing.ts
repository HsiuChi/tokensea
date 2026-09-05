export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  imageInputTokens?: number;
  imageCacheReadTokens?: number;
}

/** OpenAI input usage includes cache hits; store disjoint buckets to avoid double billing. */
export function openAiUsage(u: any = {}): TokenUsage {
  const input = u.prompt_tokens ?? u.input_tokens ?? 0;
  const details = u.prompt_tokens_details ?? u.input_tokens_details ?? {};
  const cached = Math.min(input, details.cached_tokens ?? 0);
  const image = Math.min(input, details.image_tokens ?? 0);
  const imageCached = Math.min(image, details.cached_tokens_details?.image_tokens ?? 0);
  return {
    inputTokens: Math.max(0, input - cached - image + imageCached),
    outputTokens: u.completion_tokens ?? u.output_tokens ?? 0,
    cacheCreationTokens: 0,
    cacheReadTokens: Math.max(0, cached - imageCached),
    imageInputTokens: Math.max(0, image - imageCached),
    imageCacheReadTokens: imageCached,
  };
}

export function calculateTokenPrice(alias: any, usage: TokenUsage, planMultiplier = 1, channelMultiplier = 1) {
  const rules = alias.pricing ?? {};
  const inputTotal = usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens + (usage.imageInputTokens ?? 0) + (usage.imageCacheReadTokens ?? 0);
  const long = rules.longContext && inputTotal > rules.longContext.threshold;
  const inputFactor = long ? rules.longContext.inputMultiplier : 1;
  const outputFactor = long ? rules.longContext.outputMultiplier : 1;
  const inputPrice = alias.inputPrice * inputFactor;
  const cacheReadPrice = alias.cacheReadPrice * inputFactor;
  const cacheWrite5mPrice = alias.cacheWrite5mPrice * inputFactor;
  const outputPrice = alias.outputPrice * outputFactor;
  const imageInputPrice = rules.imageInputPrice ?? alias.inputPrice;
  const imageCacheReadPrice = rules.imageCacheReadPrice ?? alias.cacheReadPrice;
  const inputCostUsd = usage.inputTokens * inputPrice / 1e6;
  const cacheReadCostUsd = usage.cacheReadTokens * cacheReadPrice / 1e6;
  const cacheWriteCostUsd = usage.cacheCreationTokens * cacheWrite5mPrice / 1e6;
  const outputCostUsd = usage.outputTokens * outputPrice / 1e6;
  const imageInputCostUsd = (usage.imageInputTokens ?? 0) * imageInputPrice / 1e6;
  const imageCacheReadCostUsd = (usage.imageCacheReadTokens ?? 0) * imageCacheReadPrice / 1e6;
  const totalUsd = inputCostUsd + cacheReadCostUsd + cacheWriteCostUsd + outputCostUsd + imageInputCostUsd + imageCacheReadCostUsd;
  const billingMultiplier = planMultiplier * channelMultiplier;
  const billableUnits = BigInt(Math.round(totalUsd * billingMultiplier * 1e6));
  return { billableUnits, detail: {
    version: 2, currency: "USD", unit: "1M tokens", ...usage,
    inputPrice, cacheReadPrice, cacheWrite5mPrice, outputPrice, imageInputPrice, imageCacheReadPrice,
    inputCostUsd, cacheReadCostUsd, cacheWriteCostUsd, outputCostUsd, imageInputCostUsd, imageCacheReadCostUsd,
    totalUsd, planMultiplier, channelMultiplier, billingMultiplier,
    costUsd: Number(billableUnits) / 1e6, longContext: !!long,
    tokenAccounting: "disjoint", source: rules.sourceUrl ?? null,
  }};
}
