import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable, Writable } from 'node:stream';
import { once } from 'node:events';
import { register } from 'tsx/esm/api';
register();
const {forwardWorkerOutput}=await import('../src/shared/workerOutput.ts');

test('closed diagnostic output drains workers without an unhandled EPIPE',async()=>{
 const output=new Writable({write(_chunk,_encoding,done){done(Object.assign(new Error('synthetic closed consumer'),{code:'EPIPE'}));}});
 const source=Readable.from(Array.from({length:100},()=>Buffer.alloc(128)));
 const ended=once(source,'end');forwardWorkerOutput(source,output);await ended;
 assert.equal(output.destroyed,true);
 const next=Readable.from(['later worker']);const nextEnded=once(next,'end');forwardWorkerOutput(next,output);await nextEnded;
});

test('slow diagnostic output applies backpressure instead of buffering the whole worker log',async()=>{
 let produced=0,finish;
 const source=Readable.from((function*(){for(let i=0;i<1000;i++){produced++;yield Buffer.alloc(65536);}})());
 const output=new Writable({highWaterMark:1,write(_chunk,_encoding,done){finish=done;}});
 forwardWorkerOutput(source,output);await new Promise(resolve=>setImmediate(resolve));
 assert.ok(produced<10,`unbounded production: ${produced}`);assert.equal(source.isPaused(),true);
 output.destroy(Object.assign(new Error('synthetic consumer closes'),{code:'EPIPE'}));
 const ended=once(source,'end');finish?.();await ended;
});


test('a consumer closing without an error also drains a paused worker',async()=>{
 const source=Readable.from(Array.from({length:100},()=>Buffer.alloc(65536)));
 const output=new Writable({highWaterMark:1,write(_chunk,_encoding,_done){}});
 forwardWorkerOutput(source,output);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(source.isPaused(),true);
 const ended=once(source,'end');output.destroy();await ended;
 assert.equal(source.readableEnded,true);
});
