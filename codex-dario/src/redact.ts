/**
 * Secret redaction for codex-dario logs and error messages.
 */

export const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/sk-[a-zA-Z0-9_-]{20,}/g, '[REDACTED_KEY]'],
  [/eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[REDACTED_JWT]'],
  [/Bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]'],
  [/refresh_token["\s:=]+["']?[a-zA-Z0-9_-]{20,}/gi, 'refresh_token=[REDACTED]'],
  [/access_token["\s:=]+["']?eyJ[a-zA-Z0-9_-]+/gi, 'access_token=[REDACTED]'],
];

export function redactSecrets(s: string): string {
  let out = s;
  for (const [pat, repl] of SECRET_PATTERNS) {
    out = out.replace(pat, repl);
  }
  return out;
}
