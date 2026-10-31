import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const disposableMac = process.platform === 'darwin'
  && process.env.GITHUB_ACTIONS === 'true'
  && process.env.RUNNER_ENVIRONMENT === 'github-hosted'
  && process.env.SASS_DISPOSABLE_MAC_RUNNER === '1';

test('closing a real terminal drains runtime resources before exit', { skip: !disposableMac }, () => {
  const result=spawnSync('python3',['tests/fixtures/terminal-close.py',process.execPath],{
    encoding:'utf8',timeout:25000,
  });
  assert.equal(result.status,0,result.stderr || result.error?.message);
  assert.deepEqual(JSON.parse(result.stdout),{exit:0,orderedShutdown:true});
});
