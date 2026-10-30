/**
 * Resolve OpenAI-SDK settings for chat vs vector embeddings.
 * Chat uses OPENAI_* when AI_PROVIDER=openai. Embeddings prefer EMBEDDING_OPENAI_* so
 * mixed setups (e.g. Anthropic chat + Ollama embeddings) never clobber chat credentials.
 */

export interface OpenAIClientEnv {
  baseURL?: string;
  apiKey: string;
  anthropicVersionHeader: boolean;
}

function isAnthropicBaseUrl(baseURL: string | undefined): boolean {
  if (!baseURL) return false;
  try {
    return new URL(baseURL).hostname === 'api.anthropic.com';
  } catch {
    return baseURL.includes('api.anthropic.com');
  }
}

function trimEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value || undefined;
}

/** Chat completions when AI_PROVIDER=openai (Anthropic, LM Studio, OpenAI, …). */
export function resolveChatOpenAIConfig(env: NodeJS.ProcessEnv = process.env): OpenAIClientEnv {
  const baseURL = trimEnv(env, 'OPENAI_BASE_URL');
  const apiKey = trimEnv(env, 'OPENAI_API_KEY') ?? '';
  return {
    baseURL,
    apiKey,
    anthropicVersionHeader: isAnthropicBaseUrl(baseURL),
  };
}

/** Embeddings for vector memory; falls back to OPENAI_* only when EMBEDDING_OPENAI_API_KEY is unset. */
export function resolveEmbeddingOpenAIConfig(env: NodeJS.ProcessEnv = process.env): OpenAIClientEnv {
  const embedKey = trimEnv(env, 'EMBEDDING_OPENAI_API_KEY');
  const embedBase = trimEnv(env, 'EMBEDDING_OPENAI_BASE_URL');
  if (embedKey) {
    return {
      baseURL: embedBase,
      apiKey: embedKey,
      anthropicVersionHeader: isAnthropicBaseUrl(embedBase),
    };
  }
  const baseURL = trimEnv(env, 'OPENAI_BASE_URL');
  const apiKey = trimEnv(env, 'OPENAI_API_KEY') ?? '';
  return {
    baseURL,
    apiKey,
    anthropicVersionHeader: isAnthropicBaseUrl(baseURL),
  };
}

export function describeApiEndpoint(baseURL: string | undefined, defaultHost: string): string {
  if (!baseURL) return defaultHost;
  try {
    return new URL(baseURL).host;
  } catch {
    return baseURL;
  }
}
