import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const token = 'MTIzNDU2Nzg5MDEyMzQ1Njc4.fake-test.signature';
const apiKey = 'sk-fake-test-key-not-a-credential';
const dbPassword = 'fake-db-pass-not-real';
const dbUrl = `postgres://sass:${dbPassword}@localhost:5432/sass`;
const existingEnv = [
  `DISCORD_TOKEN=${token}`, 'CLIENT_ID=123456789012345678', 'CREATOR_ID=234567890123456789',
  'AI_PROVIDER=openai', `OPENAI_API_KEY=${apiKey}`, 'OPENAI_MODEL=gpt-4o-mini', `DATABASE_URL=${dbUrl}`, '',
].join('\n');

async function startWizard(t, terminal, { dotenv, emoji = false, profile = false } = {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'sass-setup-test-'));
  await mkdir(join(cwd, 'src'));
  await writeFile(join(cwd, 'src/index.ts'), '');
  await writeFile(join(cwd, 'package.json'), '{}');
  await writeFile(join(cwd, '.env.example'), await readFile(join(root, '.env.example')));
  if (dotenv !== undefined) await writeFile(join(cwd, '.env'), dotenv);
  if (emoji) {
    await mkdir(join(cwd, 'assets/emoji'), { recursive: true });
    await writeFile(join(cwd, 'assets/emoji/sass_fire.png'), 'not-a-real-png');
  }
  if (profile) {
    await mkdir(join(cwd, 'assets'), { recursive: true });
    await writeFile(join(cwd, 'assets/avatar.png'), 'not-a-real-png');
    await writeFile(join(cwd, 'assets/banner.png'), 'not-a-real-png');
  }
  const child = spawn(process.execPath, [
    '--import', import.meta.resolve('tsx'),
    '--import', fileURLToPath(new URL('./fixtures/setup-input.mjs', import.meta.url)),
    join(root, 'src/setup.ts'),
  ], {
    cwd,
    env: { PATH: process.env.PATH, TERM: 'xterm', SASS_TEST_TERMINAL: terminal ? '1' : '0' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const exited = once(child, 'close');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
    await rm(cwd, { recursive: true, force: true });
  });
  function until(text, from = 0) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error(`Setup did not reach ${JSON.stringify(text)}`)), 30_000);
      const check = () => { if (output.slice(from).includes(text)) finish(); };
      const stopped = () => finish(new Error(`Setup exited before ${JSON.stringify(text)}`));
      function finish(error) {
        clearTimeout(timer);
        child.stdout.off('data', check);
        child.stderr.off('data', check);
        child.off('exit', stopped);
        if (error) reject(error); else resolve(output.slice(from));
      }
      child.stdout.on('data', check);
      child.stderr.on('data', check);
      child.on('exit', stopped);
      check();
    });
  }
  async function answer(value, nextPrompt) {
    const from = output.length;
    child.stdin.write(`${value}\n`);
    return until(nextPrompt, from);
  }
  await until(dotenv === undefined ? 'Bot token: ' : 'Go through setup and update it?');
  return { child, cwd, exited, until, answer, output: () => output };
}

for (const [name, key] of [['Up arrow', '\u001b[A'], ['Ctrl+P', '\u0010'], ['Ctrl+Y after deleting a secret', '\u0019']]) {
  for (const secret of ['Discord token', 'API key']) {
    test(`${name} cannot reveal a previous ${secret} at a public prompt`, { timeout: 60_000 }, async (t) => {
      const wizard = await startWizard(t, true);
      const discarded = 'discarded-fake-secret';
      const edited = key === '\u0019' ? `${discarded}\u0015` : '';
      const firstPrompt = await wizard.answer(`${edited}${token}`, 'Application ID (CLIENT_ID)');
      assert.ok(!firstPrompt.includes(token), 'token must be hidden while entered');
      let sensitive = token;
      if (secret === 'API key') {
        await wizard.answer('', 'Your Discord user ID (CREATOR_ID)');
        await wizard.answer('234567890123456789', 'Check the token with Discord now?');
        await wizard.answer('n', 'Provider [1]');
        await wizard.answer('1', 'OpenAI API key: ');
        const modelPrompt = await wizard.answer(`${edited}${apiKey}`, 'Chat model (OPENAI_MODEL)');
        assert.ok(!modelPrompt.includes(apiKey), 'API key must be hidden while entered');
        sensitive = apiKey;
      }
      const from = wizard.output().length;
      // The marker makes this deterministic: wait for readline to process the key sequence.
      wizard.child.stdin.write(`${key}PUBLIC_MARKER`);
      const recalled = await wizard.until('PUBLIC_MARKER', from);
      assert.ok(!recalled.includes(sensitive), 'history navigation must not print a secret');
      assert.ok(!recalled.includes(token), 'older secrets must not be recalled either');
      assert.ok(!recalled.includes(discarded), 'deleted secret text must not survive in the kill ring');
      // Editing and accepting the ordinary default still work after history navigation.
      await wizard.answer('\u0015', secret === 'API key'
        ? 'Check the key and model name against the API now?'
        : 'Your Discord user ID (CREATOR_ID)');
    });
  }
}

test('a same-chunk yank cannot carry deleted secret text into the next prompt', { timeout: 60_000 }, async (t) => {
  const wizard = await startWizard(t, true);
  const from = wizard.output().length;
  wizard.child.stdin.write(`discarded-fake-secret\u0015${token}\n\u0019`);
  await wizard.until('Application ID (CLIENT_ID)', from);
  wizard.child.stdin.write('PUBLIC_MARKER');
  const output = await wizard.until('PUBLIC_MARKER', from);
  assert.ok(!output.includes('discarded-fake-secret'));
  assert.ok(!output.includes(token));
  await wizard.answer('\u0015', 'Your Discord user ID (CREATOR_ID)');
});

test('rejected and raw-form secret attempts cannot be recalled', { timeout: 60_000 }, async (t) => {
  const wizard = await startWizard(t, true);
  await wizard.answer('rejected-secret-attempt', 'Bot token: ');
  const raw = `  "Bot ${token}"  `;
  await wizard.answer(raw, 'Application ID (CLIENT_ID)');
  const from = wizard.output().length;
  wizard.child.stdin.write('\u001b[A\u0010PUBLIC_MARKER');
  const output = await wizard.until('PUBLIC_MARKER', from);
  assert.ok(!output.includes(token));
  assert.ok(!output.includes('rejected-secret-attempt'));
  await wizard.answer('\u0015', 'Your Discord user ID (CREATOR_ID)');
  wizard.child.stdin.write('\u0003');
  const [code] = await wizard.exited;
  assert.equal(code, 130);
  await assert.rejects(access(join(wizard.cwd, '.env')), { code: 'ENOENT' });
});

test('same-chunk CRLF keeps the next public prompt visible', { timeout: 60_000 }, async (t) => {
  const wizard = await startWizard(t, true);
  wizard.child.stdin.write(`${token}\r\n`);
  const cancel = setTimeout(() => wizard.child.stdin.write('\u0003'), 100);
  t.after(() => clearTimeout(cancel));
  await wizard.exited;
  assert.ok(wizard.output().includes('Application ID (CLIENT_ID)'), 'the next prompt must be visible');
});

test('a split CRLF after a secret does not submit the next prompt', { timeout: 60_000 }, async (t) => {
  const wizard = await startWizard(t, true);
  wizard.child.stdin.write(`${token}\r`);
  await wizard.until('Application ID (CLIENT_ID)');
  const from = wizard.output().length;
  wizard.child.stdin.write('\nPUBLIC_MARKER\n');
  const output = await wizard.until('should be a number with 17 to 20 digits', from);
  assert.ok(output.includes('The Application ID should be'), 'CRLF must be one submission');
  await wizard.answer('', 'Your Discord user ID (CREATOR_ID)');
});

test('resuming a retired editor cannot render its secret draft', {
  timeout: 60_000, skip: process.platform === 'win32',
}, async (t) => {
  const wizard = await startWizard(t, true);
  wizard.child.stdin.write(`discarded-fake-secret\u0015${token}\u001a\n\u0019`);
  await wizard.until('Application ID (CLIENT_ID)');
  const from = wizard.output().length;
  wizard.child.kill('SIGCONT');
  const output = await wizard.until('SIGNAL_HANDLED', from);
  assert.ok(!output.includes('discarded-fake-secret'), 'retired editor output must remain disabled');
  assert.ok(!output.includes(token));
  // The wizard keeps working after the resume.
  await wizard.answer('\u0015', 'Your Discord user ID (CREATOR_ID)');
});

test('Ctrl+Z suspends the whole process group and a secret typed after resume stays hidden', {
  timeout: 60_000, skip: process.platform === 'win32',
}, async (t) => {
  const wizard = await startWizard(t, true);
  const from = wizard.output().length;
  wizard.child.stdin.write('discarded-fake-secret\u001a');
  await wizard.until('SUSPEND_GROUP', from);
  assert.ok(!wizard.output().slice(from).includes('SUSPEND_SELF'), 'must not stop only the wizard process');
  wizard.child.kill('SIGCONT');
  await wizard.until('SIGNAL_HANDLED', from);
  await wizard.answer(`\u0015${token}`, 'Application ID (CLIENT_ID)');
  const output = wizard.output().slice(from);
  assert.ok(!output.includes('discarded-fake-secret'), 'a draft must stay hidden after resume');
  assert.ok(!output.includes(token), 'a secret typed after resume must stay hidden');
  assert.ok(!output.includes('A bot token has'), 'the secret typed after resume must be accepted');
  await wizard.answer('\u0015', 'Your Discord user ID (CREATOR_ID)');
});

for (const [name, dbAnswer, expected] of [['Enter keeps', '', `DATABASE_URL=${dbUrl}`], ['"none" removes', 'none', 'DATABASE_URL=\n']]) {
  test(`an existing DATABASE_URL is never displayed; ${name} it`, { timeout: 60_000 }, async (t) => {
    const wizard = await startWizard(t, false, { dotenv: existingEnv });
    wizard.child.stdin.end([
      'y', '', '', '', 'n', '', '', '', 'n', 'n', dbAnswer, 'n', 'y', 'n', '',
    ].join('\n'));
    const [code] = await wizard.exited;
    const output = wizard.output();
    assert.equal(code, 0, output);
    assert.match(output, /DATABASE_URL, "none" removes it\) \[Enter keeps the current value\]/);
    for (const secret of [dbPassword, token, apiKey]) assert.ok(!output.includes(secret));
    const written = await readFile(join(wizard.cwd, '.env'), 'utf8');
    assert.ok(written.includes(expected));
  });
}

test('a typed DATABASE_URL and the stored one stay hidden in a terminal', { timeout: 60_000 }, async (t) => {
  const wizard = await startWizard(t, true, { dotenv: existingEnv });
  const typedPassword = 'typed-db-pass-not-real';
  await wizard.answer('y', 'Bot token');
  await wizard.answer('', 'Application ID (CLIENT_ID)');
  await wizard.answer('', 'Your Discord user ID (CREATOR_ID)');
  await wizard.answer('', 'Check the token with Discord now?');
  await wizard.answer('n', 'Provider [1]');
  await wizard.answer('', 'OpenAI API key');
  await wizard.answer('', 'Chat model (OPENAI_MODEL)');
  await wizard.answer('', 'Check the key and model name against the API now?');
  await wizard.answer('n', 'Do you want image roasts?');
  await wizard.answer('n', 'Postgres URL (DATABASE_URL');
  await wizard.answer(`postgres://sass:${typedPassword}@localhost/sass`, 'Change how often?');
  await wizard.answer('n', 'Back up the old .env and write the new one?');
  wizard.child.stdin.write('\u0003');
  const [code] = await wizard.exited;
  const output = wizard.output();
  assert.equal(code, 130);
  assert.ok(output.includes('Nothing was written.'));
  for (const secret of [dbPassword, typedPassword, token, apiKey]) assert.ok(!output.includes(secret));
  assert.equal(await readFile(join(wizard.cwd, '.env'), 'utf8'), existingEnv, '.env must be unchanged');
});

test('Ctrl+C after .env was written says so', { timeout: 60_000 }, async (t) => {
  const wizard = await startWizard(t, true);
  await wizard.answer(token, 'Application ID (CLIENT_ID)');
  await wizard.answer('', 'Your Discord user ID (CREATOR_ID)');
  await wizard.answer('234567890123456789', 'Check the token with Discord now?');
  await wizard.answer('n', 'Provider [1]');
  await wizard.answer('1', 'OpenAI API key: ');
  await wizard.answer(apiKey, 'Chat model (OPENAI_MODEL)');
  await wizard.answer('', 'Check the key and model name against the API now?');
  await wizard.answer('n', 'Do you want image roasts?');
  await wizard.answer('n', 'Postgres URL (DATABASE_URL');
  await wizard.answer('', 'Change how often?');
  await wizard.answer('n', 'Write .env?');
  await wizard.answer('y', 'start Sass now?');
  wizard.child.stdin.write('\u0003');
  const [code] = await wizard.exited;
  assert.equal(code, 130);
  assert.ok(wizard.output().includes('Setup cancelled. The new .env was already written.'));
  assert.ok(!wizard.output().includes('Nothing was written'));
  await access(join(wizard.cwd, '.env'));
});

test('a failed build step makes setup exit non-zero', { timeout: 60_000 }, async (t) => {
  const wizard = await startWizard(t, false);
  wizard.child.stdin.end([
    token, '', '234567890123456789', 'n', '1', apiKey, '', 'n', 'n', '', 'n', 'y', 'y', '',
  ].join('\n'));
  const [code] = await wizard.exited;
  assert.equal(code, 1, 'the temp project has no build script, so npm run build fails');
  assert.ok(wizard.output().includes('$ npm run build'));
  await access(join(wizard.cwd, '.env'));
});

test('piped answers retain defaults and can cancel before writing', { timeout: 60_000 }, async (t) => {
  const wizard = await startWizard(t, false);
  wizard.child.stdin.end([
    token, '', '234567890123456789', 'n', '1', apiKey, '', 'n', 'n', '', 'n', 'n', '',
  ].join('\n'));
  const [code] = await wizard.exited;
  assert.equal(code, 0);
  assert.match(wizard.output(), /OPENAI_MODEL\s+gpt-4o-mini/);
  assert.ok(!wizard.output().includes(token));
  assert.ok(!wizard.output().includes(apiKey));
  await assert.rejects(access(join(wizard.cwd, '.env')), { code: 'ENOENT' });
});

for (const [answer, expected] of [['y', 'Emoji upload failed: Could not reach Discord'], ['n', 'Run `npm run assets` any time']]) {
  test(`setup offers the bundled emoji upload; "${answer}" never fails setup`, { timeout: 60_000 }, async (t) => {
    const wizard = await startWizard(t, false, { emoji: true });
    wizard.child.stdin.end([
      token, '', '234567890123456789', 'n', '1', apiKey, '', 'n', 'n', '', 'n', 'y', answer, 'n', '',
    ].join('\n'));
    const [code] = await wizard.exited;
    const output = wizard.output();
    assert.equal(code, 0, output);
    assert.ok(output.includes('Upload them to your app now? [Y/n]'));
    assert.ok(output.includes(expected), output);
    assert.ok(!output.includes('avatar and a banner'), 'no profile art, no profile offer');
    assert.ok(!output.includes(token));
    await access(join(wizard.cwd, '.env'));
  });
}

test('setup offers the bundled avatar and banner; a failure never fails setup', { timeout: 60_000 }, async (t) => {
  const wizard = await startWizard(t, false, { emoji: true, profile: true });
  wizard.child.stdin.end([
    token, '', '234567890123456789', 'n', '1', apiKey, '', 'n', 'n', '', 'n', 'y', 'y', 'n', '',
  ].join('\n'));
  const [code] = await wizard.exited;
  const output = wizard.output();
  assert.equal(code, 0, output);
  assert.ok(output.includes('your own images are kept'), output);
  assert.ok(output.includes('Emoji upload failed: Could not reach Discord'), output);
  assert.ok(output.includes('Avatar/banner check failed: Could not reach Discord'), output);
  assert.ok(!output.includes(token));
  await access(join(wizard.cwd, '.env'));
});
