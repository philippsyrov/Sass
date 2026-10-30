import { LOCAL_EMBED_PRIMARY, LOCAL_EMBED_LEGACY, type EmbedProgress, type EmbedPurpose } from './localEmbedConfig.js';

type EmbeddingOutput = { data: ArrayLike<number> };
export interface LocalExtractor {
  (text: string, purpose?: EmbedPurpose): Promise<EmbeddingOutput>;
  dispose(): Promise<unknown>;
}
interface LoadOptions { revision?: string; local_files_only?: boolean; progress_callback?: EmbedProgress }
type ModelOptions = LoadOptions & { config?: Record<string, unknown>; dtype?: 'q8' | 'fp32' };
interface EmbeddingModel {
  (inputs: unknown): Promise<{ sentence_embedding?: EmbeddingOutput }>;
  dispose(): Promise<unknown>;
}
interface LoaderPorts {
  config(source: string, options: LoadOptions): Promise<Record<string, unknown>>;
  tokenizer(source: string, options: LoadOptions): Promise<(text: string, options: object) => unknown>;
  model(source: string, options: ModelOptions): Promise<EmbeddingModel>;
  pipeline(task: 'feature-extraction', source: string, options: ModelOptions): Promise<{
    (text: string, options: object): Promise<EmbeddingOutput>;
    dispose(): Promise<unknown>;
  }>;
}
async function defaultPorts(): Promise<LoaderPorts> {
  const { AutoConfig, AutoTokenizer, AutoModel, pipeline } = await import('@huggingface/transformers');
  return {
    config: async (source, options) => await AutoConfig.from_pretrained(source, options) as unknown as Record<string, unknown>,
    tokenizer: (source, options) => AutoTokenizer.from_pretrained(source, options),
    model: async (source, options) => await AutoModel.from_pretrained(source, options as Parameters<typeof AutoModel.from_pretrained>[1]) as unknown as EmbeddingModel,
    pipeline: async (task, source, options) => await pipeline(task, source, options as Parameters<typeof AutoModel.from_pretrained>[1]) as unknown as Awaited<ReturnType<LoaderPorts['pipeline']>>,
  };
}
export async function loadLocalExtractor(modelId: string, source: string, options: LoadOptions, injected?: LoaderPorts): Promise<LocalExtractor> {
  const ports = injected || await defaultPorts();
  if (modelId !== LOCAL_EMBED_PRIMARY) {
    const pipe = await ports.pipeline('feature-extraction', source, { ...options, ...(modelId === LOCAL_EMBED_LEGACY ? { dtype: 'fp32' as const } : {}) });
    return Object.assign((text: string) => pipe(text, { pooling: 'mean', normalize: true }), { dispose: () => pipe.dispose() });
  }
  const config = await ports.config(source, options);
  // These independent encoders would otherwise load even for text input.
  config.vision_config = config.audio_config = null;
  const tokenizer = await ports.tokenizer(source, options);
  const model = await ports.model(source, { ...options, config, dtype: 'q8' });
  return Object.assign(async (text: string, purpose: EmbedPurpose = 'document') => {
    const input = purpose === 'query' ? `task: search result | query: ${text}` : `title: none | text: ${text}`;
    const output = await model(tokenizer(input, { padding: true, truncation: true, max_length: 8192 }));
    // The model applies its learned 512 -> 768 projection and normalization.
    // Pooling raw hidden states through feature-extraction skips that contract.
    if (!output.sentence_embedding) throw new Error('Gemma 2 returned no sentence embedding');
    if (output.sentence_embedding.data.length !== 768) throw new Error('Gemma 2 sentence embedding dimension mismatch');
    if (Array.from(output.sentence_embedding.data).some((value) => !Number.isFinite(value))) throw new Error('Gemma 2 sentence embedding contains non-finite values');
    return output.sentence_embedding;
  }, { dispose: () => model.dispose() });
}
