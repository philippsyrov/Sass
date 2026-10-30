import { homedir } from 'os';
import { join, sep } from 'path';
import { InputEnded, type SetupPrompter } from './linePrompter.js';
import { SetupCancelledError } from './cancelRegistry.js';
import { checkApiKey, type ProviderPreset } from './validate.js';
import { listOllamaModels } from './checks.js';
import { setupLocalEmbeddings } from './localEmbeddingSetup.js';
import { checkEmbeddingHealth } from '../embeddings/health.js';
import { LOCAL_EMBED_PRIMARY } from '../embeddings/localEmbed.js';
import { note, warn } from './terminal.js';

export interface MemorySearchPorts {
  local: typeof setupLocalEmbeddings;
  listOllama: typeof listOllamaModels;
  health: typeof checkEmbeddingHealth;
  note: typeof note;
  warn: typeof warn;
}

export async function setupMemorySearch(
  p: SetupPrompter,
  preset: ProviderPreset,
  env: Record<string, string>,
  values: Record<string, string | undefined>,
  skipped: string[],
  ports: Partial<MemorySearchPorts> = {},
): Promise<void> {
  const io = { local: setupLocalEmbeddings, listOllama: listOllamaModels, health: checkEmbeddingHealth, note, warn, ...ports };
  function disable(): void {
    values.SASS_EMBEDDING_PROVIDER = 'off';
    if (!skipped.includes('Memory search model')) skipped.push('Memory search model');
    io.note('Memory search is off. Other database features still work.');
  }

  function useOpenAI(key: string): void {
    values.SASS_EMBEDDING_PROVIDER = 'openai';
    values.EMBEDDING_OPENAI_BASE_URL = '';
    values.EMBEDDING_OPENAI_API_KEY = key;
    values.OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
  }

  if (preset.aiProvider === 'openai' && preset.servesEmbeddings && preset.key === 'openai') {
    if (await p.confirm('Use your OpenAI key for memory search too? (Otherwise I use a local model on your Mac)', false)) {
      useOpenAI(values.OPENAI_API_KEY ?? '');
      return;
    }
  }

  if (await p.confirm('Advanced: cloud or Ollama embeddings instead?', false)) {
    const choice = await p.choose('Memory search via', [
      'Ollama on this Mac',
      'OpenAI-compatible cloud API',
      'Skip (memory search off until configured)',
    ], 0);
    if (choice === 0) {
      const host = (values.OLLAMA_HOST?.trim() || 'http://127.0.0.1:11434').replace(/\/+$/, '');
      try {
        const listed = await io.listOllama(host);
        if (!listed.ok || listed.data.length === 0) {
          io.warn(listed.ok ? 'No installed Ollama models are available for memory search.' : listed.error);
          disable();
          return;
        }
        const previousIndex = listed.data.indexOf(values.OPENAI_EMBEDDING_MODEL ?? '');
        const selected = await p.choose('Installed Ollama model for memory search', listed.data, Math.max(0, previousIndex));
        const model = listed.data[selected];
        if (!model) {
          disable();
          return;
        }
        values.SASS_EMBEDDING_PROVIDER = 'ollama';
        values.EMBEDDING_OPENAI_BASE_URL = `${host}/v1`;
        values.EMBEDDING_OPENAI_API_KEY = 'ollama';
        values.OPENAI_EMBEDDING_MODEL = model;
        const health = await io.health(values as NodeJS.ProcessEnv);
        if (!health.ok) {
          io.warn(`Memory search check failed: ${health.detail}`);
          disable();
        } else {
          io.note(`Memory search is ready with Ollama model ${model}.`);
        }
      } catch (err) {
        if (err instanceof SetupCancelledError || err instanceof InputEnded) throw err;
        io.warn('Could not check the installed Ollama model. Memory search will stay off.');
        disable();
      }
    } else if (choice === 1) {
      const key = await p.askValid('OpenAI API key (memory search only)', (raw) => checkApiKey(raw, 'openai'), {
        fallback: env.EMBEDDING_OPENAI_API_KEY ?? env.OPENAI_API_KEY,
        secret: true,
      });
      useOpenAI(key);
    } else {
      disable();
    }
    return;
  }

  const model = values.LOCAL_EMBED_MODEL?.trim() || LOCAL_EMBED_PRIMARY;
  const base = values.SASS_HOME?.trim() || process.env.SASS_HOME?.trim() || join(homedir(), '.sass');
  const cache = values.SASS_EMBED_CACHE_DIR?.trim() || process.env.SASS_EMBED_CACHE_DIR?.trim() || join(base, 'models');
  const home = homedir();
  const displayCache = cache === home ? '~' : cache.startsWith(home + sep) ? `~${cache.slice(home.length)}` : cache;
  io.note(`Memory search model source: https://huggingface.co/${model}`);
  io.note(`Model cache destination: ${displayCache}`);
  io.note('Download size not checked by this build.');
  if (!(await p.confirm('Download or prepare this local memory search model?', false))) {
    disable();
    return;
  }
  try {
    await io.local(values);
  } catch (err) {
    if (err instanceof SetupCancelledError || err instanceof InputEnded) throw err;
    io.warn('Could not prepare the local model. Memory search will stay off.');
    disable();
  }
}
