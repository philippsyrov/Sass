import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

// Run source with synthetic I/O ports. No model, database, .env or network is loaded.
function loadSource(path, imports, env = {}) {
  const source = readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const context = {
    exports: {}, process: { env }, console: { log() {}, warn() {}, error() {} },
    require(name) {
      if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
      return imports[name];
    },
  };
  vm.runInNewContext(code, context);
  return context.exports;
}

function localFixture(env, failPrimary = false) {
  const calls = [];
  const options = [];
  const modes = [];
  const transformerEnv = {};
  const module = loadSource('embeddings/localEmbedEngine.ts', {
    './localEmbedCache.js': { resolveLocalModelLocation: (config, _model, revision) => ({ cacheDir: config.SASS_EMBED_CACHE_DIR || ((config.SASS_HOME || '/synthetic/.sass') + '/models'), revision }) },
    './localEmbedConfig.js': loadSource('embeddings/localEmbedConfig.ts', {}, env),
    path: { join: (...parts) => parts.join('/') },
    '@huggingface/transformers': { env: transformerEnv },
    './localEmbedLoader.js': { loadLocalExtractor: async (_modelId, model, selectedOptions) => {
      calls.push(model);
      options.push(selectedOptions);
      modes.push({ remote: transformerEnv.allowRemoteModels, cacheDir: transformerEnv.cacheDir });
      if (failPrimary && model.includes('embeddinggemma')) throw new Error('Synthetic load failure');
      return Object.assign(async () => ({ data: new Float32Array(model.includes('MiniLM') ? 384 : 768).fill(1) }), { dispose: async () => {} });
    } },
  }, env);
  return { module, calls, options, modes, transformerEnv };
}

test('normal local preparation is offline and pins the requested Gemma 2 revision', async () => {
  const { module, calls, options, transformerEnv } = localFixture({});
  await module.ensureLocalEmbedder();
  assert.equal(options[0].local_files_only, true);
  assert.equal(options[0].revision, 'daa72c51243991dfcaf9f9137d2c573d8f7790c0');
  assert.equal(transformerEnv.allowRemoteModels, false);
  assert.equal(transformerEnv.allowLocalModels, true);
  assert.equal(transformerEnv.useFSCache, false);
  assert.equal(calls[0], '/synthetic/.sass/models/onnx-community/embeddinggemma-2-ONNX/daa72c51243991dfcaf9f9137d2c573d8f7790c0');
});

test('runtime stays offline even if an old download environment flag is set', async () => {
  const { module, options, transformerEnv } = localFixture({ SASS_ALLOW_MODEL_DOWNLOAD: '1' });
  await module.ensureLocalEmbedder();
  assert.equal(options[0].local_files_only, true);
  assert.equal(transformerEnv.allowRemoteModels, false);
});

test('explicit preparation downloads the pinned model then verifies the same cache offline', async () => {
  const { module, calls, options, modes } = localFixture({});
  const config = { SASS_EMBED_CACHE_DIR: '/synthetic/cache' };
  const result = await module.prepareLocalEmbedder(undefined, config);
  assert.equal(result.model, 'onnx-community/embeddinggemma-2-ONNX');
  assert.equal(result.dimension, 768);
  assert.equal(calls[0], result.model);
  assert.equal(calls[1], `/synthetic/cache/${result.model}/${options[0].revision}`);
  assert.deepEqual(options.map(option => option.local_files_only), [false, true]);
  assert.deepEqual(modes.map(mode => mode.remote), [true, false]);
  assert.deepEqual(modes.map(mode => mode.cacheDir), ['/synthetic/cache', '/synthetic/cache']);
});

test('preparation does not claim success when the selected model fails', async () => {
  const { module, calls } = localFixture({}, true);
  await assert.rejects(module.prepareLocalEmbedder(undefined, {}), /Synthetic load failure/);
  assert.equal(calls.length, 1);
});

test('consented setup invokes preparation and only saves the verified model', async () => {
  const calls = [];
  const local = loadSource('setup/localEmbeddingSetup.ts', {
    '../embeddings/localEmbed.js': {
      LOCAL_EMBED_PRIMARY: 'synthetic/model', LOCAL_EMBED_PRIMARY_DIM: 768,
      prepareLocalEmbedder: async (_progress, config) => {
        calls.push(config);
        return { model: 'synthetic/model', dimension: 768 };
      },
    },
    './spinner.js': { runWithSpinner: async (_label, work) => work() },
    './tui/prompterBridge.js': { isInkSessionActive: () => false, pushInkMessage() {} },
    './terminal.js': { note() {}, success() {} },
  }, { SASS_EMBED_CACHE_DIR: '/synthetic/cache' });
  const values = {};
  await local.setupLocalEmbeddings(values);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].SASS_EMBED_CACHE_DIR, '/synthetic/cache');
  assert.equal(values.SASS_EMBEDDING_PROVIDER, 'local');
  assert.equal(values.LOCAL_EMBED_MODEL, 'synthetic/model');
  assert.equal(values.EMBEDDING_DIMENSION, '768');
  assert.equal(values.SASS_ALLOW_MODEL_DOWNLOAD, undefined);
});

function memoryFixture(env, stored = []) {
  const calls = { local: 0, cloud: 0, sql: [], purposes: [] };
  const module = loadSource('vectorMemory.ts', {
    './database/userDataGuard.js': { captureUserDataToken: () => ({}), withUserDataWrite: async (_token, work) => work() },
    './memory/profilePolicy.js': { isValidDistilledProfile: () => true },
    './database/index.js': {
      isDatabaseConnected: () => true,
      getPool: () => { const query = async (sql, params) => {
        calls.sql.push({ sql, params });
        if (sql.includes('SELECT DISTINCT user_id')) return { rows: [{ user_id: 'synthetic-user' }] };
        if (sql.includes('SELECT COUNT')) return { rows: [{ count: String(stored.length) }] };
        if (sql.includes("type = 'roast' ORDER BY")) return { rows: stored.filter(row => !row.type || row.type === 'roast').slice().reverse(), rowCount: 0 };
        if (sql.includes('id = ANY')) return { rows: [], rowCount: params[2].length };
        return { rows: stored, rowCount: 0 };
      }; return { query, connect: async () => ({ query, release() {} }) }; },
    },
    './ai/providers.js': { getEmbeddingOpenAI: () => ({ embeddings: { create: async () => {
      calls.cloud++;
      return { data: [{ embedding: [1, 0] }] };
    } } }) },
    './ai/clientConfig.js': { resolveEmbeddingOpenAIConfig: () => ({ baseURL: undefined }) },
    './ai/prompts.js': {},
    './embeddings/localEmbed.js': {
      embedLocally: async (_text, purpose) => { calls.local++; calls.purposes.push(purpose); return [1, 0]; },
      localEmbeddingFingerprint: () => 'synthetic-model', localEmbeddingDimension: () => 2,
    },
  }, env);
  return { module, calls };
}

test('off does not embed, write or search', async () => {
  const { module, calls } = memoryFixture({ SASS_EMBEDDING_PROVIDER: 'off' });
  await module.storeMemory('guild', 'user', 'fact', 'synthetic fact');
  assert.equal((await module.searchMemories('query', { guildId: 'guild' })).length, 0);
  assert.equal(calls.local + calls.cloud, 0);
  assert.equal(calls.sql.length, 0);
});

test('unset provider preserves the legacy API embedding path', async () => {
  const { module, calls } = memoryFixture({});
  await module.storeMemory('guild', 'user', 'fact', 'synthetic fact');
  assert.equal(calls.cloud, 1);
  assert.equal(calls.local, 0);
});

test('a pinned fallback model remains pinned after restart', async () => {
  const { module, calls } = localFixture({ LOCAL_EMBED_MODEL: 'Xenova/all-MiniLM-L6-v2', EMBEDDING_DIMENSION: '384' });
  await module.ensureLocalEmbedder();
  assert.deepEqual(calls, ['/synthetic/.sass/models/Xenova/all-MiniLM-L6-v2']);
  assert.equal(module.localEmbeddingDimension(), 384);
});

test('failure of a pinned model does not silently fall back', async () => {
  const { module, calls } = localFixture({ LOCAL_EMBED_MODEL: 'onnx-community/embeddinggemma-300m-ONNX', EMBEDDING_DIMENSION: '768' }, true);
  await assert.rejects(module.ensureLocalEmbedder(), /Synthetic load failure/);
  assert.equal(calls.length, 1);
});

test('search excludes unknown spaces, different models and dimensions', async () => {
  const { module, calls } = memoryFixture({ SASS_EMBEDDING_PROVIDER: 'local' });
  await module.storeMemory('guild', 'user', 'fact', 'synthetic fact');
  const insert = calls.sql.find(({ sql }) => sql.includes('INSERT INTO vector_memories'));
  assert.match(insert.sql, /embedding_space/);
  const space = insert.params.at(-1);
  assert.equal(typeof space, 'string');
  const rows = [
    { content: 'match', type: 'fact', user_id: 'user', embedding: [1, 0], embedding_space: space },
    { content: 'unknown', type: 'fact', user_id: 'user', embedding: [1, 0], embedding_space: null },
    { content: 'other model', type: 'fact', user_id: 'user', embedding: [1, 0], embedding_space: 'other-model' },
    { content: 'other dimension', type: 'fact', user_id: 'user', embedding: [1, 0, 0], embedding_space: space },
  ];
  const search = memoryFixture({ SASS_EMBEDDING_PROVIDER: 'local' }, rows);
  const found = await search.module.searchMemories('query', { guildId: 'guild' });
  assert.deepEqual(Array.from(found, (row) => row.content), ['match']);
});

test('dedup preserves unknown or incompatible embedding spaces', async () => {
  const rows = [
    { id: 1, embedding: [1, 0], embedding_space: null },
    { id: 2, embedding: [1, 0], embedding_space: null },
    { id: 3, embedding: [1, 0], embedding_space: 'space-a' },
    { id: 4, embedding: [1, 0], embedding_space: 'space-b' },
    { id: 5, embedding: [1, 0, 0], embedding_space: 'space-a' },
  ];
  const { module, calls } = memoryFixture({}, rows);
  const result = await module.distillMemories('guild');
  assert.equal(result.deduped, 0);
  assert.equal(calls.sql.filter(({ sql }) => sql.includes('id = ANY')).length, 0);
});

test('fresh setup does not change models after a failed concurrent load', async () => {
  const { module, calls } = localFixture({}, true);
  const results = await Promise.allSettled([module.ensureLocalEmbedder(), module.ensureLocalEmbedder()]);
  assert.ok(results.every((result) => result.status === 'rejected'));
  assert.deepEqual(calls, ['/synthetic/.sass/models/onnx-community/embeddinggemma-2-ONNX/daa72c51243991dfcaf9f9137d2c573d8f7790c0']);
});

test('setup can pass a pin without mutating the runtime environment', async () => {
  const { module, calls } = localFixture({});
  await module.ensureLocalEmbedder(undefined, { LOCAL_EMBED_MODEL: 'Xenova/all-MiniLM-L6-v2', EMBEDDING_DIMENSION: '384' });
  assert.deepEqual(calls, ['/synthetic/.sass/models/Xenova/all-MiniLM-L6-v2']);
});

test('invalid or inconsistent pinned dimensions fail before model load', async () => {
  for (const dimension of ['bad', '0', '-1', '384']) {
    const { module, calls } = localFixture({ LOCAL_EMBED_MODEL: 'onnx-community/embeddinggemma-300m-ONNX', EMBEDDING_DIMENSION: dimension });
    await assert.rejects(module.ensureLocalEmbedder(), /EMBEDDING_DIMENSION/);
    assert.equal(calls.length, 0);
  }
});

test('same-space roasts dedup while raw legacy facts remain readable', async () => {
  const rows = [
    { id: 1, content: 'synthetic legacy fact', type: 'fact', embedding: [1, 0], embedding_space: null },
    { id: 2, content: 'older compatible roast', type: 'roast', embedding: [1, 0], embedding_space: 'space-a' },
    { id: 3, content: 'new compatible roast', type: 'roast', embedding: [1, 0], embedding_space: 'space-a' },
  ];
  const { module, calls } = memoryFixture({}, rows);
  const result = await module.distillMemories('guild');
  assert.equal(result.deduped, 1);
  const deletion = calls.sql.find(({ sql }) => sql.includes('id = ANY'));
  assert.deepEqual(Array.from(deletion.params[2]), [2]);
  const raw = await module.getUserMemories('guild', 'user');
  assert.ok(raw.some((row) => row.content === 'synthetic legacy fact'));
});

test('local setup keeps runtime cache locations without importing unrelated env settings', async () => {
  let config;
  const { setupLocalEmbeddings } = loadSource('setup/localEmbeddingSetup.ts', {
    './tui/prompterBridge.js': await import('../dist/setup/tui/prompterBridge.js'),
    '../embeddings/localEmbed.js': {
      prepareLocalEmbedder: async (_progress, selectedConfig) => { config = selectedConfig; return { dimension: 384, model: 'Xenova/all-MiniLM-L6-v2' }; },
      LOCAL_EMBED_PRIMARY: 'onnx-community/embeddinggemma-300m-ONNX', LOCAL_EMBED_PRIMARY_DIM: 768,
    },
    './spinner.js': { runWithSpinner: async (_label, work) => work() },
    './terminal.js': { note() {}, success() {} },
  }, {
    SASS_HOME: '/synthetic-runtime', SASS_EMBED_CACHE_DIR: '/synthetic-cache',
    LOCAL_EMBED_MODEL: 'unrelated-runtime-model', OPENAI_API_KEY: 'synthetic-secret',
  });
  const values = { LOCAL_EMBED_MODEL: 'Xenova/all-MiniLM-L6-v2', EMBEDDING_DIMENSION: '384' };
  await setupLocalEmbeddings(values);
  assert.equal(config.SASS_HOME, '/synthetic-runtime');
  assert.equal(config.SASS_EMBED_CACHE_DIR, '/synthetic-cache');
  assert.equal(config.LOCAL_EMBED_MODEL, 'Xenova/all-MiniLM-L6-v2');
  assert.equal(config.OPENAI_API_KEY, undefined);

  await setupLocalEmbeddings({ ...values, SASS_HOME: '/synthetic-config', SASS_EMBED_CACHE_DIR: '/synthetic-config-cache' });
  assert.equal(config.SASS_HOME, '/synthetic-config');
  assert.equal(config.SASS_EMBED_CACHE_DIR, '/synthetic-config-cache');
});


test('local memory uses document/query prefixes through one stable vector space', async () => {
  const { module, calls } = memoryFixture({ SASS_EMBEDDING_PROVIDER: 'local' });
  await module.storeMemory('guild', 'user', 'fact', 'synthetic fact');
  await module.searchMemories('synthetic question', { guildId: 'guild', userId: 'user' });
  assert.deepEqual(calls.purposes, ['document', 'query']);
});
