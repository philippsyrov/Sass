export const LOCAL_EMBED_PRIMARY = 'onnx-community/embeddinggemma-2-ONNX';
export const LOCAL_EMBED_LEGACY = 'onnx-community/embeddinggemma-300m-ONNX';
export const LOCAL_EMBED_FALLBACK = 'Xenova/all-MiniLM-L6-v2';
export const LOCAL_EMBED_PRIMARY_DIM = 768;
export const LOCAL_EMBED_FALLBACK_DIM = 384;
export const LOCAL_EMBED_REVISION = 'daa72c51243991dfcaf9f9137d2c573d8f7790c0';
export const LOCAL_EMBED_LEGACY_REVISION = '5090578d9565bb06545b4552f76e6bc2c93e4a66';
export type EmbedPurpose = 'query' | 'document';
export type EmbedProgress = (info: { status: string; file?: string; progress?: number }) => void;

export function localEmbeddingFingerprint(config: Record<string, string | undefined> = process.env): string {
  const model = config.LOCAL_EMBED_MODEL?.trim() || LOCAL_EMBED_PRIMARY;
  if (model !== LOCAL_EMBED_PRIMARY) return model;
  const revision = config.LOCAL_EMBED_REVISION?.trim() || LOCAL_EMBED_REVISION;
  return `${model}@${revision}:text:q8:768:mean:l2:search-document-v1`;
}
