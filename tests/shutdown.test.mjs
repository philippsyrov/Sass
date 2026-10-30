import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'tsx/esm/api';
register();
const shutdown = await import('../src/events/shutdown.ts');

test('one shutdown closes memory, Discord, memory search, and database in order', async () => {
  assert.equal(typeof shutdown.createShutdownHandler, 'function');
  const calls = [];
  let drained;
  const waiting = new Promise((resolve) => { drained = resolve; });
  const handler = shutdown.createShutdownHandler({
    flushMemory: async () => { calls.push('memory'); await waiting; },
    closeClient: async () => { calls.push('client'); },
    closeEmbedder: async () => { calls.push('embedder'); },
    closeDatabase: async () => { calls.push('database'); },
    exit: (code) => { calls.push(`exit:${code}`); },
    log: () => {}, error: () => {},
  });
  const first = handler('SIGINT');
  const second = handler('SIGINT');
  assert.deepEqual(calls, ['memory']);
  drained();
  await Promise.all([first, second]);
  assert.deepEqual(calls, ['memory', 'client', 'embedder', 'database', 'exit:0']);
});

test('a failed memory flush still closes other resources and reports failure', async () => {
  assert.equal(typeof shutdown.createShutdownHandler, 'function');
  const calls = [];
  const handler = shutdown.createShutdownHandler({
    flushMemory: async () => { throw new Error('synthetic flush failure'); },
    closeClient: async () => { calls.push('client'); },
    closeEmbedder: async () => { calls.push('embedder'); },
    closeDatabase: async () => { calls.push('database'); },
    exit: (code) => { calls.push(`exit:${code}`); },
    log: () => {}, error: (message) => { calls.push(message); },
  });
  await handler('SIGTERM');
  assert.deepEqual(calls, ['Memory shutdown failed: synthetic flush failure', 'client', 'embedder', 'database', 'exit:1']);
});
