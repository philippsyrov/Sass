import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir, platform, arch } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { register } from 'tsx/esm/api';

const require = createRequire(import.meta.url);
let hasBinaries = false;
try { require.resolve(`@embedded-postgres/${platform()}-${arch()}`); hasBinaries = true; } catch { /* Never download test dependencies. */ }

register();
const database = await import('../src/database/pool.ts');
const memory = await import('../src/userMemory.ts');

test('exported user memory functions retain bounded chronological arrays in Postgres', { skip: !hasBinaries, timeout: 30000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'sass-user-memory-retention-'));
  const portProbe = createServer();
  await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
  const port = portProbe.address().port;
  await new Promise(resolve => portProbe.close(resolve));
  await writeFile(join(dir, 'local-db.json'), JSON.stringify({ port, user: 'synthetic', password: 'synthetic-test-password', database: 'sass' }), { mode: 0o600 });
  const saved = Object.fromEntries(['SASS_TEST_DATA_DIR', 'SASS_EMBEDDED_PG', 'SASS_TEST_SKIP_EMBEDDED', 'DATABASE_URL'].map((key) => [key, process.env[key]]));
  Object.assign(process.env, { SASS_TEST_DATA_DIR: dir, SASS_EMBEDDED_PG: '1', SASS_TEST_SKIP_EMBEDDED: '' });
  t.after(async () => {
    await memory.shutdownUserMemory();
    await database.closeDatabase();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  });
  assert.equal(await database.connectPool(), true);
  database.setConnected(true);
  const pool = database.getRawPool();
  await pool.query(`CREATE TABLE users (
    server_id TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL,
    roasts TEXT[] DEFAULT '{}', facts TEXT[] DEFAULT '{}', gender TEXT,
    profile_updated_at TIMESTAMPTZ, distilled_profile TEXT, message_count INT DEFAULT 0,
    times_roasted INT DEFAULT 0, last_seen TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (server_id, user_id)
  )`);
  async function row(guild, user) {
    return (await pool.query('SELECT * FROM users WHERE server_id = $1 AND user_id = $2', [guild, user])).rows[0];
  }
  const values = (prefix, count) => Array.from({ length: count }, (_, index) => `${prefix}-${index + 1}`);

  await t.test('original aggregate-offset expression drops its only result above the cap', async () => {
    const result = await pool.query(`SELECT (
      SELECT array_agg(r) FROM (SELECT unnest(ARRAY['1','2','3','4','5','6']) AS r) sub OFFSET 1
    ) AS original_result`);
    assert.equal(result.rows[0].original_result, null);
  });

  await t.test('addRoast keeps the newest five through repeated overflow in oldest-first order', async () => {
    const topics = values('roast', 12);
    for (const [index, topic] of topics.entries()) {
      await memory.addRoast('guild-a', 'roasts', topic);
      assert.deepEqual((await row('guild-a', 'roasts')).roasts, topics.slice(Math.max(0, index - 4), index + 1));
    }
    assert.deepEqual((await row('guild-a', 'roasts')).roasts, topics.slice(-5));
  });

  await t.test('remember keeps the newest twenty through repeated overflow without gender matches', async () => {
    const facts = values('fact', 27);
    for (const [index, fact] of facts.entries()) {
      await memory.remember('guild-a', 'facts', fact);
      assert.deepEqual((await row('guild-a', 'facts')).facts, facts.slice(Math.max(0, index - 19), index + 1));
    }
    assert.deepEqual((await row('guild-a', 'facts')).facts, facts.slice(-20));
    assert.deepEqual(await memory.getFacts('guild-a', 'facts'), facts.slice(-20));
  });

  await t.test('the gender branch keeps twenty and updates the detected gender', async () => {
    const facts = values('gender-fact', 20);
    for (const fact of facts) await memory.remember('guild-a', 'gender', fact);
    await memory.remember('guild-a', 'gender', "i'm a woman");
    const stored = await row('guild-a', 'gender');
    assert.deepEqual(stored.facts, [...facts.slice(1), "i'm a woman"]);
    assert.equal(stored.gender, 'female');
  });

  await t.test('NULL arrays recover and repeated values remain repeated', async () => {
    await pool.query("INSERT INTO users (server_id, user_id, name, roasts, facts) VALUES ('guild-a', 'null-arrays', '', NULL, NULL)");
    for (let i = 0; i < 7; i++) await memory.addRoast('guild-a', 'null-arrays', 'duplicate roast');
    for (let i = 0; i < 22; i++) await memory.remember('guild-a', 'null-arrays', 'duplicate fact');
    const stored = await row('guild-a', 'null-arrays');
    assert.deepEqual(stored.roasts, Array(5).fill('duplicate roast'));
    assert.deepEqual(stored.facts, Array(20).fill('duplicate fact'));
  });

  await t.test('neutral memory includes facts and topics without adding roast instructions', async () => {
    await memory.remember('guild-a', 'person', 'likes astronomy');
    await memory.addRoast('guild-a', 'person', 'stargazing');
    await pool.query("UPDATE users SET message_count = 60 WHERE server_id = 'guild-a' AND user_id = 'person'");
    const neutral = await memory.getContext('guild-a', 'person', 'Example', { neutral: true });
    assert.match(neutral, /likes astronomy/);
    assert.match(neutral, /stargazing/);
    assert.doesNotMatch(neutral, /weaponize|be petty|no mercy|destroyed/);
    assert.match(await memory.getContext('guild-a', 'person', 'Example'), /weaponize this/);
    await pool.query("UPDATE users SET distilled_profile = 'Enjoys science', profile_updated_at = NOW() WHERE server_id = 'guild-a' AND user_id = 'person'");
    const profile = await memory.getContext('guild-a', 'person', 'Example', { neutral: true });
    assert.match(profile, /Enjoys science/);
    assert.match(profile, /likes astronomy/);
    assert.doesNotMatch(profile, /weaponize/);
  });

  await t.test('guild scope, new rows, and profile invalidation keep their existing behavior', async () => {
    await memory.addRoast('guild-b', 'roasts', 'other guild roast');
    await memory.remember('guild-b', 'facts', 'other guild fact');
    assert.deepEqual((await row('guild-b', 'roasts')).roasts, ['other guild roast']);
    assert.deepEqual((await row('guild-b', 'facts')).facts, ['other guild fact']);
    await pool.query("UPDATE users SET profile_updated_at = NOW() WHERE server_id = 'guild-b'");
    await memory.addRoast('guild-b', 'roasts', 'later roast');
    await memory.remember('guild-b', 'facts', 'later fact');
    assert.equal((await row('guild-b', 'roasts')).profile_updated_at, null);
    assert.equal((await row('guild-b', 'facts')).profile_updated_at, null);
    assert.deepEqual((await row('guild-a', 'roasts')).roasts, values('roast', 12).slice(-5));
  });
});
