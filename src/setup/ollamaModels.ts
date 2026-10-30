/**
 * Tell chat models apart from embedding-only models in Ollama / LM Studio lists.
 */

import { hasOllamaModel } from './checks.js';

/** Smaller default when nothing is installed yet (not llama3.1:8b). */
export const RECOMMENDED_OLLAMA_CHAT_PULL = 'qwen3.5:4b';

const EMBEDDING_NAME_RE = /(?:^|[/:_-])(?:embed|embedding|bge-|mxbai-embed|nomic-embed|snowflake-arctic-embed|embeddinggemma)/i;

export function isOllamaEmbeddingModel(name: string): boolean {
  const base = name.split(':')[0]?.toLowerCase() ?? name.toLowerCase();
  if (base === 'sass') return false;
  return EMBEDDING_NAME_RE.test(name) || EMBEDDING_NAME_RE.test(base);
}

export function ollamaChatModels(installed: string[]): string[] {
  return installed.filter((name) => !isOllamaEmbeddingModel(name));
}

export function isLmStudioEmbeddingModel(id: string): boolean {
  return /embed/i.test(id);
}

export function lmStudioChatModels(installed: string[]): string[] {
  return installed.filter((id) => !isLmStudioEmbeddingModel(id));
}

const LITE_CHAT_PREFER = /qwen3\.5.*4b|qwen2\.5.*3b|llama3\.2.*3b|gemma3.*4b/i;

/** Prefer small instruction-following models for the lite path. */
export function defaultOllamaChatModelIndex(chatModels: string[], envModel?: string): number {
  if (envModel && hasOllamaModel(chatModels, envModel)) {
    const idx = chatModels.findIndex((m) => hasOllamaModel([m], envModel) || m === envModel);
    if (idx >= 0) return idx;
  }
  const liteIdx = chatModels.findIndex((m) => LITE_CHAT_PREFER.test(m));
  if (liteIdx >= 0) return liteIdx;
  return 0;
}
