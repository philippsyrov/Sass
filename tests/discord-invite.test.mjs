import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '..');
const appId = '123456789012345678';
const expectedUrl = `https://discord.com/oauth2/authorize?client_id=${appId}&scope=bot+applications.commands&permissions=379968`;

test('sass invite prints one complete public link without starting the bot or exposing secrets', () => {
  const work = mkdtempSync(join(tmpdir(), 'sass invite '));
  try {
    mkdirSync(join(work, 'src'));
    utimesSync(join(work, 'src'), 0, 0);
    writeFileSync(join(work, 'package.json'), '{}');
    writeFileSync(join(work, '.env'), `CLIENT_ID=${appId}\nDISCORD_TOKEN=synthetic-private-token\nOPENAI_API_KEY=synthetic-private-key\n`);
    symlinkSync(join(root, 'dist'), join(work, 'dist'));
    const env = { ...process.env, SASS_STATE: join(work, 'no-state'), SASS_DIR: work };
    delete env.CLIENT_ID;
    const result = spawnSync('/bin/bash', [join(root, 'scripts/sass.sh'), 'invite'], { env, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(expectedUrl));
    assert.equal(result.stdout.split('\n').filter(line => line === expectedUrl).length, 1);
    assert.ok(!result.stdout.includes('synthetic-private'));
    assert.ok(!result.stdout.includes('Starting Sass'));
  } finally { rmSync(work, { recursive: true, force: true }); }
});

test('startup leaves the invite block below database output, using the authenticated bot ID', async () => {
  const output = [];
  let ready;
  const source = readFileSync(join(root, 'src/events/startup.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  const dependencies = {
    '../database/index.js': { initDatabase: async () => output.push('DATABASE_READY'), closeDatabase: async () => {} },
    '../ai/index.js': { chatProviderLabel: () => 'Anthropic (Claude)' },
    '../userMemory.js': {}, '../vectorMemory.js': {}, '../shared/commandUtils.js': {},
    '../memory/distillScheduler.js': { startDistillationScheduler: () => output.push('MAINTENANCE_SCHEDULED') },
    '../handlers/autoSass.js': { AUTO_SASS_CHANCE: 0.55 },
    './shutdown.js': {},
    '../emoji.js': { loadSassEmoji: async () => {} },
  };
  // The production formatter is used when it exists; the old startup never loads it.
  if (source.includes('discordInvite.js')) dependencies['../shared/discordInvite.js'] = await import('../dist/shared/discordInvite.js');
  new Function('require', 'module', 'exports', 'console', 'process', 'setTimeout', compiled)(
    name => { assert.ok(dependencies[name], `Unexpected import ${name}`); return dependencies[name]; },
    module, module.exports, { log: text => output.push(text) }, { env: { CLIENT_ID: '999999999999999999' } }, () => {},
  );
  module.exports.setupStartup({ user: { id: appId, tag: 'synthetic test bot' }, once: (_event, callback) => { ready = callback; }, on: () => {} });
  await ready();
  const block = output.findIndex(line => line.includes(expectedUrl));
  assert.ok(block > output.indexOf('DATABASE_READY'), 'invite must remain visible below startup logs');
  assert.ok(output[block].includes('Invite Sass to your server'));
  assert.ok(output[block].includes('sass invite'));
  assert.ok(output.indexOf('MAINTENANCE_SCHEDULED') > block);
  assert.ok(output.includes('Auto-sass chance: 55%'));
  assert.ok(output.includes('AI Provider: Anthropic (Claude)'));
  assert.ok(!output.some(line => line.includes('Creator mode')));
});
