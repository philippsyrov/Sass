import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import ts from 'typescript';

const require = createRequire(import.meta.url);

function loadSource(relative, dependencies) {
  const url = new URL(relative, import.meta.url);
  const source = readFileSync(url, 'utf8').replaceAll('import.meta.url', JSON.stringify(url.href));
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(
    (id) => Object.hasOwn(dependencies, id) ? dependencies[id] : require(id), module, module.exports,
  );
  return module.exports;
}

function embeddedHarness(configText) {
  const operations = [];
  const fs = {
    existsSync: (path) => path.endsWith('PG_VERSION') || (path.endsWith('local-db.json') && configText !== undefined),
    readFileSync: () => configText,
    mkdirSync: () => operations.push('mkdir'),
    writeFileSync: () => operations.push('write'),
    chmodSync: () => operations.push('chmod'),
  };
  const fork = () => {
    operations.push('fork');
    const child = new EventEmitter();
    child.connected = true;
    child.send = () => queueMicrotask(() => child.emit('message', { type: 'error' }));
    child.disconnect = () => { child.connected = false; queueMicrotask(() => child.emit('exit', 0, null)); };
    return child;
  };
  const api = loadSource('../src/database/embeddedPostgres.ts', { fs, child_process: { fork } });
  return { api, operations };
}

const validConfig = JSON.stringify({ port: 54321, user: 'sass', password: 'synthetic-only', database: 'sass' });

test('embedded startup normalises a worker failure with no error detail', async () => {
  const { api } = embeddedHarness(validConfig);
  await assert.rejects(api.ensureEmbeddedPostgresRunning(), (error) => error instanceof Error && /Postgres.*failed/i.test(error.message));
});

for (const [label, config] of [['missing', undefined], ['corrupt', '{broken'], ['invalid', JSON.stringify({ port: -1, user: '', password: '', database: '' })]]) {
  test(`existing cluster with ${label} credentials fails without changing files or starting a database`, async () => {
    const { api, operations } = embeddedHarness(config);
    await assert.rejects(api.ensureEmbeddedPostgresRunning(), /local-db\.json.*restore|restore.*local-db\.json/i);
    assert.deepEqual(operations, []);
  });
}

test('pool startup stays nonfatal when the embedded dependency rejects without an error', async () => {
  const api = loadSource('../src/database/pool.ts', {
    './embeddedPostgres.js': {
      isEmbeddedPostgresEnabled: () => true,
      ensureEmbeddedPostgresRunning: async () => { throw undefined; },
      stopEmbeddedPostgres: async () => {},
    },
    pg: { Pool: class { constructor() { throw new Error('Pool should not start'); } } },
  });
  assert.equal(await api.connectPool(), false);
});
