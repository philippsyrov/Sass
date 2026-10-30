import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const clientId = '123456789012345678';
const token = 'MTIzNDU2Nzg5MDEyMzQ1Njc4.fake-test.signature';
const apiKey = 'sk-fake-test-key-not-a-credential';
/** OpenAI is option 2 in the cloud-first menu (1 = Anthropic). */
const OPENAI_PROVIDER = '2';
/** Piped tail after Discord: OpenAI, embedded DB, skip vision/advanced, write .env, skip start. */
function openAiPipedTail({ writeEnv = 'y', startNow = 'n', uploadAssets, cloudMemory = false } = {}) {
  return [
    'n', OPENAI_PROVIDER, apiKey, '',
    '', cloudMemory ? 'y' : 'n', ...(cloudMemory ? [] : ['n', 'n']),
    'n', 'n', writeEnv, ...(uploadAssets === undefined ? [] : [uploadAssets]), startNow,
  ].join('\n');
}
const openAiWizardFull = [clientId, token, '234567890123456789', openAiPipedTail()].join('\n');
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
    env: {
      SASS_SETUP_ADVANCED: '1',
      PATH: process.env.PATH,
      TERM: 'xterm',
      SASS_TEST_TERMINAL: terminal ? '1' : '0',
      SASS_TEST_SKIP_EMBEDDED: '1',
      SASS_TEST_SKIP_LOCAL_EMBED: '1',
    },
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
      const waitMs = terminal ? 60_000 : 30_000;
      const timer = setTimeout(() => finish(new Error(`Setup did not reach ${JSON.stringify(text)}`)), waitMs);
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
  await until(dotenv === undefined ? 'Application ID (CLIENT_ID)' : 'Go through setup and update it?');
  return { child, cwd, exited, until, answer, output: () => output };
}

for (const [name, key] of [['Up arrow', '\u001b[A'], ['Ctrl+P', '\u0010'], ['Ctrl+Y after deleting a secret', '\u0019']]) {
  for (const secret of ['Discord token', 'API key']) {
    test(`${name} cannot reveal a previous ${secret} at a public prompt`, { timeout: 60_000 }, async (t) => {
      const wizard = await startWizard(t, true);
      const discarded = 'discarded-fake-secret';
      const edited = key === '\u0019' ? `${discarded}\u0015` : '';
      await wizard.answer(clientId, 'Bot token (DISCORD_TOKEN)');
      const firstPrompt = await wizard.answer(`${edited}${token}`, 'Your Discord user ID (CREATOR_ID)');
      assert.ok(!firstPrompt.includes(token), 'token must be hidden while entered');
      let sensitive = token;
      if (secret === 'API key') {
        await wizard.answer('234567890123456789', 'Check the token with Discord now?');
        await wizard.answer('n', 'Provider');
        await wizard.answer(OPENAI_PROVIDER, 'OpenAI API key');
        const modelPrompt = await wizard.answer(`${edited}${apiKey}`, 'Chat model');
        await wizard.answer('', 'How should Postgres run?');
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
        ? 'How should Postgres run?'
        : 'Your Discord user ID (CREATOR_ID)');
    });
  }
}

test('a same-chunk yank cannot carry deleted secret text into the next prompt', { timeout: 60_000 }, async (t) => {
  const wizard = await startWizard(t, true);
  await wizard.answer(clientId, 'Bot token (DISCORD_TOKEN)');
  const from = wizard.output().length;
  wizard.child.stdin.write(`discarded-fake-secret\u0015${token}\n\u0019`);
  await wizard.until('Your Discord user ID (CREATOR_ID)', from);
  wizard.child.stdin.write('PUBLIC_MARKER');
  const output = await wizard.until('PUBLIC_MARKER', from);
  assert.ok(!output.includes('discarded-fake-secret'));
  assert.ok(!output.includes(token));
  await wizard.answer('\u0015', 'Your Discord user ID (CREATOR_ID)');
});

test('rejected and raw-form secret attempts cannot be recalled', { timeout: 60_000 }, async (t) => {
  const wizard = await startWizard(t, true);
  await wizard.answer('rejected-secret-attempt', 'Application ID (CLIENT_ID)');
  await wizard.answer(clientId, 'Bot token (DISCORD_TOKEN)');
  const raw = `  "Bot ${token}"  `;
  await wizard.answer(raw, 'Your Discord user ID (CREATOR_ID)');
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
  await wizard.answer(clientId, 'Bot token (DISCORD_TOKEN)');
  const from = wizard.output().length;
  wizard.child.stdin.write(`${token}\r`);
  await wizard.until('Your Discord user ID (CREATOR_ID)', from);
  wizard.child.stdin.write('\nPUBLIC_MARKER\n');
  const output = await wizard.until('PUBLIC_MARKER', from);
  assert.ok(!output.includes('234567890123456789'), 'CRLF must not submit CREATOR_ID early');
  await wizard.answer('', 'Your Discord user ID (CREATOR_ID)');
});

test('resuming a retired editor cannot render its secret draft', {
  timeout: 60_000, skip: process.platform === 'win32',
}, async (t) => {
  const wizard = await startWizard(t, true);
  await wizard.answer(clientId, 'Bot token (DISCORD_TOKEN)');
  const from = wizard.output().length;
  wizard.child.stdin.write(`discarded-fake-secret\u0015${token}\u001a\n\u0019`);
  await wizard.until('SUSPEND_GROUP', from);
  wizard.child.kill('SIGCONT');
  await wizard.until('SIGNAL_HANDLED', from);
  const output = wizard.output().slice(from);
  assert.ok(!output.includes('discarded-fake-secret'), 'retired editor output must remain disabled');
  assert.ok(!output.includes(token));
  await wizard.answer('\u0015', 'Your Discord user ID (CREATOR_ID)');
});

test('Ctrl+Z suspends the whole process group and a secret typed after resume stays hidden', {
  timeout: 60_000, skip: process.platform === 'win32',
}, async (t) => {
  const wizard = await startWizard(t, true);
  await wizard.answer(clientId, 'Bot token (DISCORD_TOKEN)');
  const from = wizard.output().length;
  wizard.child.stdin.write('discarded-fake-secret\u001a');
  await wizard.until('SUSPEND_GROUP', from);
  assert.ok(!wizard.output().slice(from).includes('SUSPEND_SELF'), 'must not stop only the wizard process');
  wizard.child.kill('SIGCONT');
  await wizard.until('SIGNAL_HANDLED', from);
  await wizard.answer(`\u0015${token}`, 'Your Discord user ID (CREATOR_ID)');
  const output = wizard.output().slice(from);
  assert.ok(!output.includes('discarded-fake-secret'), 'a draft must stay hidden after resume');
  assert.ok(!output.includes(token), 'a secret typed after resume must stay hidden');
  assert.ok(!output.includes('A bot token has'), 'the secret typed after resume must be accepted');
  await wizard.answer('\u0015', 'Your Discord user ID (CREATOR_ID)');
});

for (const [name, dbAnswer, expected, afterDb] of [
  ['Enter keeps', '', dbUrl, ['n', 'n', 'n', 'n', 'n']],
  ['"none" removes', 'none', '', ['n', 'n']],
]) {
  test(`an existing DATABASE_URL is never displayed; ${name} it`, { timeout: 60_000 }, async (t) => {
    const wizard = await startWizard(t, false, { dotenv: existingEnv });
    wizard.child.stdin.end([
      'y', '', '', '', 'n', OPENAI_PROVIDER, '', '', '2', dbAnswer, ...afterDb, 'y', 'n',
    ].join('\n'));
    const [code] = await wizard.exited;
    const output = wizard.output();
    assert.equal(code, 0, output);
    assert.match(output, /Your input is hidden; the URL usually contains a password\./);
    for (const secret of [dbPassword, token, apiKey]) assert.ok(!output.includes(secret));
    const written = await readFile(join(wizard.cwd, '.env'), 'utf8');
    if (name === '"none" removes') {
      assert.ok(!written.includes('postgres://sass'), written);
    } else {
      assert.ok(written.includes(expected), written);
    }
  });
}

test('a typed DATABASE_URL and the stored one stay hidden in a terminal', {
  timeout: 30_000,
}, async (t) => {
  const wizard = await startWizard(t, true, { dotenv: existingEnv });
  const typedPassword = 'typed-db-pass-not-real';
  await wizard.answer('y', 'Application ID (CLIENT_ID)');
  await wizard.answer('', 'Bot token (DISCORD_TOKEN)');
  await wizard.answer('', 'Your Discord user ID (CREATOR_ID)');
  await wizard.answer('', 'Check the token with Discord now?');
  await wizard.answer('n', 'Provider');
  await wizard.answer(OPENAI_PROVIDER, 'OpenAI API key');
  await wizard.answer('', 'Chat model');
  await wizard.answer('', 'How should Postgres run?');
  await wizard.answer('2', 'Postgres URL (DATABASE_URL');
  await wizard.answer(`postgres://sass:${typedPassword}@127.0.0.1:5432/sass`, 'Use your OpenAI key for memory search too?');
  await wizard.answer('n', 'Advanced: cloud or Ollama embeddings instead?');
  await wizard.answer('n', 'Download or prepare this local memory search model?');
  await wizard.answer('n', 'Enable image roasts?');
  await wizard.answer('n', 'Customize auto-sass frequency?');
  await wizard.answer('n', 'Back up the old .env and write the new one?');
  wizard.child.stdin.write('\u0003');
  const [code] = await wizard.exited;
  const output = wizard.output();
  assert.equal(code, 130);
  assert.ok(output.includes('Nothing was written.'));
  for (const secret of [dbPassword, typedPassword, token, apiKey]) assert.ok(!output.includes(secret));
  assert.equal(await readFile(join(wizard.cwd, '.env'), 'utf8'), existingEnv, '.env must be unchanged');
});

test('Ctrl+C after .env was written says so', {
  timeout: 120_000,
}, async (t) => {
  const wizard = await startWizard(t, false);
  const tailLines = openAiPipedTail({ writeEnv: 'y', startNow: 'n' }).split('\n');
  tailLines.pop();
  const throughWrite = [clientId, token, '234567890123456789', ...tailLines].join('\n');
  wizard.child.stdin.write(`${throughWrite}\n`);
  await wizard.until('Build, register slash commands, and start Sass now?');
  wizard.child.kill('SIGINT');
  const [code] = await wizard.exited;
  assert.equal(code, 130);
  assert.ok(wizard.output().includes('Setup cancelled. The new .env was already written.'));
  assert.ok(!wizard.output().includes('Nothing was written'));
  await access(join(wizard.cwd, '.env'));
});

test('a failed build step makes setup exit non-zero', { timeout: 60_000 }, async (t) => {
  const wizard = await startWizard(t, false);
  wizard.child.stdin.end([clientId, token, '234567890123456789', openAiPipedTail({ startNow: 'y' })].join('\n'));
  const [code] = await wizard.exited;
  assert.equal(code, 1, 'the temp project has no build script, so npm run build fails');
  assert.ok(wizard.output().includes('$ npm run build'));
  await access(join(wizard.cwd, '.env'));
});

test('default database choice writes SASS_EMBEDDED_PG', { timeout: 60_000 }, async (t) => {
  const wizard = await startWizard(t, false);
  wizard.child.stdin.end(openAiWizardFull);
  const [code] = await wizard.exited;
  assert.equal(code, 0, wizard.output());
  assert.match(wizard.output(), /Step 3 of 5 · Memory \(database\)/);
  const written = await readFile(join(wizard.cwd, '.env'), 'utf8');
  assert.match(written, /SASS_EMBEDDED_PG=1/);
});

test('skip database requires confirmation then accepts embedded', { timeout: 60_000 }, async (t) => {
  const wizard = await startWizard(t, false);
  wizard.child.stdin.end([
    clientId, token, '234567890123456789', 'n', OPENAI_PROVIDER, apiKey, '',
    '4', 'n', '1', '', '', 'n', '', '', 'y', 'n',
  ].join('\n'));
  const [code] = await wizard.exited;
  assert.equal(code, 0, wizard.output());
  assert.match(wizard.output(), /Without Postgres, Sass still roasts/);
  const written = await readFile(join(wizard.cwd, '.env'), 'utf8');
  assert.match(written, /SASS_EMBEDDED_PG=1/);
});

test('piped answers retain defaults and can cancel before writing', { timeout: 60_000 }, async (t) => {
  const wizard = await startWizard(t, false);
  wizard.child.stdin.end([clientId, token, '234567890123456789', openAiPipedTail({ writeEnv: 'n' })].join('\n'));
  const [code] = await wizard.exited;
  assert.equal(code, 0);
  assert.match(wizard.output(), /OPENAI_MODEL.*gpt-4o-mini/);
  assert.ok(!wizard.output().includes(token));
  assert.ok(!wizard.output().includes(apiKey));
  await assert.rejects(access(join(wizard.cwd, '.env')), { code: 'ENOENT' });
});

test('setup summary keeps the embedding key hidden as well as the chat key', { timeout: 60_000 }, async (t) => {
  const wizard = await startWizard(t, false);
  wizard.child.stdin.end([clientId, token, '234567890123456789', openAiPipedTail({ cloudMemory: true })].join('\n'));
  const [code] = await wizard.exited;
  const output = wizard.output();
  assert.equal(code, 0, output);
  assert.ok(output.includes('EMBEDDING_OPENAI_API_KEY'));
  assert.ok(!output.includes(apiKey));
  assert.ok(!output.includes(token));
});

for (const [answer, expected] of [['y', 'Emoji upload failed: Could not reach Discord'], ['n', 'Run `sass setup` any time']]) {
  test(`setup offers the bundled emoji upload; "${answer}" never fails setup`, { timeout: 60_000 }, async (t) => {
    const wizard = await startWizard(t, false, { emoji: true });
    wizard.child.stdin.end([
      clientId, token, '234567890123456789', openAiPipedTail({ uploadAssets: answer }),
    ].join('\n'));
    const [code] = await wizard.exited;
    const output = wizard.output();
    assert.equal(code, 0, output);
    assert.ok(output.includes('Upload them to your app now?'));
    assert.ok(output.includes(expected), output);
    assert.ok(!output.includes('avatar and a banner'), 'no profile art, no profile offer');
    assert.ok(!output.includes(token));
    await access(join(wizard.cwd, '.env'));
  });
}

test('setup offers the bundled avatar and banner; a failure never fails setup', { timeout: 60_000 }, async (t) => {
  const wizard = await startWizard(t, false, { emoji: true, profile: true });
  wizard.child.stdin.end([
    clientId, token, '234567890123456789', openAiPipedTail({ uploadAssets: 'y' }),
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
