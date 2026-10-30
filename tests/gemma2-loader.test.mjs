import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'tsx/esm/api';
register();
const config = await import('../src/embeddings/localEmbedConfig.ts');

test('new local memory selects Gemma 2 while existing explicit models stay distinct', () => {
  assert.equal(config.LOCAL_EMBED_PRIMARY, 'onnx-community/embeddinggemma-2-ONNX');
  assert.equal(config.LOCAL_EMBED_REVISION, 'daa72c51243991dfcaf9f9137d2c573d8f7790c0');
});

test('Gemma 2 loads only text q8 and uses the projected sentence vector with retrieval prefixes', async () => {
  const { loadLocalExtractor } = await import('../src/embeddings/localEmbedLoader.ts');
  const calls = [];
  const upstream = { model_type:'embedding_gemma2', vision_config:{}, audio_config:{}, text_config:{embedding_dim:768} };
  const vector = Float32Array.from({length:768}, (_,i) => i === 0 ? 1 : 0);
  const model = Object.assign(async (inputs) => {
    calls.push(['infer',inputs]);
    return { sentence_embedding:{data:vector}, last_hidden_state:{data:new Float32Array(512)} };
  }, { dispose:async () => calls.push(['dispose']) });
  const ports = {
    config:async (source,options) => { calls.push(['config',source,options]); return upstream; },
    tokenizer:async (source,options) => { calls.push(['tokenizer',source,options]); return (text,options) => ({text,options}); },
    model:async (source,options) => { calls.push(['model',source,options]); return model; },
    pipeline:async () => { throw new Error('Gemma 2 must use its projected sentence output'); },
  };
  const extract = await loadLocalExtractor(config.LOCAL_EMBED_PRIMARY,'/synthetic/exact-revision',{revision:config.LOCAL_EMBED_REVISION,local_files_only:true},ports);
  assert.equal(calls.find(([kind]) => kind === 'model')[2].config.vision_config,null);
  assert.equal(calls.find(([kind]) => kind === 'model')[2].config.audio_config,null);
  assert.equal(calls.find(([kind]) => kind === 'model')[2].dtype,'q8');
  assert.equal(calls.find(([kind]) => kind === 'model')[2].local_files_only,true);
  assert.equal((await extract('cats','query')).data.length,768);
  await extract('cats','document');
  assert.deepEqual(calls.filter(([kind]) => kind === 'infer').map(([,inputs]) => inputs),[
    {text:'task: search result | query: cats',options:{padding:true,truncation:true,max_length:8192}},
    {text:'title: none | text: cats',options:{padding:true,truncation:true,max_length:8192}},
  ]);
  await extract.dispose();
  assert.equal(calls.at(-1)[0],'dispose');
});

test('explicit Gemma 1 and MiniLM retain old unprefixed pipeline inputs', async () => {
  const { loadLocalExtractor } = await import('../src/embeddings/localEmbedLoader.ts');
  for (const [id,dtype] of [['onnx-community/embeddinggemma-300m-ONNX','fp32'],['Xenova/all-MiniLM-L6-v2',undefined]]) {
    const ports = { pipeline:async (_task,_source,options) => {
      assert.equal(options.dtype,dtype);
      return Object.assign(async (text,settings) => ({data:[text,settings.pooling,settings.normalize]}),{dispose:async()=>{}});
    } };
    const extract = await loadLocalExtractor(id,'/synthetic/old-cache',{local_files_only:true},ports);
    assert.deepEqual((await extract('cats','query')).data,['cats','mean',true]);
  }
});

test('fingerprint separates Gemma 2 preprocessing, revision and legacy model vectors', () => {
  assert.equal(typeof config.localEmbeddingFingerprint,'function');
  const primary = config.localEmbeddingFingerprint({});
  assert.match(primary,/q8.*768.*search-document-v1/);
  assert.notEqual(primary,config.localEmbeddingFingerprint({LOCAL_EMBED_REVISION:'other-revision'}));
  assert.equal(config.localEmbeddingFingerprint({LOCAL_EMBED_MODEL:'Xenova/all-MiniLM-L6-v2'}),'Xenova/all-MiniLM-L6-v2');
  assert.equal(config.localEmbeddingFingerprint({LOCAL_EMBED_MODEL:'onnx-community/embeddinggemma-300m-ONNX'}),'onnx-community/embeddinggemma-300m-ONNX');
});

test('Gemma 2 rejects raw hidden states, wrong dimensions and non-finite projected output', async () => {
  const { loadLocalExtractor } = await import('../src/embeddings/localEmbedLoader.ts');
  for (const output of [
    {last_hidden_state:{data:new Float32Array(512)}},
    {sentence_embedding:{data:new Float32Array(512)}},
    {sentence_embedding:{data:Float32Array.from({length:768},()=>NaN)}},
  ]) {
    const ports = {
      config:async()=>({vision_config:{},audio_config:{}}),
      tokenizer:async()=>()=>({}),
      model:async()=>Object.assign(async()=>output,{dispose:async()=>{}}),
    };
    const extract = await loadLocalExtractor(config.LOCAL_EMBED_PRIMARY,'/synthetic/exact-revision',{local_files_only:true},ports);
    await assert.rejects(extract('cats'),/sentence embedding|dimension|non-finite/);
  }
});
