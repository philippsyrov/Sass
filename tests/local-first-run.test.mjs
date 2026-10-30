import assert from 'node:assert/strict';
import test from 'node:test';

test('local memory defaults require a real offline health check without prompting or changing an existing model', async () => {
  const { prepareLocalMemory } = await import('../dist/setup/localFirstRun.js');
  const values = { LOCAL_EMBED_MODEL: 'existing-model', EMBEDDING_DIMENSION: '384' };
  let checked;
  await prepareLocalMemory(values, async config => { checked = config; return { ok: true, detail: 'cached' }; });
  assert.equal(checked.SASS_EMBEDDING_PROVIDER, 'local');
  assert.equal(values.LOCAL_EMBED_MODEL, 'existing-model');
  assert.equal(values.EMBEDDING_DIMENSION, '384');
  assert.equal(values.SASS_EMBEDDED_PG, '1');
});

test('missing required model fails readiness rather than silently turning memory off', async () => {
  const { prepareLocalMemory } = await import('../dist/setup/localFirstRun.js');
  await assert.rejects(prepareLocalMemory({}, async () => ({ ok: false, detail: 'not cached' })), /not cached/);
});

for (const acceptStart of [false, true]) test(`normal setup saves local defaults and ${acceptStart ? 'offers final Enter without Ink' : 'leaves piped setup stopped'}`, async () => {
  const { mkdtemp, mkdir, writeFile, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join, resolve } = await import('node:path');
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  const root = resolve(import.meta.dirname, '..');
  const work = await mkdtemp(join(tmpdir(), 'sass-local-flow-'));
  try {
    await mkdir(join(work, 'src'));
    await writeFile(join(work, 'src/index.ts'), '');
    await writeFile(join(work, 'package.json'), '{}');
    const child = spawn(process.execPath, ['--import', join(root, 'tests/fixtures/local-setup-input.mjs'), join(root, 'dist/setup.js')], {
      cwd: work, env: { PATH:process.env.PATH, SASS_TEST_SKIP_EMBEDDED:'1', SASS_SETUP_INK:'0', ...(acceptStart ? { SASS_TEST_FINAL_ACTION: '1', SASS_INSTALL_FRAME: '1' } : {}) }, stdio: ['pipe','pipe','pipe'],
    });
    const exited = once(child, 'close');
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    child.stdin.end('MTIzNDU2Nzg5MDEyMzQ1Njc4.fake-test.signature\n2\nsk-fake-test-key-not-a-credential\n' + (acceptStart ? '\n' : ''));
    const [code] = await exited;
    assert.equal(code, acceptStart ? 10 : 0, output);
    if (acceptStart) assert.match(output, /Press Enter to start Sass/);
    for (const prompt of ['How should Postgres run?', 'Write .env?', 'Advanced: cloud', 'Enable image roasts?', 'Customize auto-sass', 'Upload them to your app now?', 'Build and register commands now?']) assert.ok(!output.includes(prompt), prompt);
    const env = await readFile(join(work,'.env'),'utf8');
    assert.match(env, /SASS_EMBEDDED_PG=1/);
    assert.match(env, /SASS_EMBEDDING_PROVIDER=local/);
    assert.match(env, /CREATOR_ID=234567890123456789/);
    assert.ok(!output.includes('sk-fake-test-key'));
  } finally { await rm(work,{recursive:true,force:true}); }
});

test('expert bundle setup registers commands before starting without npm', async () => {
  const { startAfterSetup } = await import('../dist/setup/startAfterSetup.js');
  const calls = [];
  assert.equal(await startAfterSetup(async (command, args) => { calls.push([command, args]); return true; }, false, true), true);
  assert.deepEqual(calls.map(([, args]) => args), [['dist/register-commands.js'], ['dist/index.js']]);
  assert.ok(calls.every(([command]) => command === process.execPath));
  const stopped = [];
  assert.equal(await startAfterSetup(async (_command, args) => { stopped.push(args); return false; }, false, true), false);
  assert.deepEqual(stopped, [['dist/register-commands.js']]);
});

test('simple setup starts only after its earlier readiness and registration work', async () => {
  const { startAfterSetup } = await import('../dist/setup/startAfterSetup.js');
  const calls = [];
  assert.equal(await startAfterSetup(async (command, args) => { calls.push([command, args]); return true; }, true, true), true);
  assert.deepEqual(calls, [[process.execPath, ['dist/index.js']]]);
});
