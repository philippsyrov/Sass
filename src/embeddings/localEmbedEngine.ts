/**
 * Loaded only in the embedding child process. Native image libraries must not
 * share the bot's Objective-C runtime with canvas on macOS.
 */
import { join } from 'path';
import { env } from '@huggingface/transformers';
import { LOCAL_EMBED_PRIMARY, LOCAL_EMBED_FALLBACK, LOCAL_EMBED_PRIMARY_DIM, LOCAL_EMBED_FALLBACK_DIM, LOCAL_EMBED_LEGACY, LOCAL_EMBED_LEGACY_REVISION, type EmbedPurpose, LOCAL_EMBED_REVISION, type EmbedProgress } from './localEmbedConfig.js';
import { resolveLocalModelLocation } from './localEmbedCache.js';
import { loadLocalExtractor, type LocalExtractor } from './localEmbedLoader.js';

let extractor: LocalExtractor | null = null;
let activeDim = LOCAL_EMBED_PRIMARY_DIM;
let activeModel = LOCAL_EMBED_PRIMARY;
let loading: Promise<void> | null = null;

export function localEmbeddingDimension(): number {
  return activeDim;
}

export function localEmbeddingModelId(): string {
  return activeModel;
}

async function loadPipeline(
  modelId: string,
  onProgress?: EmbedProgress,
  offline = false,
  config: Record<string, string | undefined> = process.env,
): Promise<LocalExtractor> {
  const requestedRevision = modelId === LOCAL_EMBED_PRIMARY ? config.LOCAL_EMBED_REVISION?.trim() || LOCAL_EMBED_REVISION : modelId === LOCAL_EMBED_LEGACY ? config.LOCAL_EMBED_REVISION?.trim() || LOCAL_EMBED_LEGACY_REVISION : undefined;
  const { cacheDir, revision } = resolveLocalModelLocation(config, modelId, requestedRevision);
  env.cacheDir = cacheDir;
  env.allowLocalModels = offline;
  env.allowRemoteModels = !offline;
  env.useFSCache = !offline;
  // New model pins use the exact revision directory offline.
  const source = offline ? join(env.cacheDir, modelId, ...(revision ? [revision] : [])) : modelId;
  return loadLocalExtractor(modelId, source, {
    ...(revision ? { revision } : {}),
    local_files_only: offline,
    progress_callback: onProgress,
  });
}

export async function ensureLocalEmbedder(
  onProgress?: EmbedProgress,
  config: Record<string, string | undefined> = process.env,
): Promise<void> {
  const pinnedModel = config.LOCAL_EMBED_MODEL?.trim();
  const requestedDim = config.EMBEDDING_DIMENSION?.trim();
  const configuredDim = requestedDim ? Number(requestedDim) : undefined;
  if (configuredDim !== undefined && (!Number.isSafeInteger(configuredDim) || configuredDim <= 0)) {
    throw new Error('EMBEDDING_DIMENSION must be a positive integer');
  }
  if (loading) await loading;
  if (!extractor) {
    const model = pinnedModel || LOCAL_EMBED_PRIMARY;
    const dimension = (model === LOCAL_EMBED_PRIMARY || model === LOCAL_EMBED_LEGACY) ? LOCAL_EMBED_PRIMARY_DIM
      : model === LOCAL_EMBED_FALLBACK ? LOCAL_EMBED_FALLBACK_DIM : configuredDim;
    if (!dimension) throw new Error('A custom LOCAL_EMBED_MODEL requires EMBEDDING_DIMENSION');
    if (configuredDim !== undefined && configuredDim !== dimension) {
      throw new Error('EMBEDDING_DIMENSION does not match LOCAL_EMBED_MODEL');
    }
    loading = (async () => {
      extractor = await loadPipeline(model, onProgress, true, config);
      activeDim = dimension;
      activeModel = model;
    })();
    try {
      await loading;
    } finally {
      loading = null;
    }
  }
  if ((pinnedModel && pinnedModel !== activeModel) || (configuredDim !== undefined && configuredDim !== activeDim)) {
    throw new Error('Local embedding configuration changed; restart before using a different model');
  }
}

/** Called only after setup has obtained explicit permission to prepare a model. */
export async function prepareLocalEmbedder(
  onProgress: EmbedProgress | undefined,
  config: Record<string, string | undefined>,
): Promise<{ model: string; dimension: number }> {
  const model = config.LOCAL_EMBED_MODEL?.trim() || LOCAL_EMBED_PRIMARY;
  const downloaded = await loadPipeline(model, onProgress, false, config);
  await downloaded.dispose();
  // Verify the exact offline path used by doctor and runtime before reporting success.
  return checkCachedLocalEmbedder(config);
}

export async function disposeLocalEmbedder(): Promise<void> {
  await loading;
  await extractor?.dispose();
  extractor = null;
}

/** Doctor must inspect only the selected cached model, with no download or model fallback. */
export async function checkCachedLocalEmbedder(
  config: Record<string, string | undefined> = process.env,
): Promise<{ model: string; dimension: number }> {
  const model = config.LOCAL_EMBED_MODEL?.trim() || LOCAL_EMBED_PRIMARY;
  const expected = (model === LOCAL_EMBED_PRIMARY || model === LOCAL_EMBED_LEGACY) ? LOCAL_EMBED_PRIMARY_DIM
    : model === LOCAL_EMBED_FALLBACK ? LOCAL_EMBED_FALLBACK_DIM : undefined;
  const dimension = config.EMBEDDING_DIMENSION?.trim() ? Number(config.EMBEDDING_DIMENSION) : expected;
  if (!dimension || !Number.isSafeInteger(dimension) || dimension <= 0 || (expected && dimension !== expected)) {
    throw new Error('EMBEDDING_DIMENSION does not match LOCAL_EMBED_MODEL');
  }
  const cached = await loadPipeline(model, undefined, true, config);
  try {
    const result = await cached('test', 'document');
    if (result.data.length !== dimension) throw new Error(`Expected ${dimension} dimensions, received ${result.data.length}`);
    return { model, dimension };
  } finally {
    await cached.dispose();
  }
}

export async function embedLocally(text: string, purpose: EmbedPurpose = 'document'): Promise<number[]> {
  await ensureLocalEmbedder();
  if (!extractor) throw new Error('Local embedder not loaded');
  const out = await extractor(text, purpose);
  const data = out.data as Float32Array | number[];
  const vector = Array.from(data);
  if (vector.some((value) => !Number.isFinite(value))) throw new Error('Local embedding contains non-finite values');
  if (vector.length !== activeDim) throw new Error(`Local embedding dimension mismatch: expected ${activeDim}, received ${vector.length}`);
  return vector;
}
