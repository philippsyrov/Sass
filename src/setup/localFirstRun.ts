import { LOCAL_EMBED_PRIMARY, LOCAL_EMBED_PRIMARY_DIM } from '../embeddings/localEmbed.js';
import { checkEmbeddingHealth } from '../embeddings/health.js';

export function usesSimpleSetup(): boolean {
  return process.env.SASS_SETUP_ADVANCED !== '1';
}

export async function prepareLocalMemory(
  values: Record<string, string | undefined>,
  health: typeof checkEmbeddingHealth = checkEmbeddingHealth,
): Promise<void> {
  if ((values.DATABASE_URL && values.SASS_EMBEDDED_PG !== '1')
      || (values.SASS_EMBEDDING_PROVIDER && values.SASS_EMBEDDING_PROVIDER !== 'local')) {
    throw new Error('Existing custom memory settings are preserved. Use sass settings to change them.');
  }
  if (!values.LOCAL_EMBED_MODEL) {
    values.LOCAL_EMBED_MODEL = LOCAL_EMBED_PRIMARY;
    values.EMBEDDING_DIMENSION = String(LOCAL_EMBED_PRIMARY_DIM);
  }
  values.SASS_EMBEDDED_PG = '1';
  values.DATABASE_URL = '';
  values.SASS_EMBEDDING_PROVIDER = 'local';
  const result = await health(values as NodeJS.ProcessEnv);
  if (!result.ok) throw new Error(`Required local memory is not ready: ${result.detail}`);
}
