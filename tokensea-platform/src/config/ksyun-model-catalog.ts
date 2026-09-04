export interface KsyunModelDefinition {
  id: string;
  displayName: string;
  provider: "deepseek" | "moonshot" | "qwen" | "zhipu" | "xiaomi" | "volcengine" | "kling" | "minimax";
  inputPrice: number;
  outputPrice: number;
  cacheReadPrice?: number;
  maxContext: number;
  supportsVision?: boolean;
  supportsStream?: boolean;
  supportsTools?: boolean;
  category?: "chat" | "vision" | "video" | "image" | "audio";
  description?: string;
}

// Current KSP text-model catalogue selected for TokenSea. Prices are the first
// public CNY / 1M-token tier and are also retained in `pricing` for audit/UI.
export const KSYUN_MODELS: KsyunModelDefinition[] = [
  { id: "deepseek-v4-pro-0813", displayName: "DeepSeek V4 Pro", provider: "deepseek", inputPrice: 9, outputPrice: 27, cacheReadPrice: 0.3, maxContext: 1_000_000 },
  { id: "deepseek-v4-flash", displayName: "DeepSeek V4 Flash", provider: "deepseek", inputPrice: 3, outputPrice: 9, cacheReadPrice: 0.1, maxContext: 1_000_000 },
  { id: "kimi-k3", displayName: "Kimi K3", provider: "moonshot", inputPrice: 20, outputPrice: 100, cacheReadPrice: 2, maxContext: 1_000_000 },
  { id: "kimi-k2.7-code-highspeed", displayName: "Kimi K2.7 Code Highspeed", provider: "moonshot", inputPrice: 13, outputPrice: 54, cacheReadPrice: 2.6, maxContext: 256_000 },
  { id: "kimi-k2.7-code", displayName: "Kimi K2.7 Code", provider: "moonshot", inputPrice: 6.5, outputPrice: 27, cacheReadPrice: 1.3, maxContext: 256_000 },
  { id: "kimi-k2.6", displayName: "Kimi K2.6", provider: "moonshot", inputPrice: 6.5, outputPrice: 27, cacheReadPrice: 1.1, maxContext: 262_100 },
  { id: "glm-5.3-flash", displayName: "GLM 5.3 Flash", provider: "zhipu", inputPrice: 0, outputPrice: 0, maxContext: 1_000_000 },
  { id: "glm-5.3", displayName: "GLM 5.3", provider: "zhipu", inputPrice: 8, outputPrice: 28, cacheReadPrice: 2, maxContext: 1_000_000 },
  { id: "glm-5-turbo", displayName: "GLM 5 Turbo", provider: "zhipu", inputPrice: 5, outputPrice: 22, cacheReadPrice: 1.2, maxContext: 200_000 },
  { id: "glm-5.2", displayName: "GLM 5.2", provider: "zhipu", inputPrice: 8, outputPrice: 28, cacheReadPrice: 2, maxContext: 1_000_000 },
  { id: "mimo-v2.5", displayName: "MiMo V2.5", provider: "xiaomi", inputPrice: 2.8, outputPrice: 14, cacheReadPrice: 0.56, maxContext: 1_000_000 },
  { id: "mimo-v2.5-pro", displayName: "MiMo V2.5 Pro", provider: "xiaomi", inputPrice: 7, outputPrice: 21, cacheReadPrice: 1.4, maxContext: 1_000_000 },
  { id: "seedance-2.5", displayName: "Seedance 2.5", provider: "volcengine", category: "video", description: "可原生生成最长 30 秒视频，支持多素材参考、音视频同步与局部编辑。", inputPrice: 0, outputPrice: 0, maxContext: 0, supportsStream: false, supportsTools: false, supportsVision: true },
  { id: "seedance-2.0-o", displayName: "Seedance 2.0 O", provider: "volcengine", category: "video", description: "支持最高 15 秒 2K 视频生成，兼顾音视频同步与角色一致性。", inputPrice: 0, outputPrice: 0, maxContext: 0, supportsStream: false, supportsTools: false, supportsVision: true },
  { id: "seedance-2.0-domestic", displayName: "Seedance 2.0", provider: "volcengine", category: "video", description: "统一多模态音视频生成模型，支持文字、图片、音频和视频参考。", inputPrice: 0, outputPrice: 0, maxContext: 0, supportsStream: false, supportsTools: false, supportsVision: true },
  { id: "kling-v3", displayName: "可灵 Kling V3", provider: "kling", category: "video", description: "支持高质量文生视频与图生视频，具备较强的画面一致性和动态表现能力。", inputPrice: 0, outputPrice: 0, maxContext: 0, supportsStream: false, supportsTools: false, supportsVision: true },
  { id: "kling-v3-omni", displayName: "可灵 Kling V3 Omni", provider: "kling", category: "video", description: "支持多模态输入、角色一致性与音画同步的视频生成模型。", inputPrice: 0, outputPrice: 0, maxContext: 0, supportsStream: false, supportsTools: false, supportsVision: true },
  { id: "hailuo-2.3", displayName: "海螺 Hailuo 2.3", provider: "minimax", category: "video", description: "面向复杂场景与镜头表达的高质量视频生成模型。", inputPrice: 0, outputPrice: 0, maxContext: 0, supportsStream: false, supportsTools: false, supportsVision: true },
  { id: "hailuo-2.3-fast", displayName: "海螺 Hailuo 2.3 Fast", provider: "minimax", category: "video", description: "兼顾画质和生成速度，适合实时生成与高并发任务。", inputPrice: 0, outputPrice: 0, maxContext: 0, supportsStream: false, supportsTools: false, supportsVision: true },
  { id: "hailuo-02", displayName: "海螺 Hailuo 02", provider: "minimax", category: "video", description: "具有良好画面真实度与时序一致性的视频生成模型。", inputPrice: 0, outputPrice: 0, maxContext: 0, supportsStream: false, supportsTools: false, supportsVision: true },
];

export const KSYUN_DEFAULT_MODEL_IDS = KSYUN_MODELS.map((model) => model.id);
