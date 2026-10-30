import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { register } from 'tsx/esm/api';
register();
const budget = await import('../src/ai/replyBudget.ts');

function fixture(env, chat = async () => ({ message: { content: 'ok' } }), fetchPort = fetch) {
  const calls = [];
  class Ollama { constructor(config) { calls.push(['config', config]); } chat(body) { calls.push(['ollama', body]); return chat(body); } }
  class OpenAI { constructor() { this.chat = { completions: { create: async (body, options) => { calls.push(['openai', body, options]); return { choices: [{ message: { content: 'ok' } }] }; } } }; } }
  const imports = { ollama: { Ollama }, openai: { __esModule: true, default: OpenAI }, './clientConfig.js': { resolveChatOpenAIConfig: () => ({}), resolveEmbeddingOpenAIConfig: () => ({}) }, './replyBudget.js': budget, './prompts.js': { SASS_SYSTEM_PROMPT: 'system', fixCustomEmoji: x => x } };
  const code = ts.transpileModule(readFileSync(new URL('../src/ai/providers.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const context = { exports: {}, process: { env }, require: name => imports[name], console: { log() {}, warn() {}, error() {} }, AbortSignal, fetch: fetchPort, Uint8Array };
  vm.runInNewContext(code, context);
  return { api: context.exports, calls };
}

test('native Ollama receives per-call limits and sampling while chat retains defaults', async () => {
  const f = fixture({ AI_PROVIDER: 'ollama', OLLAMA_MODEL: 'llama' });
  await f.api.queryAI('hello', { maxTokens: 60, temperature: 0.3 });
  await f.api.queryAI('hello');
  assert.equal(f.calls[1][1].options.num_predict, 60);
  assert.equal(f.calls[1][1].options.temperature, 0.3);
  assert.equal(f.calls[3][1].options.num_predict, 4096);
});

test('OpenAI receives signal, deadline, sampling, and the reasoning budget', async () => {
  const f = fixture({ AI_PROVIDER: 'openai', OPENAI_MODEL: 'gpt-5.4-mini' });
  const controller = new AbortController();
  await f.api.queryAI('hello', { maxTokens: 60, signal: controller.signal, timeoutMs: 500 });
  assert.equal(f.calls[0][1].max_completion_tokens, 16384);
  assert.equal(f.calls[0][2].timeout, 500);
  assert.ok(f.calls[0][2].signal instanceof AbortSignal);
  controller.abort();
  assert.equal(f.calls[0][2].signal.aborted, true);
});

test('unsupported provider fails without producing persistable persona text', async () => {
  const f = fixture({ AI_PROVIDER: 'bogus' });
  await assert.rejects(f.api.queryAI('hello'), { name: 'UnsupportedAIProviderError' });
});

test('native request ends on cancellation or deadline and does not retry images', async () => {
  for (const timeout of [false, true]) {
    const f = fixture({ AI_PROVIDER: 'ollama' }, () => new Promise(() => {}));
    const controller = new AbortController();
    const request = f.api.queryAI('hello', { signal: controller.signal, ...(timeout ? { timeoutMs: 10 } : {}) });
    if (!timeout) controller.abort();
    const keepAlive = setTimeout(() => {}, 1000);
    try { await assert.rejects(request); } finally { clearTimeout(keepAlive); }
    assert.ok(f.calls.length <= 2);
    assert.equal(typeof f.calls[0][1].fetch === 'function', true);
  }
});


test('aborting an image request does not fall back to text-only', async () => {
  const controller = new AbortController();
  const f = fixture({ AI_PROVIDER: 'ollama' }, () => new Promise(() => {}), async () => new Response(new Uint8Array([1])));
  const request = f.api.queryAI('hello', { imageUrl: 'https://example.invalid/image', signal: controller.signal });
  await new Promise(resolve => setTimeout(resolve, 10));
  controller.abort();
  await assert.rejects(request);
  assert.equal(f.calls.filter(call => call[0] === 'ollama').length, 1);
});
