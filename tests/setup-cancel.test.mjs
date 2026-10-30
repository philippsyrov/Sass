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
