import { describeApiEndpoint, resolveEmbeddingOpenAIConfig } from '../ai/clientConfig.js';

export interface EmbeddingHealthPorts {
  local(config: NodeJS.ProcessEnv): Promise<{ model: string; dimension: number }>;
  api(model: string, config: NodeJS.ProcessEnv): Promise<void>;
}

const defaultPorts: EmbeddingHealthPorts = {
  async local(config) {
    const { checkCachedLocalEmbedder } = await import('./localEmbed.js');
    return checkCachedLocalEmbedder(config);
  },
  async api(model, config) {
    const { default: OpenAI } = await import('openai');
    const { apiKey, baseURL, anthropicVersionHeader } = resolveEmbeddingOpenAIConfig(config);
    const client = new OpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
      ...(anthropicVersionHeader ? { defaultHeaders: { 'anthropic-version': '2023-06-01' } } : {}),
      timeout: 15_000,
      maxRetries: 0,
    });
    const response = await client.embeddings.create({ model, input: 'test' });
    if (!response.data[0]?.embedding.length) throw new Error('Empty embedding response');
  },
};

export async function checkEmbeddingHealth(
  config: NodeJS.ProcessEnv = process.env,
  ports: EmbeddingHealthPorts = defaultPorts,
): Promise<{ ok: boolean; detail: string }> {
  const provider = config.SASS_EMBEDDING_PROVIDER?.trim().toLowerCase() || 'openai';
  if (provider === 'off') return { ok: true, detail: 'off (configured; no model or API check)' };
  if (provider === 'local') {
    try {
      const { model, dimension } = await ports.local(config);
      return { ok: true, detail: `local cache ready (${model}, ${dimension} dimensions; no download)` };
    } catch (err) {
      return { ok: false, detail: `local model cache unavailable: ${(err as Error).message}. Run sass setup to prepare the model.` };
    }
  }
  if (provider !== 'openai' && provider !== 'ollama') {
    return { ok: false, detail: `unsupported embedding provider: ${provider}` };
  }
  const { apiKey, baseURL } = resolveEmbeddingOpenAIConfig(config);
  const host = describeApiEndpoint(baseURL, 'api.openai.com');
  if (!apiKey) return { ok: false, detail: `no embedding API key (${host})` };
  const model = config.OPENAI_EMBEDDING_MODEL?.trim() || 'text-embedding-3-small';
  try {
    await ports.api(model, config);
    return { ok: true, detail: `working (${host}, ${model})` };
  } catch (err) {
    return { ok: false, detail: `${host} (${model}): ${(err as Error).message}` };
  }
}
