export function errorExplanation(log: { status: string; httpStatus?: number | null; errorCode?: string | null }) {
  if (log.status === "succeeded") return null;
  if (/quota|balance|credit|resource_exhausted/.test(log.errorCode ?? "")) return "上游额度或余额不足，请联系管理员检查资源。";
  if (log.errorCode === "temperature_unsupported") return "此模型不支持当前 temperature 参数，请移除该参数或使用模型允许的默认值。";
  if (log.errorCode === "context_length_exceeded") return "输入超过模型上下文限制，请缩短消息或减少附件内容。";
  if (log.httpStatus === 429) return "上游限流（429）；也可能涉及账户额度，请结合错误代码排查，稍后重试。";
  if (log.httpStatus === 401 || log.httpStatus === 403) return "上游认证或模型访问权限被拒绝。";
  if (log.httpStatus === 408 || log.status === "timeout") return "请求超时。";
  if (log.errorCode === "stream_interrupted") return "流式响应中断；如已产生 Tokens，将按已返回用量结算。";
  if ((log.httpStatus ?? 0) >= 500) return "上游服务异常或没有可用节点。";
  return "请求未成功，请核对模型、参数和 HTTP 状态；历史记录可能没有保存详细错误代码。";
}

export function safeErrorCode(text: string, status: number) {
  try {
    const code = JSON.parse(text)?.error?.code;
    if (typeof code === "string" && /^[a-zA-Z0-9_.-]{1,32}$/.test(code)) return code;
  } catch {}
  if (/temperature/i.test(text) && /unsupported|not supported|不可变|仅允许|default|默认/i.test(text)) return "temperature_unsupported";
  if (/context_length_exceeded|maximum context length/i.test(text)) return "context_length_exceeded";
  if (/insufficient_quota|quota.exhaust|insufficient.balance/i.test(text)) return "upstream_quota_exhausted";
  return "upstream_" + status;
}

export function csvCell(value: unknown) {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
