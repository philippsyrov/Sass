import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir, platform, arch } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import net from 'node:net';
import test from 'node:test';
const require = createRequire(import.meta.url);
let hasBinaries = false;
try { require.resolve(`@embedded-postgres/${platform()}-${arch()}`); hasBinaries = true; } catch { /* no download in tests */ }

async function testDirectory(t, prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const children = [];
  t.after(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await once(child, 'exit');
      }
    }
    // The directory is unique to this test. Never inspect or stop installed data.
    try {
      const pid = Number((await readFile(join(dir, 'postgres', 'postmaster.pid'), 'utf8')).split('\n')[0]);
      process.kill(pid, 'SIGINT');
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        try { await readFile(join(dir, 'postgres', 'postmaster.pid')); }
        catch (error) { if (error.code === 'ENOENT') break; throw error; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    } catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error; }
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, children };
}

async function fixture(t, state, env = {}) {
  const { dir, children } = state;
  const child = fork(new URL('./fixtures/postgres-lifecycle.mjs', import.meta.url), [], {
    detached: true,
    env: { ...process.env, SASS_EMBEDDED_PG: '1', SASS_TEST_DATA_DIR: dir, SASS_TEST_SKIP_EMBEDDED: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  children.push(child);
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const closed = once(child, 'exit');
  const ready = await Promise.race([
    once(child, 'message').then(([message]) => message),
    closed.then(([code, signal]) => { throw new Error(`Fixture exited before ready: ${code}/${signal}\n${output}`); }),
  ]);
  return { child, ready, closed, output: () => output };
}

test('terminal SIGINT drains once before PG stops and restart preserves the database', { skip: !hasBinaries || platform() === 'win32', timeout: 30000 }, async (t) => {
  const state = await testDirectory(t, 'sass-pg-lifecycle-');
  const { dir } = state;
  const first = await fixture(t, state);
  assert.equal(first.ready.count, 1);
  process.kill(-first.child.pid, 'SIGINT');
  first.child.kill('SIGINT');
  assert.deepEqual(await first.closed, [0, null], first.output());
  assert.equal((first.output().match(/SIGINT received/g) ?? []).length, 1);
  assert.match(first.output(), /FLUSHED/);
  assert.doesNotMatch(first.output(), /Connection terminated|Unexpected pool error|shutdown failed|Failed to close database/);
  const config = await readFile(join(dir, 'local-db.json'), 'utf8');
  const second = await fixture(t, state);
  assert.equal(second.ready.count, 2);
  second.child.kill('SIGTERM');
  assert.deepEqual(await second.closed, [0, null], second.output());
  assert.doesNotMatch(second.output(), /already exists|ERROR:/);
  assert.equal(await readFile(join(dir, 'local-db.json'), 'utf8'), config);
});

test('terminal SIGHUP drains once before PG stops and restart preserves the database', { skip: !hasBinaries || platform() === 'win32', timeout: 30000 }, async (t) => {
  const state = await testDirectory(t, 'sass-pg-lifecycle-');
  const { dir } = state;
  const first = await fixture(t, state);
  assert.equal(first.ready.count, 1);
  process.kill(-first.child.pid, 'SIGHUP');
  first.child.kill('SIGHUP');
  assert.deepEqual(await first.closed, [0, null], first.output());
  assert.equal((first.output().match(/SIGHUP received/g) ?? []).length, 1);
  assert.match(first.output(), /FLUSHED/);
  assert.doesNotMatch(first.output(), /Connection terminated|Unexpected pool error|shutdown failed|Failed to close database/);
  const config = await readFile(join(dir, 'local-db.json'), 'utf8');
  const second = await fixture(t, state);
  assert.equal(second.ready.count, 2);
  second.child.kill('SIGTERM');
  assert.deepEqual(await second.closed, [0, null], second.output());
  assert.doesNotMatch(second.output(), /already exists|ERROR:/);
  assert.equal(await readFile(join(dir, 'local-db.json'), 'utf8'), config);
});

test('parent death stops its detached Postgres cluster through IPC disconnect', { skip: !hasBinaries, timeout: 20000 }, async (t) => {
  const state = await testDirectory(t, 'sass-pg-disconnect-');
  const { dir } = state;
  const running = await fixture(t, state);
  running.child.kill('SIGKILL');
  await running.closed;
  const deadline = Date.now() + 10000;
  for (;;) {
    try { await readFile(join(dir, 'postgres', 'postmaster.pid')); }
    catch (error) { if (error.code === 'ENOENT') break; throw error; }
    assert.ok(Date.now() < deadline, 'Postgres should remove its PID file after parent death');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
});

test('shutdown during initial connection waits for startup and closes the new pool', { skip: !hasBinaries, timeout: 20000 }, async (t) => {
  const state = await testDirectory(t, 'sass-pg-early-close-');
  const { dir } = state;
  const running = await fixture(t, state, { SASS_FIXTURE_EARLY_CLOSE: '1' });
  assert.equal(running.ready.type, 'closed');
  assert.deepEqual(await running.closed, [0, null], running.output());
  await assert.rejects(readFile(join(dir, 'postgres', 'postmaster.pid')), { code: 'ENOENT' });
  assert.doesNotMatch(running.output(), /Failed to close database|shutdown failed/);
});

test('an occupied retained port fails startup without hanging or replacing configuration', { skip: !hasBinaries, timeout: 20000 }, async (t) => {
  const state = await testDirectory(t, 'sass-pg-busy-port-');
  const initial = await fixture(t, state);
  initial.child.kill('SIGTERM');
  assert.deepEqual(await initial.closed, [0, null], initial.output());
  const configPath = join(state.dir, 'local-db.json');
  const configText = await readFile(configPath, 'utf8');
  const config = JSON.parse(configText);
  const blocker = net.createServer();
  await new Promise((resolve, reject) => {
    blocker.once('error', reject);
    blocker.listen(config.port, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => blocker.close(resolve)));
  await assert.rejects(fixture(t, state), /Local Postgres failed to start/);
  assert.equal(await readFile(configPath, 'utf8'), configText);
});

test('a crashed Postgres server stays visible and cannot hang worker shutdown', { skip: !hasBinaries || platform() === 'win32', timeout: 20000 }, async (t) => {
  const state = await testDirectory(t, 'sass-pg-crash-');
  const running = await fixture(t, state);
  const pid = Number((await readFile(join(state.dir, 'postgres', 'postmaster.pid'), 'utf8')).split('\n')[0]);
  process.kill(pid, 'SIGKILL');
  await new Promise((resolve) => setTimeout(resolve, 100));
  running.child.kill('SIGTERM');
  assert.deepEqual(await running.closed, [1, null], running.output());
  assert.match(running.output(), /Local Postgres exited before shutdown/);
  assert.match(running.output(), /Database shutdown failed/);
});
