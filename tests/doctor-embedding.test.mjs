import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

function load(path, imports) {
  const source = readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const context = { exports: {}, require(name) {
    if (!(name in imports)) throw new Error(`Unexpected I/O import: ${name}`);
    return imports[name];
  } };
  vm.runInNewContext(code, context);
  return context.exports;
}

function healthFixture() {
  return load('embeddings/health.ts', {
    '../ai/clientConfig.js': {
      resolveEmbeddingOpenAIConfig: (env) => ({ apiKey: env.EMBEDDING_OPENAI_API_KEY ?? env.OPENAI_API_KEY, baseURL: env.EMBEDDING_OPENAI_BASE_URL }),
      describeApiEndpoint: (base, fallback) => base ? new URL(base).host : fallback,
    },
  });
}

test('doctor skips disabled embeddings without a local load or API call', async () => {
  const { checkEmbeddingHealth } = healthFixture();
  const result = await checkEmbeddingHealth({ SASS_EMBEDDING_PROVIDER: 'off' }, {
    local: () => assert.fail('local load'), api: () => assert.fail('API call'),
  });
  assert.equal(result.ok, true);
  assert.match(result.detail, /off/);
});

test('doctor checks local cache without requiring an API key', async () => {
  const { checkEmbeddingHealth } = healthFixture();
  let checked;
  const env = { SASS_EMBEDDING_PROVIDER: 'local', LOCAL_EMBED_MODEL: 'synthetic-local', EMBEDDING_DIMENSION: '2' };
  const result = await checkEmbeddingHealth(env, {
    local: async (config) => { checked = config; return { model: config.LOCAL_EMBED_MODEL, dimension: 2 }; },
    api: () => assert.fail('API call'),
  });
  assert.equal(result.ok, true);
  assert.equal(checked, env);
  assert.match(result.detail, /synthetic-local/);
});

test('a missing local cache reports failure and does not try the cloud', async () => {
  const { checkEmbeddingHealth } = healthFixture();
  const result = await checkEmbeddingHealth({ SASS_EMBEDDING_PROVIDER: 'local' }, {
    local: async () => { throw new Error('Synthetic cache missing'); }, api: () => assert.fail('API call'),
  });
  assert.equal(result.ok, false);
  assert.match(result.detail, /cache missing/);
  assert.match(result.detail, /sass setup/);
});

test('doctor sends the selected Ollama embedding model', async () => {
  const { checkEmbeddingHealth } = healthFixture();
  let requested;
  const result = await checkEmbeddingHealth({
    SASS_EMBEDDING_PROVIDER: 'ollama', OPENAI_EMBEDDING_MODEL: 'synthetic-embed',
    EMBEDDING_OPENAI_API_KEY: 'ollama', EMBEDDING_OPENAI_BASE_URL: 'http://127.0.0.1:11434/v1',
  }, { local: () => assert.fail('local load'), api: async (model) => { requested = model; } });
  assert.equal(result.ok, true);
  assert.equal(requested, 'synthetic-embed');
  assert.match(result.detail, /127.0.0.1:11434/);
});

test('doctor retains the legacy API default when provider is unset', async () => {
  const { checkEmbeddingHealth } = healthFixture();
  let requested;
  const result = await checkEmbeddingHealth({ OPENAI_API_KEY: 'synthetic-key' }, {
    local: () => assert.fail('local load'), api: async (model) => { requested = model; },
  });
  assert.equal(result.ok, true);
  assert.equal(requested, 'text-embedding-3-small');
});

test('local cache check is offline, checks the pinned model, and disposes it', async () => {
  let options; let model; let disposed = false;
  const { checkCachedLocalEmbedder } = load('embeddings/localEmbedEngine.ts', {
    './localEmbedCache.js': { resolveLocalModelLocation: (config, _model, revision) => ({ cacheDir: config.SASS_EMBED_CACHE_DIR || ((config.SASS_HOME || '/synthetic/.sass') + '/models'), revision }) },
    './localEmbedConfig.js': { LOCAL_EMBED_PRIMARY: 'onnx-community/embeddinggemma-2-ONNX', LOCAL_EMBED_FALLBACK: 'Xenova/all-MiniLM-L6-v2', LOCAL_EMBED_PRIMARY_DIM: 768, LOCAL_EMBED_FALLBACK_DIM: 384, LOCAL_EMBED_REVISION: 'daa72c51243991dfcaf9f9137d2c573d8f7790c0' },
    path: { join: (...parts) => parts.join('/') },
    '@huggingface/transformers': { env: {} },
    './localEmbedLoader.js': { loadLocalExtractor: async (_id, selectedModel, selectedOptions) => {
      model = selectedModel; options = selectedOptions;
      return Object.assign(async () => ({ data: new Float32Array(2) }), { dispose: async () => { disposed = true; } });
    } },
  });
  const result = await checkCachedLocalEmbedder({ LOCAL_EMBED_MODEL: 'synthetic-local', EMBEDDING_DIMENSION: '2' });
  assert.equal(options.local_files_only, true);
  assert.equal(model, '/synthetic/.sass/models/synthetic-local');
  assert.equal(result.dimension, 2);
  assert.equal(disposed, true);
});

test('default API check uses the supplied setup settings without runtime globals', async () => {
  let clientOptions; let requested;
  const { checkEmbeddingHealth } = load('embeddings/health.ts', {
    '../ai/clientConfig.js': {
      resolveEmbeddingOpenAIConfig: (env) => ({ apiKey: env.EMBEDDING_OPENAI_API_KEY, baseURL: env.EMBEDDING_OPENAI_BASE_URL }),
      describeApiEndpoint: (base) => new URL(base).host,
    },
    openai: { default: class {
      constructor(options) { clientOptions = options; }
      embeddings = { create: async (request) => { requested = request; return { data: [{ embedding: [1, 0] }] }; } };
    } },
  });
  const result = await checkEmbeddingHealth({
    SASS_EMBEDDING_PROVIDER: 'ollama', OPENAI_EMBEDDING_MODEL: 'synthetic-embed',
    EMBEDDING_OPENAI_API_KEY: 'synthetic-key', EMBEDDING_OPENAI_BASE_URL: 'http://127.0.0.1:11434/v1',
  });
  assert.equal(result.ok, true);
  assert.equal(clientOptions.apiKey, 'synthetic-key');
  assert.equal(clientOptions.baseURL, 'http://127.0.0.1:11434/v1');
  assert.equal(requested.model, 'synthetic-embed');
});
