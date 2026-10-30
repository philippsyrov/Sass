import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { register } from 'tsx/esm/api';
register();
const { resolveLocalModelCache } = await import('../src/embeddings/localEmbedCache.ts');
const { LOCAL_EMBED_PRIMARY, LOCAL_EMBED_REVISION, LOCAL_EMBED_FALLBACK } = await import('../src/embeddings/localEmbedConfig.ts');
async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'sass-cache-choice-'));
  t.after(() => rm(base, { recursive:true, force:true }));
  const app = join(base,'app'); const home = join(base,'home');
  await mkdir(app); await mkdir(home);
  const model = async (cache,id,revision) => {
    const path = join(cache,id,...(revision ? [revision] : []));
    await mkdir(path,{recursive:true}); await writeFile(join(path,'config.json'),'{}');
  };
  return { app,home,model,bundle:join(app,'models'),legacy:join(home,'.sass/models'),resolve:(config={},id=LOCAL_EMBED_PRIMARY,revision=id===LOCAL_EMBED_PRIMARY?LOCAL_EMBED_REVISION:undefined)=>resolveLocalModelCache(config,id,revision,app,home) };
}

test('new bundle uses the included exact model revision', async (t) => {
  const f=await fixture(t); await writeFile(join(f.app,'bundle-manifest.json'),'{}');
  await f.model(f.bundle,LOCAL_EMBED_PRIMARY,LOCAL_EMBED_REVISION);
  assert.equal(f.resolve(),f.bundle);
});
test('an explicit cache path always wins over bundled defaults', async (t) => {
  const f=await fixture(t); await writeFile(join(f.app,'bundle-manifest.json'),'{}');
  assert.equal(f.resolve({SASS_EMBED_CACHE_DIR:'/synthetic/custom-cache'}),'/synthetic/custom-cache');
});
test('an existing selected MiniLM cache remains usable after a bundle update', async (t) => {
  const f=await fixture(t); await writeFile(join(f.app,'bundle-manifest.json'),'{}');
  await f.model(f.bundle,LOCAL_EMBED_PRIMARY,LOCAL_EMBED_REVISION);
  await f.model(f.legacy,LOCAL_EMBED_FALLBACK);
  assert.equal(f.resolve({},LOCAL_EMBED_FALLBACK,undefined),f.legacy);
});
test('source installs keep the existing home or SASS_HOME cache default', async (t) => {
  const f=await fixture(t);
  assert.equal(f.resolve(),f.legacy);
  assert.equal(f.resolve({SASS_HOME:join(f.home,'custom')}),join(f.home,'custom/models'));
});
test('a missing selected model keeps its ID and gives the bundle loader a missing path', async (t) => {
  const f=await fixture(t); await writeFile(join(f.app,'bundle-manifest.json'),'{}');
  assert.equal(f.resolve({},'synthetic/missing',undefined),f.bundle);
});

test('an explicit first-generation model can still use its old unversioned home cache', async (t) => {
  const { resolveLocalModelLocation } = await import('../src/embeddings/localEmbedCache.ts');
  const f = await fixture(t);
  await writeFile(join(f.app,'bundle-manifest.json'),'{}');
  const legacyModel = 'onnx-community/embeddinggemma-300m-ONNX';
  await f.model(f.legacy,legacyModel);
  assert.deepEqual(resolveLocalModelLocation({},legacyModel,'5090578d9565bb06545b4552f76e6bc2c93e4a66',f.app,f.home),{cacheDir:f.legacy,revision:undefined});
  assert.deepEqual(resolveLocalModelLocation({LOCAL_EMBED_REVISION:'5090578d9565bb06545b4552f76e6bc2c93e4a66'},legacyModel,'5090578d9565bb06545b4552f76e6bc2c93e4a66',f.app,f.home),{cacheDir:f.bundle,revision:'5090578d9565bb06545b4552f76e6bc2c93e4a66'});
});
