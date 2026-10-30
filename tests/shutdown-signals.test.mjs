import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'tsx/esm/api';
register();
const {registerShutdownSignals}=await import('../src/shared/shutdownSignals.ts');
const {forwardWorkerOutput}=await import('../src/shared/workerOutput.ts');
const {Readable, Writable}=await import('node:stream');

test('hangup releases worker output already paused on terminal backpressure', async () => {
  const output=new Writable({highWaterMark:1,write(_chunk,_encoding,_done){}});
  Object.defineProperty(output,'isTTY',{value:true});
  const source=Readable.from(Array.from({length:100},()=>Buffer.alloc(1024)));
  let remove;
  try {
    remove=registerShutdownSignals(()=>{},[output]);
    forwardWorkerOutput(source,output);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(source.isPaused(),true);
    process.emit('SIGHUP');
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(source.readableEnded,true,'hangup must drain an already-paused worker');
    const next=Readable.from(['later worker']);
    forwardWorkerOutput(next,output);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(next.readableEnded,true,'later workers must also drain');
  } finally {
    remove?.();
    source.destroy();output.destroy();
  }
});

test('hangup uses the original TTY state, discards writes and completes callbacks', async () => {
  const stream=new Writable({write(_chunk,_encoding,done){done();}}), write=stream.write;
  let remove;
  try {
    Object.defineProperty(stream,'isTTY',{value:true,configurable:true});
    const signals=[];
    remove=registerShutdownSignals(signal=>signals.push(signal),[stream]);
    Object.defineProperty(stream,'isTTY',{value:false,configurable:true});
    process.emit('SIGHUP');
    let completed=false;
    assert.equal(stream.write('synthetic discarded output',()=>{completed=true;}),true);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(completed,true);
    assert.deepEqual(signals,['SIGHUP']);
    assert.notEqual(stream.write,write);
  } finally {
    remove?.();stream.write=write;
    stream.destroy();
  }
});

test('non-TTY logs are preserved and signal subscriptions are removed', () => {
  const stream=new Writable({write(_chunk,_encoding,done){done();}}), write=stream.write;
  let remove;
  const before=process.listenerCount('SIGHUP');
  try {
    Object.defineProperty(stream,'isTTY',{value:false,configurable:true});
    const signals=[];remove=registerShutdownSignals(signal=>signals.push(signal),[stream]);
    process.emit('SIGHUP');
    assert.equal(stream.write,write);
    assert.deepEqual(signals,['SIGHUP']);
    assert.equal(process.listenerCount('SIGHUP'),before+1);
    remove();assert.equal(process.listenerCount('SIGHUP'),before);
  } finally {
    remove?.();stream.write=write;
    stream.destroy();
  }
});
