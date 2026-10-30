import { createEmbeddingProcess } from './embeddingProcess.js';
import { existsSync } from 'node:fs';
import { LOCAL_EMBED_PRIMARY, LOCAL_EMBED_PRIMARY_DIM, type EmbedPurpose, type EmbedProgress } from './localEmbedConfig.js';
export * from './localEmbedConfig.js';

const builtWorker = new URL('./localEmbedWorker.js', import.meta.url);
const service = createEmbeddingProcess(existsSync(builtWorker) ? builtWorker : new URL('./localEmbedWorker.ts', import.meta.url));
let activeModel = LOCAL_EMBED_PRIMARY;
let activeDim = LOCAL_EMBED_PRIMARY_DIM;
let activeConfig: Record<string, string | undefined> | undefined;

function selectedConfig(config: Record<string, string | undefined>): Record<string, string | undefined> {
  const selected: Record<string, string | undefined> = {};
  for (const key of ['SASS_HOME', 'SASS_EMBED_CACHE_DIR', 'LOCAL_EMBED_MODEL', 'LOCAL_EMBED_REVISION', 'EMBEDDING_DIMENSION']) {
    if (config[key]) selected[key] = config[key];
  }
  return selected;
}

/** Explicit setup preparation; runtime and doctor use offline-only actions. */
export async function prepareLocalEmbedder(onProgress: EmbedProgress | undefined, config: Record<string, string | undefined>): Promise<{ model: string; dimension: number }> {
  return await service.request('prepare', selectedConfig(config), onProgress, 30 * 60_000) as { model: string; dimension: number };
}

export function localEmbeddingDimension(): number { return activeDim; }
export function localEmbeddingModelId(): string { return activeModel; }

export async function ensureLocalEmbedder(onProgress?: EmbedProgress, config: Record<string, string | undefined> = process.env): Promise<void> {
  const selected = selectedConfig(config);
  if (activeConfig && JSON.stringify(activeConfig) !== JSON.stringify(selected)) {
    throw new Error('Local embedding configuration changed; restart before using a different model');
  }
  const result = await service.request('ensure', selected, onProgress) as { model: string; dimension: number };
  activeConfig = selected;
  activeModel = result.model;
  activeDim = result.dimension;
}

export async function checkCachedLocalEmbedder(config: Record<string, string | undefined> = process.env): Promise<{ model: string; dimension: number }> {
  return await service.request('check', selectedConfig(config)) as { model: string; dimension: number };
}

export async function embedLocally(text: string, purpose: EmbedPurpose = 'document'): Promise<number[]> {
  if (!activeConfig) await ensureLocalEmbedder();
  return await service.request('embed', { text, purpose, config: activeConfig }) as number[];
}

export async function closeLocalEmbedder(): Promise<void> {
  await service.close();
  activeConfig = undefined;
}
