import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { arch, platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { register } from 'tsx/esm/api';

register();
const database = await import('../src/database/pool.ts');
const state = await import('../src/database/maintenanceState.ts');
const require = createRequire(import.meta.url);
let binaries = false;
try { require.resolve(`@embedded-postgres/${platform()}-${arch()}`); binaries = true; } catch { /* No downloads in tests. */ }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function fakeState(pool, timers = {}) {
  const source = readFileSync(new URL('../src/database/maintenanceState.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', code)(
    id => id === './pool.js' ? { getPool: () => pool } : require(id), module, module.exports,
    timers.setTimeout ?? setTimeout, timers.clearTimeout ?? clearTimeout,
  );
  return module.exports;
}

test('maintenance attempts survive a database restart and update one job row', { skip: !binaries, timeout: 30000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'sass-maintenance-'));
  const keys = ['SASS_TEST_DATA_DIR', 'SASS_EMBEDDED_PG', 'SASS_TEST_SKIP_EMBEDDED', 'DATABASE_URL'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  let configured = false;
  t.after(async () => {
    if (configured) await database.closeDatabase();
    for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : process.env[key] = value;
    await rm(dir, { recursive: true, force: true });
  });
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  await writeFile(join(dir, 'local-db.json'), JSON.stringify({ port, user: 'synthetic', password: 'synthetic-test-password', database: 'sass' }), { mode: 0o600 });
  Object.assign(process.env, { SASS_TEST_DATA_DIR: dir, SASS_EMBEDDED_PG: '1', SASS_TEST_SKIP_EMBEDDED: '' });
  configured = true;
  assert.equal(await database.connectPool(), true);
  database.setConnected(true);
  await database.getRawPool().query('CREATE TABLE maintenance_state (job_name TEXT PRIMARY KEY, started_at TIMESTAMPTZ NOT NULL)');
  assert.equal(await state.lastDistillationRun(), null);
  const first = Date.UTC(2026, 0, 1, 12, 0, 0, 123);
  const second = first + 123456;
  await state.recordDistillationRun(first);
  await state.recordDistillationRun(second);
  assert.equal(await state.lastDistillationRun(), second);
  assert.equal((await database.getRawPool().query('SELECT count(*)::int AS count FROM maintenance_state')).rows[0].count, 1);
  await database.closeDatabase();
  assert.equal(await database.connectPool(), true);
  database.setConnected(true);
  assert.equal(await state.lastDistillationRun(), second);
});

test('cancellation while acquiring releases the late client and never queries it', async () => {
  const pending = deferred();
  const releases = [];
  let queries = 0;
  const api = fakeState({ connect: () => pending.promise });
  const controller = new AbortController();
  const operation = api.lastDistillationRun(controller.signal);
  controller.abort();
  await assert.rejects(operation, /operation stopped/);
  pending.resolve({ release: failed => releases.push(failed), query: () => { queries++; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(releases, [true]);
  assert.equal(queries, 0);
});

test('cancellation during query discards the client exactly once', async () => {
  const entered = deferred(), pending = deferred(), releases = [];
  const api = fakeState({ connect: async () => ({ release: failed => releases.push(failed), query: () => { entered.resolve(); return pending.promise; } }) });
  const controller = new AbortController();
  const operation = api.recordDistillationRun(0, controller.signal);
  await entered.promise;
  controller.abort();
  await assert.rejects(operation, /operation stopped/);
  pending.resolve({ rows: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(releases, [true]);
});

test('five-second limit interrupts an in-flight query and discards its connection', async () => {
  let fire, delay;
  const entered = deferred(), pending = deferred(), releases = [];
  const api = fakeState({ connect: async () => ({ release: failed => releases.push(failed), query: () => { entered.resolve(); return pending.promise; } }) }, {
    setTimeout: (callback, ms) => { fire = callback; delay = ms; return 1; }, clearTimeout: () => {},
  });
  const operation = api.lastDistillationRun();
  await entered.promise;
  assert.equal(delay, 5000);
  fire();
  await assert.rejects(operation, /operation stopped/);
  pending.resolve({ rows: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(releases, [true]);
});
