import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir, platform, arch } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { register } from 'tsx/esm/api';

register();
const guard = await import('../src/database/userDataGuard.ts');
const poolModule = await import('../src/database/pool.ts');
const memory = await import('../src/userMemory.ts');
const { deleteUserData } = await import('../src/database/queries.ts');
const ship = await import('../src/shipScore.ts');
const require = createRequire(import.meta.url);
let binaries = false;
try { require.resolve(`@embedded-postgres/${platform()}-${arch()}`); binaries = true; } catch { /* Test never downloads binaries. */ }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('deletion waits for active writes and rejects stale work even after new activity', async () => {
  const old = guard.captureUserDataToken('guard-guild', 'guard-user');
  const entered = deferred(), release = deferred();
  const events = [];
  const active = guard.withUserDataWrite(old, async () => { entered.resolve(); await release.promise; events.push('active'); });
  await entered.promise;
  const queued = guard.withUserDataWrite(old, async () => events.push('stale queued'));
  const deletion = guard.withUserDataDeletion('guard-guild', 'guard-user', async () => events.push('deleted'));
  const fresh = guard.captureUserDataToken('guard-guild', 'guard-user');
  const freshWrite = guard.withUserDataWrite(fresh, async () => events.push('fresh'));
  release.resolve();
  await Promise.all([active, queued, deletion, freshWrite]);
  await guard.withUserDataWrite(old, async () => events.push('stale resumed'));
  assert.deepEqual(events, ['active', 'deleted', 'fresh']);
});

test('real transaction rolls back on failure, deletes scoped rows, and blocks stale seen flushes', { skip: !binaries, timeout: 30000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'sass-privacy-'));
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  await writeFile(join(dir, 'local-db.json'), JSON.stringify({ port, user: 'synthetic', password: 'synthetic-test-password', database: 'sass' }), { mode: 0o600 });
  const keys = ['SASS_TEST_DATA_DIR', 'SASS_EMBEDDED_PG', 'SASS_TEST_SKIP_EMBEDDED', 'DATABASE_URL'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { SASS_TEST_DATA_DIR: dir, SASS_EMBEDDED_PG: '1', SASS_TEST_SKIP_EMBEDDED: '' });
  t.after(async () => {
    await memory.shutdownUserMemory(); await poolModule.closeDatabase();
    for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : process.env[key] = value;
    await rm(dir, { recursive: true, force: true });
  });
  assert.equal(await poolModule.connectPool(), true); poolModule.setConnected(true);
  const pool = poolModule.getRawPool();
  await pool.query(`CREATE TABLE users (server_id TEXT, user_id TEXT, name TEXT, message_count INT DEFAULT 0, last_seen TIMESTAMPTZ, profile_updated_at TIMESTAMPTZ, PRIMARY KEY(server_id,user_id));
    CREATE TABLE vector_memories (server_id TEXT, user_id TEXT);
    CREATE TABLE beefs (server_id TEXT, user1_id TEXT, user2_id TEXT);
    CREATE TABLE pair_interactions (server_id TEXT, user1_id TEXT, user2_id TEXT, interaction_count INT DEFAULT 1, last_interaction TIMESTAMPTZ, PRIMARY KEY(server_id, user1_id, user2_id));
    CREATE TABLE wild_quotes (server_id TEXT, user_id TEXT);
    CREATE TABLE interactions (server_id TEXT, user_id TEXT);
    CREATE TABLE reactions (server_id TEXT, reactor_id TEXT);`);
  await pool.query("INSERT INTO users VALUES ('g','u','original',1,NOW(),NULL),('other','u','keep',1,NOW(),NULL)");
  await pool.query("INSERT INTO vector_memories VALUES ('g','u'),('other','u'); INSERT INTO beefs VALUES ('g','u','v'); INSERT INTO pair_interactions (server_id,user1_id,user2_id) VALUES ('g','v','u'); INSERT INTO wild_quotes VALUES ('g','u'); INSERT INTO interactions VALUES ('g','u'); INSERT INTO reactions VALUES ('g','u')");
  assert.equal((await deleteUserData('g', 'u')).deleted, false);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM users WHERE server_id='g' AND user_id='u'")).rows[0].n, 1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM vector_memories WHERE server_id='g' AND user_id='u'")).rows[0].n, 1);
  await pool.query("CREATE TABLE command_usage (server_id TEXT, user_id TEXT); INSERT INTO command_usage VALUES ('g','u')");
  const entered = deferred(), release = deferred();
  const token = guard.captureUserDataToken('g', 'u');
  const active = guard.withUserDataWrite(token, async () => { entered.resolve(); await release.promise; });
  await entered.promise;
  memory.seen('g', 'u', 'old');
  const flush = memory.flushSeen();
  const deletion = deleteUserData('g', 'u');
  memory.seen('g', 'u', 'fresh');
  release.resolve();
  const [, , result] = await Promise.all([active, flush, deletion]);
  assert.equal(result.deleted, true);
  assert.deepEqual(new Set(result.tables), new Set(['users', 'vector_memories', 'beefs', 'pair_interactions', 'wild_quotes', 'interactions', 'reactions', 'command_usage']));
  for (const table of result.tables) {
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE server_id = $1`, ['g'])).rows[0].n, 0);
  }
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM vector_memories WHERE server_id='other'")).rows[0].n, 1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM users WHERE server_id='g' AND user_id='u'")).rows[0].n, 0);
  await memory.flushSeen();
  assert.equal((await pool.query("SELECT name FROM users WHERE server_id='g' AND user_id='u'")).rows[0].name, 'fresh');
  assert.equal((await pool.query("SELECT name FROM users WHERE server_id='other' AND user_id='u'")).rows[0].name, 'keep');
  await pool.query(`ALTER TABLE users ADD COLUMN facts TEXT[] DEFAULT '{}', ADD COLUMN roasts TEXT[] DEFAULT '{}',
    ADD COLUMN gender TEXT, ADD COLUMN times_roasted INT DEFAULT 0, ADD COLUMN distilled_profile TEXT`);
  await pool.query(`UPDATE users SET facts = ARRAY['fresh fact'], roasts = ARRAY['fresh roast'],
    distilled_profile = 'stale summary', profile_updated_at = NULL WHERE server_id = 'g' AND user_id = 'u'`);
  const messages = [{ authorId: 'u', author: 'Example', content: '', timestamp: 0, isBot: false }];
  for (const context of [await memory.getContext('g', 'u', 'Example'), await memory.buildPeopleContext('g', messages)]) {
    assert.match(context, /fresh fact/);
    assert.match(context, /fresh roast/);
    assert.doesNotMatch(context, /stale summary/);
  }
  await pool.query(`UPDATE users SET profile_updated_at = NOW() WHERE server_id = 'g' AND user_id = 'u'`);
  assert.match(await memory.getContext('g', 'u', 'Example'), /stale summary/);
  assert.match(await memory.buildPeopleContext('g', messages), /stale summary/);
  await memory.remember('g', 'u', 'new fact');
  for (const context of [await memory.getContext('g', 'u', 'Example'), await memory.buildPeopleContext('g', messages)]) {
    assert.match(context, /new fact/);
    assert.doesNotMatch(context, /stale summary/);
  }
  await pool.query(`UPDATE users SET profile_updated_at = NOW() WHERE server_id = 'g' AND user_id = 'u'`);
  await memory.addRoast('g', 'u', 'new roast');
  assert.doesNotMatch(await memory.getContext('g', 'u', 'Example'), /stale summary/);
  assert.match(await memory.buildPeopleContext('g', messages), /new roast/);
  await pool.query(`UPDATE users SET profile_updated_at = NOW() WHERE server_id = 'g' AND user_id = 'u'`);
  memory.seen('g', 'u', 'renamed');
  await memory.flushSeen();
  assert.doesNotMatch(await memory.getContext('g', 'u', 'Example'), /stale summary/);
  assert.doesNotMatch(await memory.buildPeopleContext('g', messages), /stale summary/);
  // A read that already fetched old data must not refill the cache after deletion.
  await pool.query("INSERT INTO pair_interactions (server_id, user1_id, user2_id, interaction_count) VALUES ('pairs','a','b',7),('other','a','b',9)");
  assert.equal(await ship.getPairInteractionsAsync('other', 'a', 'b'), 9);
  const fetched = deferred(), resume = deferred();
  const originalQuery = pool.query;
  pool.query = async function (sql, values) {
    const result = await originalQuery.call(this, sql, values);
    if (typeof sql === 'string' && sql.startsWith('SELECT interaction_count') && values?.[0] === 'pairs') {
      fetched.resolve();
      await resume.promise;
    }
    return result;
  };
  const oldEvent = guard.withUserDataContext('pairs', 'a', async () => {
    const oldCount = await ship.getPairInteractionsAsync('pairs', 'a', 'b');
    ship.recordPairInteraction('pairs', 'a', 'b');
    return oldCount;
  });
  await fetched.promise;
  ship.clearUserPairCache('pairs', 'b');
  const pairDeletion = deleteUserData('pairs', 'b');
  ship.recordPairInteraction('pairs', 'a', 'b');
  resume.resolve();
  assert.equal(await oldEvent, 0);
  assert.equal((await pairDeletion).deleted, true);
  pool.query = originalQuery;
  const first = guard.captureUserDataToken('pairs', 'a');
  const second = guard.captureUserDataToken('pairs', 'b');
  await guard.withUserDataWrite(first, () => guard.withUserDataWrite(second, async () => {}));
  assert.equal(ship.getPairInteractions('pairs', 'a', 'b'), 1);
  assert.equal((await pool.query("SELECT interaction_count FROM pair_interactions WHERE server_id='pairs'")).rows[0].interaction_count, 1);
  assert.equal(ship.getPairInteractions('other', 'a', 'b'), 9);
  assert.equal(await ship.getPairInteractionsAsync('pairs', 'a', 'a'), 0);
});

test('older events cannot start writes for a participant discovered after deletion', async () => {
  const ready = deferred(), resume = deferred();
  const writes = [];
  const event = guard.withUserDataContext('epoch-guild', 'sender', async () => {
    ready.resolve();
    await resume.promise;
    const token = guard.captureUserDataToken('epoch-guild', 'target');
    await guard.withUserDataWrite(token, async () => writes.push('old event'));
  });
  await ready.promise;
  await guard.withUserDataDeletion('epoch-guild', 'target', async () => {});
  resume.resolve();
  await event;
  const fresh = guard.captureUserDataToken('epoch-guild', 'target');
  await guard.withUserDataWrite(fresh, async () => writes.push('new event'));
  assert.deepEqual(writes, ['new event']);
});
