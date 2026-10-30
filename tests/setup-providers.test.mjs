import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));

async function importDist(relativePath) {
  const distPath = relativePath.replace(/^\.\/src\//, './dist/').replace(/\.ts$/, '.js');
  return import(pathToFileURL(join(root, distPath)).href);
}

test('PROVIDERS lists cloud before lite local options', async () => {
  const { PROVIDERS } = await importDist('./src/setup/validate.ts');
  assert.equal(PROVIDERS[0].key, 'anthropic');
  assert.equal(PROVIDERS[1].key, 'openai');
  assert.ok(PROVIDERS.some((p) => p.key === 'ollama'));
  assert.ok(PROVIDERS.some((p) => p.key === 'lmstudio'));
  const anthropic = PROVIDERS.find((p) => p.key === 'anthropic');
  assert.equal(anthropic?.servesEmbeddings, false);
});

test('ollamaPullSizeHint returns a readable size', async () => {
  const { ollamaPullSizeHint } = await importDist('./src/setup/localBootstrap.ts');
  assert.match(ollamaPullSizeHint('llama3.1:8b'), /GB/i);
  assert.match(ollamaPullSizeHint('nomic-embed-text'), /MB/i);
});
