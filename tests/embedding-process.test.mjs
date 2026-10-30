import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { register } from 'tsx/esm/api';
register();
const { createEmbeddingProcess } = await import('../src/embeddings/embeddingProcess.ts');

async function fixture(t, body, timeout) {
  const directory = await mkdtemp(join(tmpdir(), 'sass-embed-test-'));
  const worker = join(directory, 'worker.mjs');
  await writeFile(worker, body);
  const service = createEmbeddingProcess(pathToFileURL(worker), timeout);
  t.after(async () => { await service.close(); await rm(directory, { recursive: true, force: true }); });
  return service;
}

test('embedding transport uses a separate process and does not forward provider secrets', async (t) => {
  process.env.SASS_SYNTHETIC_SECRET = 'must-not-cross';
  t.after(() => { delete process.env.SASS_SYNTHETIC_SECRET; });
  const service = await fixture(t, `process.on('message', ({id}) => process.send({id,result:{pid:process.pid,secret:process.env.SASS_SYNTHETIC_SECRET}}));`);
  const result = await service.request('test', {});
  assert.notEqual(result.pid, process.pid);
  assert.equal(result.secret, undefined);
});

test('concurrent IPC calls keep response and progress ownership', async (t) => {
  const service = await fixture(t, `process.on('message', ({id,payload}) => {process.send({id,progress:{status:'progress',progress:payload}});setTimeout(()=>process.send({id,result:payload}),15-payload)});`);
  const progress = [];
  assert.deepEqual(await Promise.all([service.request('x', 1, (p) => progress.push(p.progress)), service.request('x', 2)]), [1, 2]);
  assert.deepEqual(progress, [1]);
});

test('worker failure rejects pending work and allows a new process', async (t) => {
  const service = await fixture(t, `process.on('message', ({id,action}) => action==='crash' ? process.exit(4) : process.send({id,result:'recovered'}));`);
  await assert.rejects(service.request('crash', {}), /exited/);
  assert.equal(await service.request('retry', {}), 'recovered');
});

test('timeout and explicit close reject pending work', async (t) => {
  const service = await fixture(t, `process.on('message', () => {});`, 70);
  await assert.rejects(service.request('hang', {}), /stopped/);
  const pending = service.request('hang', {});
  const rejected = assert.rejects(pending, /stopped/);
  await service.close();
  await rejected;
});

test('the bot import contains no Transformers or sharp import', async () => {
  const source = await readFile(new URL('../src/embeddings/localEmbed.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from ['"](?:@huggingface\/transformers|sharp)['"]/);
});
