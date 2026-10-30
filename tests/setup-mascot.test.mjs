import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));

test('mascot data has 45 and 30 line counts', async () => {
  const { MASCOT_45_TRUECOLOR, MASCOT_30_TRUECOLOR } = await import(
    pathToFileURL(join(root, 'dist/setup/mascotData.generated.js')).href
  );
  assert.equal(MASCOT_45_TRUECOLOR.length, 23);
  assert.equal(MASCOT_30_TRUECOLOR.length, 15);
});

test('pre-rendered .ans files exist for installer', async () => {
  const { access } = await import('node:fs/promises');
  for (const name of ['sass-45.truecolor.ans', 'sass-45.256.ans', 'sass-30.truecolor.ans', 'sass-30.256.ans']) {
    await access(join(root, 'assets/mascot', name));
  }
});
