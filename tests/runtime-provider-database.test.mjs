import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);

// Run only this module with synthetic process results. No Postgres or Docker starts.
function externalHarness(mode) {
  const calls = [];
  function result(cmd, args) {
    calls.push([cmd, args]);
    if (cmd === 'which' || cmd === 'where') return { code: args[0] === 'docker' && mode.startsWith('native') ? 1 : 0, stdout: args[0] };
    if (cmd === 'docker') {
      if (args[0] === 'exec' && mode === 'docker-unready') return { code: 1, stdout: '' };
      if (args[0] === 'ps') return { code: 0, stdout: 'sass-postgres\n' };
      if (args[0] === 'inspect') return { code: 0, stdout: 'POSTGRES_PASSWORD=synthetic-password\n' };
      return { code: 0, stdout: args[0] === 'exec' ? 'accepting connections' : '' };
    }
    if (cmd === 'pg_isready') return { code: mode.startsWith('native') ? 0 : 127, stdout: mode.startsWith('native') ? 'accepting connections' : '' };
    if (cmd === 'psql') return { code: 0, stdout: /pg_roles/.test(args.at(-1)) && mode !== 'native-new' ? '1\n' : '' };
    throw new Error(`Unexpected command: ${cmd}`);
  }
  const execFile = () => {};
  execFile[promisify.custom] = async (cmd, args) => {
    const value = result(cmd, args);
    if (value.code !== 0) throw new Error('synthetic unavailable command');
    return { stdout: value.stdout, stderr: '' };
  };
  const spawn = (cmd, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const value = result(cmd, args);
    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from(value.stdout));
      child.emit('exit', value.code);
    });
    return child;
  };
  const source = readFileSync(new URL('../src/setup/externalPostgres.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'setTimeout', compiled)(
    (id) => id === 'child_process' ? { execFile, spawn } : require(id),
    module, module.exports, (callback) => { queueMicrotask(callback); },
  );
  return { provision: module.exports.provisionExternalPostgres, calls };
}

test('Docker readiness works without host PostgreSQL tools', async () => {
  const { provision, calls } = externalHarness('docker');
  const result = await provision();
  assert.equal(result.ok, true);
  assert.ok(calls.some(([cmd, args]) => cmd === 'docker' && args[0] === 'exec' && args.includes('pg_isready')));
  assert.ok(!calls.some(([cmd]) => cmd === 'pg_isready'));
});

test('native setup does not invent credentials for an existing sass role', async () => {
  const { provision, calls } = externalHarness('native');
  const result = await provision();
  assert.equal(result.ok, false);
  assert.match(result.detail, /existing.*DATABASE_URL|DATABASE_URL.*existing/i);
  assert.ok(!calls.some(([cmd, args]) => cmd === 'psql' && /CREATE USER|ALTER ROLE/.test(args.at(-1))));
});

test('Docker readiness stops after bounded retries', async () => {
  const { provision, calls } = externalHarness('docker-unready');
  const result = await provision();
  assert.equal(result.ok, false);
  assert.equal(calls.filter(([cmd, args]) => cmd === 'docker' && args[0] === 'exec').length, 30);
});

test('native first setup returns the password it assigns and cannot prompt', async () => {
  const { provision, calls } = externalHarness('native-new');
  const result = await provision();
  assert.equal(result.ok, true);
  const psqlCalls = calls.filter(([cmd]) => cmd === 'psql');
  assert.ok(psqlCalls.every(([, args]) => args.includes('-w')));
  const create = psqlCalls.find(([, args]) => /CREATE USER/.test(args.at(-1)));
  const assigned = /WITH PASSWORD '([^']+)'/.exec(create[1].at(-1))[1];
  assert.equal(new URL(result.databaseUrl).password, assigned);
});

test('Anthropic utility requests omit sampling settings rejected by current Claude models', async () => {
  const { register } = await import('tsx/esm/api');
  register();
  const { queryAIWithUsage, resetOpenAIClientsForTests } = await import('../src/ai/providers.ts');
  const saved = { ...process.env };
  const originalFetch = globalThis.fetch;
  const requests = [];
  try {
    process.env.AI_PROVIDER = 'openai';
    process.env.OPENAI_BASE_URL = 'https://api.anthropic.com/v1';
    process.env.OPENAI_API_KEY = 'synthetic-key';
    process.env.OPENAI_MODEL = 'claude-sonnet-5-5';
    globalThis.fetch = async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'synthetic reply' } }] }), { headers: { 'content-type': 'application/json' } });
    };
    resetOpenAIClientsForTests();
    await queryAIWithUsage('synthetic utility prompt', { temperature: 0.3 });
    assert.equal(Object.hasOwn(requests[0], 'temperature'), false);
    process.env.OPENAI_BASE_URL = 'https://example.invalid/v1';
    process.env.OPENAI_MODEL = 'compatible-model';
    resetOpenAIClientsForTests();
    await queryAIWithUsage('synthetic ordinary prompt', { temperature: 0.3 });
    assert.equal(requests[1].temperature, 0.3);
  } finally {
    globalThis.fetch = originalFetch;
    process.env = saved;
    resetOpenAIClientsForTests();
  }
});

test('Claude chat, creator and profile requests reserve thinking space and share provider rules', async () => {
  const { register } = await import('tsx/esm/api');
  register();
  const { queryAIWithUsage, resetOpenAIClientsForTests } = await import('../src/ai/providers.ts');
  const { getSassResponse, analyzeProfile, summarizeMessages } = await import('../src/ai/responses.ts');
  const saved = { ...process.env };
  const originalFetch = globalThis.fetch;
  const requests = [];
  try {
    Object.assign(process.env, { AI_PROVIDER: 'openai', OPENAI_BASE_URL: 'https://api.anthropic.com/v1', OPENAI_API_KEY: 'synthetic-key', OPENAI_MODEL: 'claude-sonnet-5-5' });
    globalThis.fetch = async (_url, options) => {
      const request = JSON.parse(options.body);
      requests.push(request);
      const text = request.max_completion_tokens >= 4096 ? 'synthetic reply' : null;
      return new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: text ? 'stop' : 'length' }], usage: { prompt_tokens: 10, completion_tokens: text ? 120 : 100 } }), { headers: { 'content-type': 'application/json' } });
    };
    resetOpenAIClientsForTests();
    assert.equal((await queryAIWithUsage('synthetic mention')).text, 'synthetic reply');
    assert.equal((await getSassResponse('synthetic creator question', { isCreator: true })).text, 'synthetic reply');
    assert.equal(await analyzeProfile('Example', 'synthetic history'), 'synthetic reply');
    assert.equal(await summarizeMessages([{ content: 'synthetic history', displayName: 'Example' }]), 'synthetic reply');
    assert.equal(requests.length, 4);
    for (const request of requests) {
      assert.equal(request.model, 'claude-sonnet-5-5');
      assert.equal(request.max_completion_tokens, 16384);
      assert.equal(Object.hasOwn(request, 'temperature'), false);
    }
  } finally {
    globalThis.fetch = originalFetch;
    process.env = saved;
    resetOpenAIClientsForTests();
  }
});

test('empty API replies log safe finish metadata without replaying private prompts or keys', async () => {
  const { register } = await import('tsx/esm/api');
  register();
  const { queryAIWithUsage, resetOpenAIClientsForTests } = await import('../src/ai/providers.ts');
  const saved = { ...process.env };
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const warnings = [];
  try {
    Object.assign(process.env, { AI_PROVIDER: 'openai', OPENAI_BASE_URL: 'https://example.invalid/v1', OPENAI_API_KEY: 'private-test-key' });
    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: null }, finish_reason: 'length' }], usage: { completion_tokens: 100, completion_tokens_details: { reasoning_tokens: 100 } } }), { headers: { 'content-type': 'application/json' } });
    console.warn = (...args) => warnings.push(args.join(' '));
    resetOpenAIClientsForTests();
    assert.equal((await queryAIWithUsage('private-test-prompt')).text, null);
    assert.match(warnings.join('\n'), /finish=length/);
    assert.match(warnings.join('\n'), /reasoning=100/);
    assert.doesNotMatch(warnings.join('\n'), /private-test/);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    process.env = saved;
    resetOpenAIClientsForTests();
  }
});

test('creator requests retain retrieved memory without changing the creator system prompt', async () => {
  const { register } = await import('tsx/esm/api');
  register();
  const { resetOpenAIClientsForTests } = await import('../src/ai/providers.ts');
  const { getSassResponse } = await import('../src/ai/responses.ts');
  const { CREATOR_SYSTEM_PROMPT } = await import('../src/ai/prompts.ts');
  const saved = { ...process.env };
  const originalFetch = globalThis.fetch;
  let request;
  try {
    Object.assign(process.env, { AI_PROVIDER: 'openai', OPENAI_BASE_URL: 'https://api.anthropic.com/v1', OPENAI_API_KEY: 'synthetic-key', OPENAI_MODEL: 'claude-sonnet-5-5' });
    globalThis.fetch = async (_url, options) => {
      request = JSON.parse(options.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'synthetic reply' } }] }), { headers: { 'content-type': 'application/json' } });
    };
    resetOpenAIClientsForTests();
    await getSassResponse('what do you remember?', { isCreator: true, userContext: 'RELEVANT MEMORIES: Example likes astronomy.' });
    assert.equal(request.messages[0].content, CREATOR_SYSTEM_PROMPT);
    assert.match(request.messages[1].content, /Example likes astronomy/);
  } finally {
    globalThis.fetch = originalFetch;
    process.env = saved;
    resetOpenAIClientsForTests();
  }
});

test('native Ollama replies and profiles share a configurable budget without legacy tiny utility caps', async () => {
  const { register } = await import('tsx/esm/api');
  register();
  const { queryAIWithUsage } = await import('../src/ai/providers.ts');
  const { analyzeProfile } = await import('../src/ai/responses.ts');
  const saved = { ...process.env };
  const originalFetch = globalThis.fetch;
  const requests = [];
  try {
    Object.assign(process.env, { AI_PROVIDER: 'ollama', OLLAMA_HOST: 'http://example.invalid', OLLAMA_MODEL: 'synthetic-model' });
    delete process.env.SASS_REPLY_MAX_TOKENS;
    globalThis.fetch = async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ message: { role: 'assistant', content: 'synthetic reply' }, done: true }), { headers: { 'content-type': 'application/json' } });
    };
    assert.equal((await queryAIWithUsage('synthetic summary', { maxTokens: 60 })).text, 'synthetic reply');
    assert.equal(await analyzeProfile('Example', 'synthetic history'), 'synthetic reply');
    process.env.SASS_REPLY_MAX_TOKENS = '8192';
    await queryAIWithUsage('synthetic reply');
    assert.deepEqual(requests.map(request => request.options?.num_predict), [60, 4096, 8192]);
  } finally { globalThis.fetch = originalFetch; process.env = saved; }
});


test('unknown provider cannot send creator or profile requests to Ollama', async () => {
  const { register } = await import('tsx/esm/api');
  register();
  const { getSassResponse, analyzeProfile } = await import('../src/ai/responses.ts');
  const saved = { ...process.env };
  const originalFetch = globalThis.fetch;
  let requests = 0;
  try {
    process.env.AI_PROVIDER = 'unsupported';
    globalThis.fetch = async () => { requests++; throw new Error('unexpected network request'); };
    await assert.rejects(getSassResponse('hello', { isCreator: true }), { name: 'UnsupportedAIProviderError' });
    await assert.rejects(analyzeProfile('Example', 'hello'), { name: 'UnsupportedAIProviderError' });
    assert.equal(requests, 0);
  } finally { globalThis.fetch = originalFetch; process.env = saved; }
});
