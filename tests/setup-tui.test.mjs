import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { stripVTControlCharacters } from 'node:util';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import React from 'react';
import { render } from 'ink';
import { SetupView } from '../dist/setup/tui/SetupView.js';
import { cancelInkPrompt, inkAskText, inkConfirm, inkSelect, pushDoneLine } from '../dist/setup/tui/prompterBridge.js';

async function mount(t, props = {}) {
  const stdin = new PassThrough();
  stdin.isTTY = true;
  stdin.ref = () => {};
  stdin.unref = () => {};
  stdin.setRawMode = () => {};
  let output = '';
  const frames = [];
  const stdout = new Writable({ write(chunk, _encoding, done) { output += chunk; frames.push(String(chunk)); done(); } });
  stdout.columns = 80;
  stdout.rows = 24;
  const app = render(React.createElement(SetupView, props), {
    stdin, stdout, stderr: stdout, debug: true, exitOnCtrlC: false, patchConsole: false,
  });
  t.after(() => { cancelInkPrompt(); app.unmount(); app.cleanup(); stdin.destroy(); });
  async function until(text) {
    for (let i = 0; i < 100; i++) {
      if (output.includes(text)) return;
      await delay(10);
    }
    assert.fail(`Ink did not render ${text}`);
  }
  await until('Sass');
  return { stdin, stdout, until, output: () => output, frame: () => frames.filter((frame) => frame.includes('Sass')).at(-1) };
}

test('Ink never displays an existing secret in the text placeholder', async (t) => {
  const response = inkAskText('Secret to keep', { secret: true, fallback: 'dummy-private-value' });
  response.catch(() => {});
  const ui = await mount(t);
  await ui.until('Secret to keep');
  assert.ok(!ui.output().includes('dummy-private-value'));
});

test('Ink Enter respects the displayed No confirmation default', async (t) => {
  const response = inkConfirm('Send a dummy request?', false);
  const ui = await mount(t);
  await ui.until('Send a dummy request?');
  ui.stdin.write('\r');
  assert.equal(await response, false);
});

test('Ink Ctrl+C invokes setup cancellation instead of leaving a pending prompt', async (t) => {
  let canceled = false;
  const response = inkAskText('Waiting for input');
  response.catch(() => {});
  const ui = await mount(t, { onCancel: () => { canceled = true; cancelInkPrompt(); } });
  await ui.until('Waiting for input');
  ui.stdin.write('\x03');
  await delay(20);
  assert.equal(canceled, true);
  await assert.rejects(response, /cancel/i);
});

test('Ink provider selection fits within an 80 by 24 terminal after answered questions', async (t) => {
  for (let i = 0; i < 9; i++) pushDoneLine(`Answered ${i}`, 'saved');
  const response = inkSelect('Choose a provider', Array.from({ length: 9 }, (_, i) => `Provider ${i}`), 0);
  response.catch(() => {});
  const ui = await mount(t);
  await ui.until('Provider 0');
  assert.ok(stripVTControlCharacters(ui.frame()).trimEnd().split('\n').length <= 24);
});

test('Ink does not briefly show the previous secret when a public field opens', async (t) => {
  const response = inkAskText('Secret input', { secret: true });
  const ui = await mount(t);
  ui.stdin.write('dummy-private-input');
  await ui.until('••••');
  ui.stdin.write('\r');
  assert.equal(await response, 'dummy-private-input');
  const next = inkAskText('Public input');
  next.catch(() => {});
  await ui.until('Public input');
  assert.ok(!ui.output().includes('dummy-private-input'));
});

test('real Ink runner restores the terminal before its cancel handler exits', { timeout: 5000 }, async (t) => {
  const runner = new URL('../dist/setup/tui/runInkSetup.js', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', `
    Object.defineProperty(process.stdin, 'isTTY', { value: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true });
    process.stdin.setRawMode = () => {};
    process.stdout.columns = 80; process.stdout.rows = 24;
    const { runInkSetup } = await import(${JSON.stringify(runner)});
    await runInkSetup(async p => { await p.ask('CANCEL_TEST_PROMPT'); return null; }, () => {
      process.stdout.write('CANCEL_TEST_DONE'); process.exit(130);
    });
  `], { stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = once(child, 'close');
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let output = '';
  let sent = false;
  child.stdout.on('data', chunk => {
    output += chunk;
    if (!sent && output.includes('CANCEL_TEST_PROMPT')) { sent = true; child.stdin.write('\x03'); }
  });
  child.stderr.on('data', chunk => { output += chunk; });
  const [code] = await exited;
  assert.equal(code, 130, stripVTControlCharacters(output));
  assert.ok(output.includes('\x1b[?1049l'));
  assert.ok(output.indexOf('\x1b[?1049l') < output.indexOf('CANCEL_TEST_DONE'));
});

test('long model menus keep the question and current selection visible', async (t) => {
  const response = inkSelect('Chat model choice', Array.from({ length: 30 }, (_, i) => `Model ${i}`), 0);
  response.catch(() => {});
  const ui = await mount(t);
  await ui.until('Chat model choice');
  assert.ok(stripVTControlCharacters(ui.frame()).includes('❯ Model 0'));
  for (let i = 0; i < 29; i++) {
    ui.stdin.write('\x1b[B');
    await delay(1);
  }
  await ui.until('❯ Model 29');
  assert.ok(stripVTControlCharacters(ui.frame()).includes('Chat model choice'));
  ui.stdin.write('\r');
  assert.equal(await response, 29);
});

test('pasted long secrets stay within the fixed viewport', async (t) => {
  const response = inkAskText('Paste a long test key', { secret: true });
  response.catch(() => {});
  const ui = await mount(t);
  ui.stdin.write('test-only-'.repeat(100));
  await ui.until('••••');
  assert.ok(stripVTControlCharacters(ui.frame()).trimEnd().split('\n').length <= 23);
  assert.ok(!ui.output().includes('test-only-'));
});

test('setup details scroll inside the view with PageUp and PageDown', async (t) => {
  const response = inkAskText('Keep this prompt visible');
  response.catch(() => {});
  for (let i = 0; i < 20; i++) pushDoneLine(`Detail ${i}`, 'saved');
  const ui = await mount(t);
  await ui.until('Detail 19');
  ui.stdin.write('\x1b[5~');
  await delay(30);
  const previous = stripVTControlCharacters(ui.frame());
  assert.ok(previous.includes('Keep this prompt visible'));
  assert.ok(!previous.includes('Detail 19'));
  ui.stdin.write('\x1b[6~');
  await delay(30);
  assert.ok(stripVTControlCharacters(ui.frame()).includes('Detail 19'));
});

test('inherited installer screen captures console and subprocess output without a second alternate buffer', { timeout: 5000 }, async (t) => {
  const runner = new URL('../dist/setup/tui/runInkSetup.js', import.meta.url).href;
  const spawner = new URL('../dist/setup/spawnTracked.js', import.meta.url).href;
  const spinner = new URL('../dist/setup/spinner.js', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', `
    Object.defineProperty(process.stdin, 'isTTY', { value: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true });
    process.stdin.setRawMode = () => {};
    process.stdout.columns = 80; process.stdout.rows = 24;
    const { runInkSetup } = await import(${JSON.stringify(runner)});
    const { runTrackedCommand } = await import(${JSON.stringify(spawner)});
    const { runWithSpinner } = await import(${JSON.stringify(spinner)});
    await runInkSetup(async p => {
      await p.ask('FIRST_FRAME_PROMPT');
      for (let i = 0; i < 100; i++) console.log('NOISY_LINE_' + i);
      await runWithSpinner('Synthetic work', async () => {
        await runTrackedCommand(process.execPath, ['-e', 'console.log("CHILD_MESSAGE")'], { stdio: ['ignore', 'pipe', 'pipe'] });
      });
      await p.ask('LAST_FRAME_PROMPT');
      return null;
    }, () => process.exit(130));
  `], { env: { ...process.env, SASS_INSTALL_FRAME: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = once(child, 'close');
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let output = '';
  const sent = new Set();
  child.stdout.on('data', chunk => {
    output += chunk;
    for (const prompt of ['FIRST_FRAME_PROMPT', 'LAST_FRAME_PROMPT']) {
      if (!sent.has(prompt) && output.includes(prompt)) { sent.add(prompt); child.stdin.write('\r'); }
    }
  });
  child.stderr.on('data', chunk => { output += chunk; });
  const [code] = await exited;
  assert.equal(code, 0, stripVTControlCharacters(output).slice(-1000));
  assert.ok(!output.includes('\x1b[?1049h'));
  assert.ok(!output.includes('\x1b[?1049l'));
  assert.ok(!output.includes('NOISY_LINE_0\n'));
  assert.ok(output.includes('CHILD_MESSAGE'));
});

test('setup retains all 23 rows of the original 45-column artwork', async (t) => {
  const { setupMascotLines } = await import('../dist/setup/mascotCompact.js');
  const { readFileSync } = await import('node:fs');
  const expected = readFileSync(new URL('../assets/mascot/sass-45.truecolor.ans', import.meta.url), 'utf8').trimEnd().split('\n');
  assert.deepEqual(setupMascotLines(), expected);
  const response = inkAskText('Artwork remains visible');
  response.catch(() => {});
  const ui = await mount(t);
  const frame = stripVTControlCharacters(ui.frame()).split('\n');
  const { stripVTControlCharacters: strip } = await import('node:util');
  assert.equal(frame.length, 23);
  for (let row = 0; row < 23; row++) assert.equal(frame[row].slice(0, 45).padEnd(45), strip(expected[row]));
});

test('a resized narrow window cannot accept an invisible confirmation', async (t) => {
  let accepted = false;
  const response = inkConfirm('Visible consent test', true);
  response.then(() => { accepted = true; }, () => {});
  const ui = await mount(t);
  ui.stdout.columns = 60;
  ui.stdout.emit('resize');
  await ui.until('Resize to at least 80');
  ui.stdin.write('\r');
  await delay(20);
  assert.equal(accepted, false);
  ui.stdout.columns = 80;
  ui.stdout.emit('resize');
  await delay(20);
  ui.stdin.write('\r');
  assert.equal(await response, true);
});
