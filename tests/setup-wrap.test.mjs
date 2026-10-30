import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

async function loadWrap() {
  const dist = pathToFileURL(join(root, 'dist/setup/wrap.js')).href;
  return import(dist);
}

const DISCORD_BLURB =
  'Sass needs a Discord bot app and your personal Discord user ID. Create one in the Developer Portal if you do not have one yet.';

for (const width of [60, 80]) {
  test(`setup copy wraps at ${width} columns without mid-word breaks`, async () => {
    const { wrapPlain, visibleLength } = await loadWrap();
    const lines = wrapPlain(DISCORD_BLURB, '  ', width);
    assert.ok(lines.length > 1);
    for (const line of lines) {
      const words = line.trim().split(/\s+/);
      for (const word of words) {
        assert.ok(!word.endsWith('-') || word.length > 1, `suspicious break: ${word}`);
      }
      assert.ok(visibleLength(line) <= width + 2, `line too long at ${width}: ${line}`);
    }
  });
}
