import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));

test('pickDefaultAnthropicModel prefers newest Sonnet alias and 4.5 snapshots', async () => {
  const { pickDefaultAnthropicModel, DEFAULT_ANTHROPIC_SONNET_MODEL } = await import(
    pathToFileURL(join(root, 'dist/setup/anthropicModels.js')).href
  );
  assert.equal(DEFAULT_ANTHROPIC_SONNET_MODEL, 'claude-sonnet-5-5');
  const ids = [
    'claude-3-haiku-20240307',
    'claude-sonnet-4-20250514',
    'claude-3-5-sonnet-20241022',
    'claude-sonnet-4-5-20250929',
    'claude-sonnet-5-5',
  ];
  assert.equal(pickDefaultAnthropicModel(ids), 'claude-sonnet-5-5');
  assert.equal(
    pickDefaultAnthropicModel(ids.filter((id) => id !== 'claude-sonnet-5-5')),
    'claude-sonnet-4-5-20250929',
  );
});

test('shouldUseInkTui is false under test terminal flag', async () => {
  process.env.SASS_TEST_TERMINAL = '1';
  const { shouldUseInkTui } = await import(
    pathToFileURL(join(root, 'dist/setup/shouldUseInkTui.js')).href
  );
  assert.equal(shouldUseInkTui(), false);
  delete process.env.SASS_TEST_TERMINAL;
});
