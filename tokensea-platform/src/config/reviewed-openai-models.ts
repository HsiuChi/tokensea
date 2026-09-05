/** Standard API reference prices verified 2026-09-05. Does not modify existing model prices. */
export const REVIEWED_OPENAI_MODELS = [
  {
    alias: "gpt-6-astra", displayName: "GPT-6 Astra", provider: "openai", category: "chat",
    description: "面向复杂推理、编程与长流程任务。支持文本与图像输入，文本输出。",
    inputPrice: 10, outputPrice: 50, cacheReadPrice: 1, cacheWrite5mPrice: 12.5,
    supportsStream: true, supportsTools: true, supportsVision: true, maxContext: 1050000,
    pricing: { source: "OpenAI Standard", sourceUrl: "https://developers.openai.com/api/docs/models/gpt-6-astra", verifiedAt: "2026-09-05", currency: "USD", unit: "1M tokens", reviewRequired: false, longContext: { threshold: 272000, inputMultiplier: 2, outputMultiplier: 1.5 } },
  },
  {
    alias: "gpt-image-2", displayName: "GPT Image 2", provider: "openai", category: "image",
    description: "高质量图像生成与编辑。按文字输入、图片输入及图片输出 Tokens 分别计费。",
    inputPrice: 5, outputPrice: 30, cacheReadPrice: 1.25, cacheWrite5mPrice: 0,
    supportsStream: false, supportsTools: false, supportsVision: true, maxContext: 0,
    pricing: { source: "OpenAI Standard", sourceUrl: "https://developers.openai.com/api/docs/pricing", verifiedAt: "2026-09-05", currency: "USD", unit: "1M tokens", reviewRequired: false, imageInputPrice: 8, imageCacheReadPrice: 2 },
  },
];
