import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));

test('README showcase strings match wizard step titles', async () => {
  const showcase = await readFile(join(root, 'docs/setup-first-run-showcase.txt'), 'utf8');
  const setup = await readFile(join(root, 'src/setup.ts'), 'utf8');
  const finish = await readFile(join(root, 'src/setup/finishSummary.ts'), 'utf8');
  const wizard = `${setup}\n${finish}`;
  for (const needle of [
    'Discord bot',
    'AI model',
    'Memory (database)',
    'Start Sass',
    'sass start',
    'sass uninstall',
  ]) {
    assert.ok(showcase.includes(needle), `showcase missing ${needle}`);
    assert.ok(wizard.includes(needle), `wizard missing ${needle}`);
  }
});
