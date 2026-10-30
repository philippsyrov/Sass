import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function fixture(summarize = async () => 'Earlier discussion') {
  const calls = [];
  const module = { exports: {} };
  const source = ts.transpileModule(readFileSync(new URL('../src/messageBuffer.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const require = (name) => {
    if (name === './ai/index.js') return { summarizeMessages: async rows => { calls.push(rows); return summarize(rows); } };
    if (name === './shared/speaker.js') return { resolveMentions: text => text, speakerLabel: entry => entry.author };
    throw new Error(name);
  };
  new Function('require', 'exports', 'module', source)(require, module.exports, module);
  const buffer = module.exports.messageBuffer;
  const add = index => buffer.add({ id: String(index), content: `message ${index}`, author: { id: 'example', username: 'Example' }, channel: { id: 'channel' }, createdTimestamp: index });
  return { buffer, calls, add };
}
const settled = () => new Promise(resolve => setImmediate(resolve));

test('ten individually dropped messages produce a summary while the recent buffer stays bounded', async () => {
  const { buffer, calls, add } = fixture();
  for (let i = 0; i < 40; i++) add(i);
  await settled();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].map(row => row.content), Array.from({ length: 10 }, (_, i) => `message ${i}`));
  assert.equal(buffer.getRecentRaw('channel', 100).length, 30);
  assert.match(buffer.getSummary('channel'), /Earlier discussion/);
});

test('compaction has no overlapping model calls and bounds traffic queued during a slow response', async () => {
  let release;
  let first = true;
  const { calls, add } = fixture(async () => {
    if (first) { first = false; await new Promise(resolve => { release = resolve; }); }
    return 'summary';
  });
  for (let i = 0; i < 200; i++) add(i);
  assert.equal(calls.length, 1);
  release();
  await settled();
  assert.equal(calls.length, 2);
  assert.ok(calls[1].length <= 30);
});

test('failed summaries retain the three-failure circuit breaker', async () => {
  const { calls, add } = fixture(async () => null);
  for (let batch = 0; batch < 9; batch++) {
    for (let i = batch * 10; i < batch * 10 + 10; i++) add(i);
    await settled();
  }
  assert.equal(calls.length, 3);
});

test('channel churn cannot create unlimited model calls or resurrect evicted failure state', async () => {
  const releases = [];
  const { buffer, calls } = fixture(() => new Promise(resolve => releases.push(resolve)));
  for (let channel = 0; channel < 1100; channel++) {
    for (let index = 0; index < 40; index++) buffer.add({ id: String(index), content: 'synthetic text', author: { id: 'example', username: 'Example' }, channel: { id: String(channel) }, createdTimestamp: index });
  }
  assert.ok(calls.length <= 2);
  assert.ok(buffer.channels.size <= 1000);
  assert.ok(buffer.droppedMessages.size <= 32);
  releases[0](null);
  await settled();
  assert.equal(buffer.compactionFailures.has('0'), false);
  assert.ok(calls.length <= 3);
});
