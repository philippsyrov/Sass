import assert from 'node:assert/strict';
import { once } from 'node:events';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));

async function importDist(relativePath) {
  const distPath = relativePath.replace(/^\.\/src\//, './dist/').replace(/\.ts$/, '.js');
  return import(new URL(join(root, distPath), import.meta.url).href);
}

test('cancelAllActiveWork terminates a tracked subprocess', { timeout: 15_000 }, async () => {
  const { spawnTracked } = await importDist('./src/setup/spawnTracked.ts');
  const { cancelAllActiveWork } = await importDist('./src/setup/cancelRegistry.ts');
  const child = spawnTracked(process.platform === 'win32' ? 'ping' : 'sleep', process.platform === 'win32' ? ['-n', '30', '127.0.0.1'] : ['30'], {
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 200));
  cancelAllActiveWork();
  const [code, signal] = await once(child, 'exit');
  assert.ok(signal === 'SIGTERM' || code !== 0 || signal != null, 'child should not still be running cleanly');
});

test('ollamaPullHttp aborts when signal is aborted', { timeout: 10_000 }, async () => {
  const { ollamaPullHttp } = await importDist('./src/setup/ollamaHttp.ts');
  const { SetupCancelledError } = await importDist('./src/setup/cancelRegistry.ts');
  const controller = new AbortController();
  const host = 'http://127.0.0.1:9';
  const pull = ollamaPullHttp(host, 'fake-model', controller.signal);
  controller.abort();
  await assert.rejects(pull, (err) => err instanceof SetupCancelledError || err?.name === 'AbortError');
});

test('setup signal handlers can be removed and installed for another setup phase', async () => {
  const { installSetupCancelHandlers } = await importDist('./src/setup/cancelRegistry.ts');
  const original = process.listeners('SIGINT');
  const dispose = installSetupCancelHandlers(() => {});
  assert.equal(process.listenerCount('SIGINT'), original.length + 1);
  dispose();
  dispose();
  assert.deepEqual(process.listeners('SIGINT'), original);
  const again = installSetupCancelHandlers(() => {});
  assert.equal(process.listenerCount('SIGINT'), original.length + 1);
  again();
  assert.deepEqual(process.listeners('SIGINT'), original);
});

test('Ollama advice identifies only an interrupted pull, not a completed pull', async (t) => {
  const { ollamaPullHttp } = await importDist('./src/setup/ollamaHttp.ts');
  const { cancelAllActiveWork, interruptedOllamaDownloadHint } = await importDist('./src/setup/cancelRegistry.ts');
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
  const interrupted = ollamaPullHttp('http://synthetic.invalid', 'synthetic-model');
  cancelAllActiveWork();
  await assert.rejects(interrupted, { name: 'SetupCancelledError' });
  assert.match(interruptedOllamaDownloadHint(), /ollama rm synthetic-model/);

  globalThis.fetch = async () => new Response('{"status":"success"}\n');
  await ollamaPullHttp('http://synthetic.invalid', 'completed-model');
  cancelAllActiveWork();
  assert.equal(interruptedOllamaDownloadHint(), undefined);
});
