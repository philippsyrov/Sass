import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'tsx/esm/api';
register();
const { createDistillScheduler } = await import('../src/memory/distillScheduler.ts');
const { DISTILL_INTERVAL_MS } = await import('../src/memory/profilePolicy.ts');
const { createShutdownHandler } = await import('../src/events/shutdown.ts');

function fixture({ last = null, status = 'completed', run, read, write } = {}) {
  let time = 1_800_000_000_000;
  let calls = 0;
  let saved = last;
  const writes = [], errors = [], timers = new Map();
  const scheduler = createDistillScheduler({
    now: () => time,
    setTimer: (work, delay) => {
      const handle = { unref() {} };
      timers.set(handle, { work, delay });
      return handle;
    },
    clearTimer: (handle) => timers.delete(handle),
    readLastRun: read ?? (async () => saved),
    writeLastRun: write ?? (async (value) => { saved = value; writes.push(value); }),
    run: async (signal) => { calls++; return run ? run(signal) : { status }; },
    error: (message) => errors.push(message),
    shutdownTimeoutMs: 10,
  });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  return {
    scheduler, writes, errors, timers, calls: () => calls, saved: () => saved,
    async fire() {
      const [handle, entry] = timers.entries().next().value;
      timers.delete(handle); time += entry.delay; entry.work(); await flush();
    },
    delay: () => timers.values().next().value?.delay,
    now: () => time,
  };
}

test('one startup timer persists its attempt before running and schedules six hours later', async () => {
  const f = fixture({ run: async () => {
    assert.equal(f.writes.length, 1);
    return { status: 'completed' };
  } });
  f.scheduler.start(); f.scheduler.start();
  assert.equal(f.timers.size, 1);
  assert.equal(f.delay(), 5 * 60 * 1000);
  await f.fire();
  assert.equal(f.calls(), 1);
  assert.deepEqual(f.writes, [f.now()]);
  assert.equal(f.delay(), DISTILL_INTERVAL_MS);
  await f.scheduler.stop();
  assert.equal(f.timers.size, 0);
});

test('a restarted process skips recent persisted work and waits until it is due', async () => {
  const last = 1_800_000_000_000 - 60 * 60 * 1000;
  const f = fixture({ last }); f.scheduler.start();
  await f.fire();
  assert.equal(f.calls(), 0);
  assert.equal(f.delay(), last + DISTILL_INTERVAL_MS - f.now());
  await f.fire();
  assert.equal(f.calls(), 1);
  await f.scheduler.stop();
});

test('limited, failed, aborted and skipped jobs cannot bypass cadence by restarting', async () => {
  for (const status of ['limited', 'failed', 'aborted', 'skipped']) {
    const f = fixture({ status }); f.scheduler.start(); await f.fire();
    assert.equal(f.writes.length, 1, status);
    assert.equal(f.delay(), DISTILL_INTERVAL_MS);
    await f.scheduler.stop();
  }
});

test('shutdown cancels active work before memory and database closure and schedules no replacement', async () => {
  const order = [];
  const f = fixture({ run: signal => new Promise(resolve => {
    signal.addEventListener('abort', () => { order.push('aborted'); resolve({ status: 'aborted' }); }, { once: true });
  }) });
  f.scheduler.start(); await f.fire();
  assert.equal(f.timers.size, 0);
  const stop = createShutdownHandler({
    stopMaintenance: () => f.scheduler.stop(),
    flushMemory: async () => { order.push('memory'); },
    closeClient: async () => {}, closeEmbedder: async () => {},
    closeDatabase: async () => { order.push('database'); },
    exit: code => { order.push(`exit:${code}`); }, log() {}, error() {},
  });
  await stop('SIGINT');
  assert.deepEqual(order, ['aborted', 'memory', 'database', 'exit:0']);
  assert.equal(f.timers.size, 0);
  assert.equal(f.writes.length, 1);
});

test('stop clears startup work and cannot be restarted', async () => {
  const f = fixture(); f.scheduler.start(); await f.scheduler.stop(); f.scheduler.start();
  assert.equal(f.timers.size, 0);
  assert.equal(f.calls(), 0);
});

test('state-store failure does not start a model job or cause a tight retry loop', async () => {
  const f = fixture({ read: async () => { throw new Error('synthetic storage failure'); } });
  f.scheduler.start(); await f.fire();
  assert.equal(f.calls(), 0);
  assert.equal(f.errors.length, 1);
  assert.equal(f.delay(), DISTILL_INTERVAL_MS);
  await f.scheduler.stop();
});

test('failure to persist an attempt prevents model spending', async () => {
  const f = fixture({ write: async () => { throw new Error('synthetic write failure'); } });
  f.scheduler.start(); await f.fire();
  assert.equal(f.calls(), 0);
  assert.equal(f.errors.length, 1);
  await f.scheduler.stop();
});

test('a backward clock change cannot reset a recorded run budget', async () => {
  const f = fixture({ last: 1_800_000_000_000 + 60 * 60 * 1000 });
  f.scheduler.start(); await f.fire();
  assert.equal(f.calls(), 0);
  assert.equal(f.delay(), DISTILL_INTERVAL_MS);
  await f.scheduler.stop();
});

test('shutdown has a bound even if a broken worker ignores cancellation', async () => {
  const f = fixture({ run: () => new Promise(() => {}) });
  f.scheduler.start(); await f.fire();
  await assert.rejects(f.scheduler.stop(), /did not stop in time/);
  assert.equal(f.timers.size, 0);
});
