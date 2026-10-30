import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

function load(path, imports = {}) {
  const code = ts.transpileModule(readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const ctx = { exports: {}, process: { env: {} }, console: { log() {}, error() {} }, setTimeout, clearTimeout, AbortController, Date, require: name => { if (!(name in imports)) throw Error(name); return imports[name]; } };
  vm.runInNewContext(code, ctx);
  return ctx.exports;
}
const policy = load('memory/profilePolicy.ts');
function fixture({ ai = async () => 'A user likes cats.', failCap = false, users = ['one'], connect, onQuery, onRelease } = {}) {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    const override = onQuery?.(sql);
    if (override) return override;
    if (failCap && sql.includes('OFFSET $3')) throw Error('cap failed');
    if (sql.includes('DISTINCT server_id')) return { rows: [{ server_id: 'g' }] };
    if (sql.includes('DISTINCT user_id')) return { rows: [{ user_id: 'one' }] };
    if (sql.includes("type = 'roast' ORDER BY")) return { rows: [] };
    if (sql.includes('SELECT user_id FROM users')) return { rows: users.map(user_id => ({ user_id })) };
    if (sql.includes('SELECT name, facts')) return { rows: [{ name: 'person', affinity: 50, facts: [], roasts: [] }] };
    if (sql.includes('SELECT content, type')) return { rows: [] };
    return { rows: [], rowCount: 1 };
  };
  const pool = { query, connect: connect ?? (async () => ({ query, release: failed => onRelease?.(failed) })) };
  const module = load('vectorMemory.ts', {
    './database/index.js': { isDatabaseConnected: () => true, getPool: () => pool },
    './database/userDataGuard.js': { captureUserDataToken: () => ({}), withUserDataWrite: async (_token, work) => work() },
    './memory/profilePolicy.js': policy,
    './ai/providers.js': { queryAI: ai }, './ai/prompts.js': {}, './ai/clientConfig.js': {},
  });
  return { module, calls };
}

test('cleanup rolls back on failure and scopes pruning and cap to roasts', async () => {
  const { module, calls } = fixture({ failCap: true });
  await assert.rejects(module.distillMemories('g'), /cap failed/);
  assert.ok(calls.some(x => x.sql === 'ROLLBACK'));
  assert.ok(!calls.some(x => x.sql === 'COMMIT'));
  for (const { sql } of calls.filter(x => x.sql.startsWith('DELETE'))) assert.match(sql, /type = 'roast'/);
  assert.ok(calls.some(x => x.sql.includes('OFFSET $3')));
});

test('profile validation rejects stale, malformed and refusal text', () => {
  for (const text of ['', '  ', '# Refusal', "I'm sorry, I can't help", 'word '.repeat(31), 'No information available']) assert.equal(policy.isValidDistilledProfile(text), false);
  assert.equal(policy.isUsableDistilledProfile('Likes cats.', null), false);
  assert.equal(policy.isUsableDistilledProfile('Likes cats.', new Date(0), policy.MAX_PROFILE_AGE_MS + 1), false);
  assert.equal(policy.isUsableDistilledProfile('Likes cats.', new Date(100), 101), true);
});

test('attempt budget limits runs and invalid output retains profile', async () => {
  let count = 0;
  const { module, calls } = fixture({ users: ['one', 'two'], ai: async () => { count++; return 'Likes cats.'; } });
  const result = await module.distillAllGuilds({ maxProfiles: 1 });
  assert.equal(result.status, 'limited'); assert.equal(count, 1);
  const invalid = fixture({ ai: async () => "I'm sorry, I can't do that." });
  assert.equal((await invalid.module.distillAllGuilds()).status, 'failed');
  assert.ok(!invalid.calls.some(x => x.sql.startsWith('UPDATE users')));
  assert.equal(calls.filter(x => x.sql.startsWith('UPDATE users')).length, 1);
});

test('overlap skips and abort cancels a hanging model without writing', async () => {
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const { module, calls } = fixture({ ai: async () => { started(); return new Promise(() => {}); } });
  const controller = new AbortController();
  const first = module.distillAllGuilds({ signal: controller.signal });
  await ready;
  assert.equal((await module.distillAllGuilds()).status, 'skipped');
  controller.abort();
  assert.equal((await first).status, 'aborted');
  assert.ok(!calls.some(x => x.sql.startsWith('UPDATE users')));
});

test('failed profile does not stop later users and stale snapshots are checked before saving', async () => {
  let prompt;
  let count = 0;
  const { module, calls } = fixture({ users: ['one', 'two'], ai: async text => {
    prompt = text;
    return ++count === 1 ? "I'm sorry, I can't do that." : 'Likes cats.';
  } });
  const result = await module.distillAllGuilds();
  assert.equal(result.status, 'failed');
  assert.equal(result.attempts, 2);
  assert.equal(result.updated, 1);
  assert.equal(result.failures, 1);
  assert.match(prompt, /Affinity: 50% \(neutral\)/);
  const update = calls.find(x => x.sql.startsWith('UPDATE users'));
  assert.match(update.sql, /ROW\(name, facts, roasts, message_count, times_roasted, gender, affinity\)/);
  assert.match(update.sql, /SELECT id FROM vector_memories/);
});

test('repeated limited runs rotate through stale users even if every generation fails', async () => {
  const { module, calls } = fixture({ users: ['one', 'two', 'three'], ai: async () => '' });
  for (let i = 0; i < 3; i++) assert.equal((await module.distillAllGuilds({ maxProfiles: 1 })).status, 'limited');
  const visited = calls.filter(x => x.sql.includes('SELECT name, facts')).map(x => x.params[1]);
  assert.equal(new Set(visited).size, 3);
});

test('abort while acquiring a connection releases the late client without starting SQL', async () => {
  let deliver;
  const pending = new Promise(resolve => { deliver = resolve; });
  let released = 0;
  let queries = 0;
  const { module } = fixture({ connect: () => pending });
  const controller = new AbortController();
  const result = module.distillAllGuilds({ signal: controller.signal });
  controller.abort();
  assert.equal((await result).status, 'aborted');
  deliver({ query: async () => { queries++; }, release: () => { released++; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(queries, 0);
  assert.equal(released, 1);
});

test('cleanup sets finite local SQL and lock timeouts before its advisory lock', async () => {
  const { module, calls } = fixture();
  await module.distillAllGuilds();
  const lock = calls.findIndex(x => x.sql.includes('pg_advisory_xact_lock'));
  const setting = calls.slice(0, lock).findLast(x => x.sql.includes("set_config('statement_timeout'"));
  assert.ok(setting);
  const timeout = Number.parseInt(setting.params[0], 10);
  assert.ok(timeout >= 1 && timeout <= 5000);
});

test('abort after acquiring cleanup lock discards the transaction before deletion', async () => {
  const controller = new AbortController();
  const releases = [];
  const { module, calls } = fixture({ onQuery: sql => { if (sql.includes('pg_advisory_xact_lock')) controller.abort(); }, onRelease: failed => releases.push(failed) });
  const result = await module.distillAllGuilds({ signal: controller.signal });
  assert.equal(result.status, 'aborted');
  assert.ok(releases.includes(true));
  assert.ok(!calls.some(x => x.sql.startsWith('DELETE')));
});

test('hanging BEGIN is destroyed on abort and late rejection does not issue more queries', async () => {
  let rejectQuery, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const hanging = new Promise((_, reject) => { rejectQuery = reject; });
  const releases = [];
  const { module, calls } = fixture({
    onQuery: sql => { if (sql === 'BEGIN') { entered(); return hanging; } },
    onRelease: failed => releases.push(failed),
  });
  const controller = new AbortController();
  const job = module.distillAllGuilds({ signal: controller.signal });
  await started; controller.abort();
  assert.equal((await job).status, 'aborted');
  assert.deepEqual(releases, [true]);
  rejectQuery(new Error('synthetic late transport error'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.deepEqual(releases, [true]);
});

test('hanging SQL is destroyed on deadline and late completion cannot continue transaction', async () => {
  let finish, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const hanging = new Promise(resolve => { finish = resolve; });
  const releases = [];
  const { module, calls } = fixture({
    onQuery: sql => { if (sql.includes('DISTINCT server_id')) { entered(); return hanging; } },
    onRelease: failed => releases.push(failed),
  });
  const job = module.distillAllGuilds({ timeoutMs: 25 });
  await started;
  assert.equal((await job).status, 'limited');
  assert.deepEqual(releases, [true]);
  finish({ rows: [{ server_id: 'g' }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(!calls.some(x => x.sql === 'COMMIT' || x.sql === 'ROLLBACK'));
  assert.deepEqual(releases, [true]);
});

test('hanging cleanup lock is destroyed on abort with no later deletion', async () => {
  let finish, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const hanging = new Promise(resolve => { finish = resolve; });
  const releases = [];
  const { module, calls } = fixture({
    onQuery: sql => { if (sql.includes('pg_advisory_xact_lock')) { entered(); return hanging; } },
    onRelease: failed => releases.push(failed),
  });
  const controller = new AbortController();
  const job = module.distillAllGuilds({ signal: controller.signal });
  await started; controller.abort();
  assert.equal((await job).status, 'aborted');
  assert.equal(releases.filter(Boolean).length, 1);
  finish({ rows: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(!calls.some(x => x.sql.startsWith('DELETE')));
  assert.equal(releases.filter(Boolean).length, 1);
});
