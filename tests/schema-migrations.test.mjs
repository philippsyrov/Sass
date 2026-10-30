import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const schemaUrl = new URL('../src/database/schema.ts', import.meta.url);
const originalRows = [
  { user1_id: 'user-a', user2_id: 'user-b', interaction_count: 7, last_interaction: '2026-01-02T03:04:05Z' },
  { user1_id: 'user-c', user2_id: 'user-d', interaction_count: 2, last_interaction: null },
];

// SQL is the external boundary. No server starts, and no local migration files are read.
function schemaHarness({ mode = 'fresh', fail = () => false, servers = ['guild-b'], files = {}, mappings = [], failRename = false } = {}) {
  const remainingFiles = structuredClone(files);
  const renamed = [];
  let state = { imported: [], exists: mode !== 'fresh', scoped: mode === 'existing', rows: mode === 'fresh' ? [] : structuredClone(originalRows) };
  if (mode === 'existing') state.rows = state.rows.map((row, index) => ({ ...row, server_id: `guild-${index}` }));
  let snapshot;
  let released = false;
  const calls = [];
  const logs = [];
  async function query(connection, sql, values = []) {
    const text = sql.replace(/\s+/g, ' ').trim();
    calls.push({ connection, text, values });
    if (fail(text)) throw new Error('synthetic migration failure');
    if (text === 'BEGIN') { snapshot = structuredClone(state); return { rows: [] }; }
    if (text === 'ROLLBACK') { state = snapshot; return { rows: [] }; }
    if (text === 'COMMIT') { snapshot = undefined; return { rows: [] }; }
    if (text.includes('CREATE TABLE IF NOT EXISTS interactions')) {
      if (!state.exists) state = { imported: [], exists: true, scoped: true, rows: [] };
      return { rows: [] };
    }
    if (/SELECT.*(?:column_name|attname).*pair_interactions/.test(text)) {
      return { rows: state.scoped ? [{ column_name: 'server_id' }] : [] };
    }
    if (text.startsWith('SELECT user1_id')) {
      if (!state.exists) throw new Error('relation "pair_interactions" does not exist');
      return { rows: structuredClone(state.rows) };
    }
    if (text.startsWith('DROP TABLE pair_interactions')) {
      state = { exists: false, scoped: false, rows: [] };
      return { rows: [] };
    }
    if (text.startsWith('SELECT DISTINCT user_id, server_id')) return { rows: mappings };
    if (text.startsWith('INSERT INTO ')) {
      if (text.startsWith('INSERT INTO wild_quotes') && state.imported.some((row) =>
        row.text.startsWith('INSERT INTO wild_quotes') && row.values[0] === values[0] && row.values[3] === values[3])) {
        if (text.includes('ON CONFLICT (server_id, quote) DO NOTHING')) return { rows: [] };
        throw new Error('duplicate synthetic quote key');
      }
      state.imported.push({ text, values });
      return { rows: [] };
    }
    if (text.startsWith('SELECT server_id, COUNT(*)')) return { rows: servers.map((server_id) => ({ server_id, cnt: '2' })) };
    if (text.includes('FROM pg_constraint')) return { rows: [{ conname: 'old_pair_primary_key' }] };
    if (text.startsWith('ALTER TABLE pair_interactions ADD COLUMN server_id')) { state.scoped = true; return { rows: [] }; }
    if (text.startsWith('UPDATE pair_interactions SET server_id')) {
      state.rows = state.rows.map((row) => ({ ...row, server_id: values[0] }));
      return { rows: [] };
    }
    if (text.includes("table_name = 'users'") && text.includes("column_name = 'affinity'")) return { rows: [{ data_type: 'real' }] };
    return { rows: [] };
  }
  const client = { query: (sql, values) => query('client', sql, values), release: () => { released = true; } };
  const pool = { query: (sql, values) => query('pool', sql, values), connect: async () => client };
  const source = readFileSync(schemaUrl, 'utf8').replaceAll('import.meta.url', JSON.stringify(schemaUrl.href));
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'console', compiled)(
    (id) => id === './pool.js' ? { getRawPool: () => pool } : id === 'fs' ? {
      existsSync: (file) => Object.hasOwn(remainingFiles, basename(file)),
      readFileSync: (file) => JSON.stringify(remainingFiles[basename(file)]),
      renameSync: (file, target) => {
        if (typeof failRename === 'function' ? failRename() : failRename) throw new Error('synthetic rename failure');
        renamed.push([basename(file), basename(target)]);
        calls.push({ text: `RENAME ${basename(file)}`, connection: 'filesystem' });
        delete remainingFiles[basename(file)];
      },
    } : require(id),
    module, module.exports, { log: (...args) => logs.push(args.join(' ')), error: (...args) => logs.push(args.join(' ')) },
  );
  return { renamed, remainingFiles, createSchema: module.exports.createSchema, calls, logs, state: () => structuredClone(state), released: () => released };
}

test('fresh schema does not attempt a legacy table migration or log a false error', async () => {
  const h = schemaHarness();
  await h.createSchema();
  assert.equal(h.state().exists, true);
  assert.equal(h.state().scoped, true);
  assert.deepEqual(h.state().rows, []);
  assert.equal(h.logs.some((line) => /migration.*fail|relation.*does not exist/i.test(line)), false);
  assert.equal(h.calls.some(({ text }) => text.startsWith('SELECT user1_id')), false);
});

test('existing guild-scoped pairs stay unchanged on repeated schema setup', async () => {
  const h = schemaHarness({ mode: 'existing' });
  const before = h.state();
  await h.createSchema();
  await h.createSchema();
  assert.deepEqual(h.state(), before);
  assert.equal(h.calls.some(({ text }) => /^(DROP TABLE|UPDATE pair_interactions|ALTER TABLE pair_interactions)/.test(text)), false);
});

test('legacy migration preserves rows in place and commits on one connection', async () => {
  const h = schemaHarness({ mode: 'legacy' });
  await h.createSchema();
  assert.deepEqual(h.state().rows, originalRows.map((row) => ({ ...row, server_id: 'guild-b' })));
  assert.equal(h.calls.some(({ text }) => text.startsWith('DROP TABLE')), false);
  const start = h.calls.findIndex(({ text }) => text === 'BEGIN');
  const end = h.calls.findIndex(({ text }) => text === 'COMMIT');
  assert.ok(start >= 0 && end > start);
  assert.ok(h.calls.slice(start, end + 1).every(({ connection }) => connection === 'client'));
  assert.ok(h.calls.some(({ text }) => text.startsWith('LOCK TABLE pair_interactions')));
  assert.equal(h.released(), true);
});

test('legacy migration uses the established unknown guild fallback without interaction history', async () => {
  const h = schemaHarness({ mode: 'legacy', servers: [] });
  await h.createSchema();
  assert.deepEqual(h.state().rows, originalRows.map((row) => ({ ...row, server_id: 'unknown' })));
});

test('failed legacy migration rolls back every row and rejects schema readiness', async () => {
  const h = schemaHarness({ mode: 'legacy', fail: (sql) => sql.includes('ADD PRIMARY KEY') });
  const before = h.state();
  await assert.rejects(h.createSchema(), /synthetic migration failure/);
  assert.deepEqual(h.state(), before);
  assert.ok(h.calls.some(({ text, connection }) => text === 'ROLLBACK' && connection === 'client'));
  assert.equal(h.calls.some(({ text }) => text === 'COMMIT'), false);
  assert.equal(h.released(), true);
});

for (const [name, fail] of [
  ['pair schema inspection', (sql) => /SELECT.*(?:column_name|attname).*pair_interactions/.test(sql)],
  ['embedding space column', (sql) => sql.startsWith('ALTER TABLE vector_memories ADD COLUMN IF NOT EXISTS embedding_space')],
  ['affinity type inspection', (sql) => sql.includes("table_name = 'users'") && sql.includes("column_name = 'affinity'")],
  ['distilled profile column', (sql) => sql.includes('ADD COLUMN IF NOT EXISTS distilled_profile')],
]) {
  test(`required ${name} failure rejects schema readiness`, async () => {
    const h = schemaHarness({ fail });
    await assert.rejects(h.createSchema(), /synthetic migration failure/);
  });
}


const legacyUser = { name: 'Synthetic user', roasts: ['synthetic roast'], lastSeen: 1000, messageCount: 2, timesRoasted: 1, facts: ['synthetic fact'] };
const guildMappings = [
  { user_id: 'user-a', server_id: 'guild-a' },
  { user_id: 'user-a', server_id: 'guild-b' },
];

test('legacy files use existing guild assignments and rename only after commit', async () => {
  const h = schemaHarness({
    files: { 'user-memory.json': { 'user-a': legacyUser }, 'mood.json': { mood: 'neutral', intensity: 1 } },
    mappings: guildMappings,
  });
  await h.createSchema();
  assert.deepEqual(h.state().imported.map(({ values }) => values[0]), ['guild-a', 'guild-b', 'guild-a']);
  assert.deepEqual(h.renamed.map(([file]) => file), ['user-memory.json', 'mood.json']);
  const commit = h.calls.findIndex(({ text }) => text === 'COMMIT');
  assert.ok(commit >= 0 && commit < h.calls.findIndex(({ text }) => text.startsWith('RENAME')));
  assert.ok(h.calls.filter(({ text }) => text.startsWith('INSERT INTO')).every(({ connection }) => connection === 'client'));
});

test('failed legacy file import rolls back all files and keeps every source', async () => {
  const h = schemaHarness({
    files: { 'user-memory.json': { 'user-a': legacyUser }, 'mood.json': { mood: 'neutral' } },
    mappings: guildMappings,
    fail: (sql) => sql.startsWith('INSERT INTO mood_state'),
  });
  await assert.rejects(h.createSchema(), /synthetic migration failure/);
  assert.deepEqual(h.state().imported, []);
  assert.deepEqual(h.renamed, []);
  assert.ok(h.calls.some(({ text }) => text === 'ROLLBACK'));
  assert.equal(h.released(), true);
});

for (const [file, data] of [
  ['user-memory.json', { 'user-a': legacyUser }],
  ['mood.json', { mood: 'neutral' }],
]) {
  test(`unassigned ${file} stays intact and rejects readiness`, async () => {
    const h = schemaHarness({ files: { [file]: data } });
    await assert.rejects(h.createSchema(), /no server assignment/);
    assert.deepEqual(h.state().imported, []);
    assert.deepEqual(h.renamed, []);
    assert.ok(Object.hasOwn(h.remainingFiles, file));
  });
}

test('invalid legacy beef entry keeps the source and rejects readiness', async () => {
  const h = schemaHarness({ files: { 'beefs.json': { invalid: { incidents: 2 } } }, mappings: guildMappings });
  await assert.rejects(h.createSchema(), /invalid user IDs/);
  assert.deepEqual(h.renamed, []);
});

test('source rename failure rejects readiness after a committed import', async () => {
  const h = schemaHarness({ files: { 'user-memory.json': { 'user-a': legacyUser } }, mappings: guildMappings, failRename: true });
  await assert.rejects(h.createSchema(), /synthetic rename failure/);
  assert.equal(h.state().imported.length, 2);
  assert.deepEqual(h.renamed, []);
  assert.equal(h.calls.some(({ text }) => text === 'ROLLBACK'), false);
});


test('legacy quote retry after a rename failure does not duplicate guild rows', async () => {
  let renameFails = true;
  const h = schemaHarness({
    files: { 'wild-quotes.json': [{ userId: 'user-a', name: 'Synthetic user', quote: 'Synthetic quote', timestamp: 1000 }] },
    mappings: guildMappings,
    failRename: () => renameFails,
  });
  await assert.rejects(h.createSchema(), /synthetic rename failure/);
  assert.equal(h.state().imported.length, 2);
  renameFails = false;
  await h.createSchema();
  assert.equal(h.state().imported.length, 2);
  assert.deepEqual(h.renamed, [['wild-quotes.json', 'wild-quotes.json.migrated']]);
});
