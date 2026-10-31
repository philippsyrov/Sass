import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('private runtime version check supports a home directory containing spaces', () => {
  const source=readFileSync(new URL('../install.sh',import.meta.url),'utf8');
  const command=/Node \$\(([^\n]+?) -v\) from ~\/\.sass\/node/.exec(source)?.[1];
  assert.ok(command,'installer must identify the private runtime');
  const work=mkdtempSync(join(tmpdir(),'sass-runtime-path-'));
  try {
    const home=join(work,'home with spaces');
    const bin=join(home,'node/current/bin');
    mkdirSync(bin,{recursive:true});
    writeFileSync(join(bin,'node'),'#!/bin/sh\nprintf "v24.0.0\\n"\n',{mode:0o755});
    const result=spawnSync('/bin/bash',['-c',`SASS_HOME="$1"; ${command} -v`,'bash',home],{encoding:'utf8',timeout:5000});
    assert.equal(result.status,0,result.stderr);
    assert.equal(result.stdout.trim(),'v24.0.0');
  } finally {
    rmSync(work,{recursive:true,force:true});
  }
});
