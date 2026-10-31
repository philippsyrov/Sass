import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

test('wizard runtime forwards hangup once and waits for the detached child to drain', {skip:process.platform==='win32',timeout:10000},async t=>{
 const work=await mkdtemp(join(tmpdir(),'sass-runtime-hangup-'));const audit=join(work,'audit');
 const child=spawn(process.execPath,['tests/fixtures/shutdown-runtime.mjs','parent',audit],{stdio:'ignore',env:{PATH:process.env.PATH,HOME:work}});
 const closed=once(child,'exit');
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await closed;}await rm(work,{recursive:true,force:true});});
 const deadline=Date.now()+5000;
 while(true){
  let lines=[];try{lines=(await readFile(audit,'utf8')).split('\n');}catch(error){if(error.code!=='ENOENT')throw error;}
  if(lines.includes('ready'))break;
  assert.ok(Date.now()<deadline,'synthetic runtime must become ready');await new Promise(resolve=>setTimeout(resolve,10));
 }
 child.kill('SIGHUP');child.kill('SIGTERM');
 assert.deepEqual(await closed,[0,null]);
 assert.deepEqual((await readFile(audit,'utf8')).trim().split('\n'),['ready','SIGHUP received — shutting down gracefully...','maintenance','memory','discord','embedder','database','exit:0','parent-exit:0']);
});
