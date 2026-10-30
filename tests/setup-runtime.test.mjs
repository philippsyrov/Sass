import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function run(mode) {
  const child = spawnSync('python3', ['tests/fixtures/setup-runtime-pty.py', mode], {
    env: { ...process.env, SASS_TEST_NODE: process.execPath }, encoding: 'utf8', timeout: 12_000,
  });
  assert.equal(child.status, 0, child.stderr || child.error?.message);
  return JSON.parse(child.stdout);
}

test('setup waits for runtime shutdown after repeated terminal signals', { skip: process.platform === 'win32' }, () => {
  const result = run('interrupt');
  assert.equal(result.started, true);
  assert.equal(result.shutdownBeforeParentExit, true);
  assert.equal(result.markers['CHILD_STOP_BEGIN:SIGINT'], 1);
  assert.equal(result.markers['CHILD_STOP_BEGIN:SIGTERM'], 0);
  assert.equal(result.markers['Setup cancelled.'], 0);
  assert.equal(result.markers['ollama rm'], 0);
  assert.equal(result.markers['PARENT_EXIT:0'], 1);
  assert.equal(result.runtimeTerminalRestored, true);
  assert.equal(result.terminalRestored, true);
});

test('setup preserves the runtime exit status', { skip: process.platform === 'win32' }, () => {
  const result = run('normal');
  assert.equal(result.markers['CHILD_NORMAL_DONE'], 1);
  assert.equal(result.markers['PARENT_EXIT:7'], 1);
  assert.equal(result.markers['Setup cancelled.'], 0);
  assert.equal(result.terminalRestored, true);
});

test('setup forwards SIGTERM once and waits through a repeated SIGTERM', { skip: process.platform === 'win32' }, () => {
  const result = run('terminate');
  assert.equal(result.shutdownBeforeParentExit, true);
  assert.equal(result.markers['CHILD_STOP_BEGIN:SIGTERM'], 1);
  assert.equal(result.markers['CHILD_STOP_BEGIN:SIGINT'], 0);
  assert.equal(result.markers['PARENT_EXIT:0'], 1);
  assert.equal(result.markers['Setup cancelled.'], 0);
  assert.equal(result.markers['ollama rm'], 0);
  assert.equal(result.terminalRestored, true);
});

test('setup cancellation before runtime starts keeps its own message without Ollama advice', { skip: process.platform === 'win32' }, () => {
  const result = run('setup-cancel');
  assert.equal(result.started, false);
  assert.equal(result.markers['Setup cancelled.'], 1);
  assert.equal(result.markers['ollama rm'], 0);
  assert.equal(result.markers['PARENT_EXIT:130'], 1);
  assert.equal(result.terminalRestored, true);
});
