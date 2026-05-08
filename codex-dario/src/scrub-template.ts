/**
 * Template scrubbing — removes non-Codex identifiers from requests.
 *
 * Similar to dario's scrub-template.ts but targets OpenAI/Codex
 * detection vectors.
 */

// Framework identifiers that would flag non-Codex usage
const FRAMEWORK_PATTERNS: RegExp[] = [
  /\b(claude|anthropic|claude-code|dario)\b/gi,
  /\b(cursor|windsurf|cline|aider|copilot|continue|cody)\b/gi,
  /\b(openai-sdk|langchain|llamaindex)\b/gi,
  /\bgateway\b/gi,
  /\bproxy\b/gi,
];

/**
 * Scrub framework identifiers from text content.
 * Preserves identifiers embedded in filesystem paths.
 */
export function scrubFrameworkIdentifiers(text: string): string {
  let result = text;
  for (const pattern of FRAMEWORK_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, (match, ...args) => {
      const offset = args[args.length - 2] as number;
      const src = args[args.length - 1] as string;
      const before = offset > 0 ? src[offset - 1] : '';
      const after = offset + match.length < src.length ? src[offset + match.length] : '';
      // Preserve matches in paths
      if (before === '.' || before === '/' || before === '\\' || before === '-' || before === '_') return match;
      if (after === '/' || after === '\\') return match;
      return '';
    });
  }
  return result;
}
