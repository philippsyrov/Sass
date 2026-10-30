import assert from 'node:assert/strict';
import test from 'node:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { register } from 'tsx/esm/api';
register();
const { setupMemorySearch } = await import('../src/setup/memorySearchStep.ts');
const anthropic = { key: 'anthropic', aiProvider: 'openai', servesEmbeddings: false };
const openai = { key: 'openai', aiProvider: 'openai', servesEmbeddings: true };

function fixture(confirms, choices = []) {
  const calls = [];
  const values = {};
  const skipped = [];
  const p = {
    confirm: async (label, fallback) => { calls.push(['confirm', label, fallback]); return confirms.shift() ?? fallback; },
    choose: async (label, options) => { calls.push(['choose', label, options]); return choices.shift() ?? 0; },
    askValid: async () => 'synthetic-api-key',
  };
  const ports = {
    local: async () => { calls.push(['local']); values.SASS_EMBEDDING_PROVIDER = 'local'; },
    listOllama: async (host) => { calls.push(['list', host]); return { ok: true, data: ['chat:latest', 'nomic-embed-text:v1.5'] }; },
    health: async (config) => { calls.push(['health', { ...config }]); return { ok: true, detail: 'synthetic healthy' }; },
    note: (text) => calls.push(['note', text]),
    warn: (text) => calls.push(['warn', text]),
  };
  return { p, values, skipped, ports, calls };
}

async function run(f, preset = anthropic) {
  await setupMemorySearch(f.p, preset, {}, f.values, f.skipped, f.ports);
}

test('model destination uses home shorthand without exposing the account path', async () => {
  const f = fixture([false, false]);
  f.values.SASS_EMBED_CACHE_DIR = join(homedir(), 'synthetic-model-cache');
  await run(f);
  const destination = f.calls.find(([type, text]) => type === 'note' && text.startsWith('Model cache destination:'))[1];
  assert.ok(destination.includes('~'));
  assert.ok(!destination.includes(homedir()));
});

test('refusing local model consent keeps memory search off with no download', async () => {
  const f = fixture([false, false]);
  await run(f);
  assert.equal(f.values.SASS_EMBEDDING_PROVIDER, 'off');
  assert.ok(f.skipped.includes('Memory search model'));
  assert.ok(!f.calls.some(([type]) => type === 'local'));
  const consent = f.calls.find(([type, label]) => type === 'confirm' && /download/i.test(label));
  assert.equal(consent?.[2], false);
});

test('advanced off is chosen before local download', async () => {
  const f = fixture([true], [2]);
  await run(f);
  assert.equal(f.values.SASS_EMBEDDING_PROVIDER, 'off');
  assert.ok(!f.calls.some(([type]) => type === 'local'));
});

test('local consent shows model source and cache before the download starts', async () => {
  const f = fixture([false, true]);
  f.values.SASS_EMBED_CACHE_DIR = '/synthetic/cache';
  await run(f);
  assert.equal(f.values.SASS_EMBEDDING_PROVIDER, 'local');
  const localIndex = f.calls.findIndex(([type]) => type === 'local');
  const information = f.calls.slice(0, localIndex).map((call) => call.join(' ')).join('\n');
  assert.match(information, /huggingface\.co\/onnx-community\/embeddinggemma-2-ONNX/);
  assert.match(information, /\/synthetic\/cache/);
  assert.match(information, /download size not checked by this build/i);
});

test('OpenAI opt-in resets a stale model without preparing a local model', async () => {
  const f = fixture([true]);
  f.values.OPENAI_API_KEY = 'synthetic-chat-key';
  f.values.OPENAI_EMBEDDING_MODEL = 'old-ollama-model';
  await run(f, openai);
  assert.equal(f.values.OPENAI_EMBEDDING_MODEL, 'text-embedding-3-small');
  assert.ok(!f.calls.some(([type]) => type === 'local'));
});

test('Ollama uses exact installed model and probes it before accepting it', async () => {
  const f = fixture([true], [0, 1]);
  f.values.OLLAMA_HOST = 'http://synthetic.invalid:11434/';
  await run(f);
  assert.equal(f.values.SASS_EMBEDDING_PROVIDER, 'ollama');
  assert.equal(f.values.OPENAI_EMBEDDING_MODEL, 'nomic-embed-text:v1.5');
  assert.equal(f.values.EMBEDDING_OPENAI_BASE_URL, 'http://synthetic.invalid:11434/v1');
  const probe = f.calls.find(([type]) => type === 'health');
  assert.equal(probe?.[1].OPENAI_EMBEDDING_MODEL, 'nomic-embed-text:v1.5');
  assert.ok(!f.calls.some(([type]) => type === 'local'));
});

for (const state of ['unavailable', 'empty', 'not-an-embedder']) {
  test(`Ollama ${state} keeps memory search off without downloading`, async () => {
    const f = fixture([true], [0, 0]);
    if (state === 'unavailable') f.ports.listOllama = async () => ({ ok: false, error: 'synthetic offline' });
    if (state === 'empty') f.ports.listOllama = async () => ({ ok: true, data: [] });
    if (state === 'not-an-embedder') f.ports.health = async () => ({ ok: false, detail: 'synthetic model has no embeddings' });
    await run(f);
    assert.equal(f.values.SASS_EMBEDDING_PROVIDER, 'off');
    assert.ok(f.skipped.includes('Memory search model'));
    assert.ok(!f.calls.some(([type]) => type === 'local'));
  });
}

test('cancelling the installed-model prompt still cancels setup', async () => {
  const { SetupCancelledError } = await import('../src/setup/cancelRegistry.ts');
  const f = fixture([true], [0]);
  const original = f.p.choose;
  f.p.choose = async (label, options) => {
    if (label.startsWith('Installed Ollama')) throw new SetupCancelledError();
    return original(label, options);
  };
  await assert.rejects(run(f), SetupCancelledError);
});

test('advanced cloud resets the previous Ollama model without a local download', async () => {
  const f = fixture([true], [1]);
  f.values.OPENAI_EMBEDDING_MODEL = 'old-ollama-model';
  await run(f);
  assert.equal(f.values.OPENAI_EMBEDDING_MODEL, 'text-embedding-3-small');
  assert.equal(f.values.EMBEDDING_OPENAI_API_KEY, 'synthetic-api-key');
  assert.ok(!f.calls.some(([type]) => type === 'local'));
});
