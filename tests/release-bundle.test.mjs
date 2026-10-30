import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm, symlink, chmod, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inventory, verifyInventory, validateManifest, safePath, REQUIRED_LICENSES, MODEL_ID, MODEL_REVISION, NODE_VERSION, NODE_ARCHIVES } from '../scripts/validate-bundle.mjs';
import { buildRelease } from '../scripts/build-release.mjs';
const pin = JSON.parse(await readFile(new URL('../release/model-pin.json', import.meta.url), 'utf8'));
function sized(manifest) {
  manifest.payloadBytes = manifest.files.reduce((sum, file) => sum + (file.bytes || 0), 0);
  manifest.unpackedBytes = manifest.payloadBytes;
  while (manifest.unpackedBytes !== manifest.payloadBytes + Buffer.byteLength(JSON.stringify(manifest, null, 2) + '\n')) manifest.unpackedBytes = manifest.payloadBytes + Buffer.byteLength(JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
function fixture() {
  const target = 'darwin-arm64';
  const paths = ['package.json','LICENSE','dist/index.js','dist/setup.js','dist/doctor.js','dist/register-commands.js','dist/embeddings/localEmbedWorker.js','dist/embeddings/localEmbedLoader.js','scripts/sass.sh','scripts/validate-bundle.mjs','runtime/bin/node', ...REQUIRED_LICENSES.map((x) => `licenses/${x}`), ...['postgres','pg_ctl','initdb'].map((x) => `node_modules/@embedded-postgres/${target}/native/bin/${x}`),'assets/avatar.png','assets/banner.png','assets/emoji/test.png','node_modules/canvas/build/Release/canvas.node','node_modules/onnxruntime-node/bin/test.node'];
  const files = paths.map((path) => ({path,type:'file',bytes:1,sha256:'a'.repeat(64),executable:true}));
  for (const file of pin.files) files.push({path:`models/${MODEL_ID}/${MODEL_REVISION}/${file.path}`,type:'file',bytes:file.bytes,sha256:file.sha256,executable:false});
  return sized({schemaVersion:1,version:'1.0.2',platform:target,node:{version:NODE_VERSION,sourceUrl:`https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-${target}.tar.gz`,archiveSha256:NODE_ARCHIVES[target]},model:pin,payloadBytes:0,unpackedBytes:0,files});
}

test('manifest pins the exact platform, official Node and complete Gemma 2 q8 text model', () => {
  const manifest = fixture();
  assert.equal(validateManifest(manifest, 'darwin-arm64'), manifest);
  assert.throws(() => validateManifest(manifest, 'darwin-x64'), /platform/);
  manifest.model = {...manifest.model,dtype:'q4'};
  assert.throws(() => validateManifest(manifest, 'darwin-arm64'), /model/);
});
for (const path of ['runtime/bin/node', 'dist/setup.js', 'dist/embeddings/localEmbedLoader.js', 'licenses/NOTICE', `models/${MODEL_ID}/${MODEL_REVISION}/onnx/model_quantized.onnx_data`]) {
  test(`a missing required artifact cannot pass: ${path}`, () => {
    const manifest = fixture(); manifest.files = manifest.files.filter((file) => file.path !== path); sized(manifest);
    assert.throws(() => validateManifest(manifest, 'darwin-arm64'), /Missing|mismatch/);
  });
}

test('a changed model payload is rejected even if its local inventory agrees', () => {
  const manifest = fixture();
  const path = 'onnx/model_quantized.onnx_data';
  manifest.model = structuredClone(manifest.model);
  manifest.model.files.find((file) => file.path === path).sha256 = 'b'.repeat(64);
  manifest.files.find((file) => file.path.endsWith('/' + path)).sha256 = 'b'.repeat(64);
  sized(manifest);
  assert.throws(() => validateManifest(manifest, 'darwin-arm64'), /Approved model pin mismatch/);
});

test('path traversal and duplicate inventory records are rejected', () => {
  for (const path of ['../.env', '/tmp/private', 'a/../b', 'a\\b', './a', 'a//b']) assert.throws(() => safePath(path), /path/);
  const manifest = fixture(); manifest.files.push(manifest.files[0]); sized(manifest);
  assert.throws(() => validateManifest(manifest, 'darwin-arm64'), /Duplicate/);
});

test('synthetic inventory detects bytes, added files, permissions and external symlinks', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sass-bundle-test-')); t.after(() => rm(root, {recursive:true,force:true}));
  await writeFile(join(root,'launch'),'synthetic'); await chmod(join(root,'launch'),0o755);
  await symlink('launch',join(root,'link'));
  const files = await inventory(root); await verifyInventory(root, files);
  await chmod(join(root,'launch'),0o644); await assert.rejects(verifyInventory(root,files), /differ/); await chmod(join(root,'launch'),0o755);
  await writeFile(join(root,'launch'),'changed'); await assert.rejects(verifyInventory(root,files), /differ/); await writeFile(join(root,'launch'),'synthetic');
  await writeFile(join(root,'extra'),'private'); await assert.rejects(verifyInventory(root,files), /differ/); await rm(join(root,'extra'));
  await symlink('../outside',join(root,'escape')); await assert.rejects(inventory(root), /External symlink/);
});

test('builder rejects an unverified runtime before copying application data', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sass-build-test-')); t.after(() => rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'output')); await writeFile(join(root,'fake-node.tar.gz'),'synthetic');
  const config = join(root,'inputs.json');
  await writeFile(config,JSON.stringify({platform:`${process.platform}-${process.arch}`,nodeArchive:'fake-node.tar.gz',appDir:'does-not-exist'}));
  await assert.rejects(buildRelease(config,join(root,'output')), /checksum|target Mac architecture/);
});


test('bundles reject the first EmbeddingGemma generation', () => {
  const manifest = fixture();
  manifest.model = {...manifest.model,id:'onnx-community/embeddinggemma-300m-ONNX',revision:'5090578d9565bb06545b4552f76e6bc2c93e4a66',dtype:'fp32'};
  sized(manifest);
  assert.throws(() => validateManifest(manifest,'darwin-arm64'), /model.*pin/);
});

test('the approved release payload contains only Gemma 2 q8 text graphs', () => {
  assert.equal(pin.id,'onnx-community/embeddinggemma-2-ONNX');
  assert.equal(pin.dtype,'q8');
  assert.ok(pin.files.some((file) => file.path === 'onnx/model_quantized.onnx'));
  assert.ok(pin.files.some((file) => file.path === 'onnx/model_quantized.onnx_data'));
  const manifest = fixture();
  manifest.files.push({path:`models/${MODEL_ID}/${MODEL_REVISION}/onnx/vision_encoder_quantized.onnx`,type:'file',bytes:1,sha256:'a'.repeat(64),executable:false});
  sized(manifest);
  assert.throws(() => validateManifest(manifest,'darwin-arm64'), /Unapproved model file/);
});

test('removing a pinned tokenizer configuration from both inventories cannot pass', () => {
  const manifest = fixture();
  manifest.model = structuredClone(manifest.model);
  manifest.model.files = manifest.model.files.filter((file) => file.path !== 'tokenizer_config.json');
  manifest.files = manifest.files.filter((file) => !file.path.endsWith('/tokenizer_config.json'));
  sized(manifest);
  assert.throws(() => validateManifest(manifest,'darwin-arm64'), /pin|inventory/i);
});


test('duplicating one model pin cannot replace another required model pin', () => {
  const manifest = fixture();
  manifest.model = structuredClone(manifest.model);
  manifest.model.files[4] = {...manifest.model.files[0]};
  sized(manifest);
  assert.throws(() => validateManifest(manifest,'darwin-arm64'), /inventory/);
});
