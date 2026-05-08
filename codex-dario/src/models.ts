/**
 * Model list and alias resolution for codex-dario.
 */

export const MODEL_ALIASES: Record<string, string> = {
  'o3': 'o3',
  'o3-pro': 'o3-pro',
  'o4-mini': 'o4-mini',
  'gpt-4.1': 'gpt-4.1',
  'gpt-4.1-mini': 'gpt-4.1-mini',
  'gpt-4.1-nano': 'gpt-4.1-nano',
  'gpt-5.5': 'gpt-5.5',
  'codex-mini': 'codex-mini',
  'o3-mini': 'o3-mini',
};

const OPENAI_TO_CODEX: Record<string, string> = {
  'gpt-4': 'gpt-5.5',
  'gpt-4o': 'gpt-5.5',
  'gpt-4o-mini': 'gpt-5.5',
  'gpt-3.5-turbo': 'gpt-5.5',
  'claude-opus-4-6': 'gpt-5.5',
  'claude-sonnet-4-6': 'gpt-5.5',
  'claude-haiku-4-5': 'gpt-5.5',
};

/**
 * Resolve a model name to the Codex-compatible model ID.
 * Handles aliases, OpenAI-to-Codex mapping, and passthrough.
 */
export function resolveModel(requestedModel: string): string {
  // Direct alias match
  if (MODEL_ALIASES[requestedModel]) {
    return MODEL_ALIASES[requestedModel]!;
  }

  // OpenAI model name mapping
  if (OPENAI_TO_CODEX[requestedModel]) {
    return OPENAI_TO_CODEX[requestedModel]!;
  }

  // Pass through as-is (for future models)
  return requestedModel;
}
