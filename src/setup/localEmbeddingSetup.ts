import { prepareLocalEmbedder, LOCAL_EMBED_PRIMARY, LOCAL_EMBED_PRIMARY_DIM } from '../embeddings/localEmbed.js';
import { runWithSpinner } from './spinner.js';
import { isInkSessionActive, pushInkMessage } from './tui/prompterBridge.js';
import { note, success } from './terminal.js';

export async function setupLocalEmbeddings(values: Record<string, string | undefined>): Promise<void> {
  note('Memory search runs on your Mac. Nothing extra to install.');
  if (process.env.SASS_TEST_SKIP_EMBEDDED === '1' || process.env.SASS_TEST_SKIP_LOCAL_EMBED === '1') {
    values.SASS_EMBEDDING_PROVIDER = 'local';
    values.EMBEDDING_DIMENSION ||= String(LOCAL_EMBED_PRIMARY_DIM);
    values.LOCAL_EMBED_MODEL ||= LOCAL_EMBED_PRIMARY;
    return;
  }
  const result = await runWithSpinner('Downloading my memory search model (one time)', async () => {
    return await prepareLocalEmbedder((p) => {
      if (p.status === 'progress' && typeof p.progress === 'number') {
        if (isInkSessionActive()) pushInkMessage(`Memory model download: ${Math.round(p.progress)}%`);
        else process.stdout.write(`\r  … ${Math.round(p.progress)}%`);
      }
    }, {
      SASS_HOME: process.env.SASS_HOME,
      SASS_EMBED_CACHE_DIR: process.env.SASS_EMBED_CACHE_DIR,
      ...values,
    });
  });
  values.SASS_EMBEDDING_PROVIDER = 'local';
  values.EMBEDDING_DIMENSION = String(result.dimension);
  values.LOCAL_EMBED_MODEL = result.model;
  success('Memory search model ready on this Mac.');
  note('Uses the selected local model. See docs/RELEASE_BUNDLES.md for model provenance and license details.');
  note('Change later: sass setup → advanced embeddings, or edit .env.');
}
