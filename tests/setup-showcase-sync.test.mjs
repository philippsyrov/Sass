import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));

test('README CLI commands exist in the installed command dispatcher', async () => {
  const readme = await readFile(resolve(root, 'README.md'), 'utf8');
  const cli = await readFile(resolve(root, 'scripts/sass.sh'), 'utf8');
  for (const command of ['start', 'setup', 'settings', 'invite', 'doctor']) {
    assert.ok(new RegExp(`\\bsass ${command}\\b`).test(readme), `README missing ${command}`);
    assert.ok(new RegExp(`(?:^\\s*|\\|)${command}\\)`, 'm').test(cli), `dispatcher missing ${command}`);
  }
});

test('README links to the product documentation resolve', async () => {
  const readme = await readFile(resolve(root, 'README.md'), 'utf8');
  for (const file of ['docs/CONFIGURATION.md', 'docs/PERSONALITY.md', 'docs/DREAMING.md', 'docs/PRIVACY.md', 'docs/RELEASE_BUNDLES.md']) {
    assert.ok(readme.includes(`(${file}`), `README does not link ${file}`);
    await access(resolve(root, file));
  }
});
