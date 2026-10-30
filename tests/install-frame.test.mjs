import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { terminalScreen } from './helpers/terminal-screen.mjs';

function run(mode) {
  const child = spawnSync('python3', ['tests/fixtures/install-pty.py', mode], { env: { ...process.env, SASS_TEST_NODE: process.execPath }, encoding: 'utf8', timeout: 12_000 });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(terminalScreen(result.output).scrolls, 0, 'no terminal scrolling during install');
  return result;
}
test('fresh installer shows embedded block art and one alternate screen before consent', () => {
  const { output, code, stateExists, restored } = run('decline');
  assert.equal(code, 0);
  const first = output.slice(0, output.indexOf('Continue?') + 'Continue?'.length);
  assert.ok(first.includes('▀') || first.includes('▄'), 'Sass must appear before any clone');
  assert.ok(first.includes('\x1b[?1049h'));
  for (const line of readFileSync(new URL('../assets/mascot/sass-45.truecolor.ans', import.meta.url), 'utf8').trimEnd().split('\n')) {
    assert.ok(first.includes(line), 'show every original 45-column art row before consent');
  }
  const screen = terminalScreen(first).screen;
  assert.ok(screen.includes('Sass · Discord roast bot'));
  assert.ok(screen.includes('Files:'));
  assert.ok(screen.includes('Continue?'));
  assert.ok(output.includes('\x1b[?1049l'));
  assert.equal(stateExists, false, 'declining must create no installation state');
});
test('bootstrap command output stays out of the fixed screen', () => {
  const { output, code } = run('success');
  assert.equal(code, 0);
  assert.ok(!output.includes('RAW_'), output);
  assert.equal(output.split('\x1b[?1049h').length - 1, 1);
  assert.equal(output.split('\x1b[?1049l').length - 1, 1);
  assert.ok(output.includes('Press Enter to close'));
});
test('command failure stays visible and restores terminal on close', () => {
  const { output, code } = run('fail');
  assert.equal(code, 7);
  assert.ok(output.includes('Install stopped'));
  assert.ok(!output.includes('RAW_'));
  assert.ok(output.includes('\x1b[?1049l'));
});
test('Ctrl+C restores the terminal without starting installation', () => {
  const { output, code, stateExists, restored } = run('cancel');
  assert.equal(code, 130);
  assert.ok(output.includes('\x1b[?1049l'));
  assert.equal(stateExists, false);
  assert.equal(restored, true);
});

test('shell and real Ink setup share one fixed terminal buffer', () => {
  const { output, code } = run('handoff');
  assert.equal(code, 0);
  assert.ok(output.includes('HANDOFF_PROMPT'));
  assert.ok(output.includes('HANDOFF_FINISH'));
  const firstSetup = terminalScreen(output.slice(0, output.indexOf('HANDOFF_FINISH'))).screen;
  assert.ok(!firstSetup.includes('Only if Node is missing or old.'));
  assert.ok(!firstSetup.includes('Dependencies in the Sass folder.'));
  assert.equal(output.split('\x1b[?1049h').length - 1, 1);
  assert.equal(output.split('\x1b[?1049l').length - 1, 1);
  assert.ok(!output.includes('SETUP_DETAIL_0\r\n'));
});

test('Ctrl+C also stops an active install command and restores terminal state', () => {
  const { output, code, restored } = run('cancel-work');
  assert.equal(code, 130);
  assert.equal(restored, true);
  assert.ok(output.includes('\x1b[?1049l'));
});

test('resizing keeps the fixed layout and does not consent to a hidden plan', () => {
  const { output, code, stateExists, smallOutput } = run('resize');
  assert.equal(code, 0);
  assert.equal(stateExists, false);
  assert.ok(output.includes('Resize the window to read the plan'));
  assert.ok(smallOutput.includes('Resize to 80 columns'));
  assert.ok(!output.includes('RAW_'));
  const small = terminalScreen('\x1b[?1049h' + smallOutput, 60, 20);
  assert.equal(small.scrolls, 0);
});

test('consent waits for a person instead of closing after a Bash 3.2 read timeout', () => {
  const { code, prematureClose, stateExists } = run('delayed');
  assert.equal(code, 0);
  assert.equal(prematureClose, false, 'a timeout must not close the consent screen');
  assert.equal(stateExists, false);
});

test('piped Bash 3.2 installer also waits for consent', () => {
  const { code, prematureClose, stateExists } = run('piped');
  assert.equal(code, 0);
  assert.equal(prematureClose, false);
  assert.equal(stateExists, false);
});

test('a real Enter key still approves the displayed installation plan', () => {
  const { code, stateExists } = run('enter');
  assert.equal(code, 0);
  assert.equal(stateExists, true);
});


test('bundle consent shows readable sizes, destination and model terms', () => {
  const { output, code, stateExists } = run('bundle-decline');
  assert.equal(code, 0);
  const screen = terminalScreen(output.slice(0, output.indexOf('Continue?') + 'Continue?'.length)).screen;
  assert.ok(screen.includes('Download: ~123.5 KB'));
  assert.ok(screen.includes('On disk: ~654.3 KB'));
  assert.ok(screen.includes('Apache License 2.0'));
  assert.ok(screen.includes('Details: licenses/'));
  assert.ok(screen.includes('EmbeddingGemma 2 by Google'));
  assert.ok(screen.includes('Files:'));
  assert.equal(stateExists, false);
});


test('Ctrl+C cancels bundle metadata loading before consent', () => {
  const { code, restored, stateExists } = run('bundle-metadata-cancel');
  assert.equal(code, 130);
  assert.equal(restored, true);
  assert.equal(stateExists, false);
});
