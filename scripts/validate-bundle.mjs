import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile, readlink } from 'node:fs/promises';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MODEL_ID = 'onnx-community/embeddinggemma-2-ONNX';
export const MODEL_REVISION = 'daa72c51243991dfcaf9f9137d2c573d8f7790c0';
export const NODE_VERSION = 'v24.22.2';
export const NODE_ARCHIVES = {
  'darwin-arm64': 'aa9549349e47dffaa42dcf95d6e06ade8c4bdafc980979883b88767670df385a',
  'darwin-x64': 'd5e336d588c45be0c37dbd52cc29895593009ca4997a77a1fd02815131ed0e52',
};
export const REQUIRED_LICENSES = ['NODE-LICENSE', 'APACHE-2.0.txt', 'MODEL-TERMS.txt', 'NOTICE', 'THIRD-PARTY-NOTICES.txt'];
export function safePath(path) {
  if (typeof path !== 'string' || !path || path.includes('\\') || path.includes('\0') || isAbsolute(path) || path.split('/').some((part) => part === '..' || part === '.' || part === '')) throw new Error('Invalid bundle path');
  return path;
}
export async function sha256(path) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}
export async function inventory(root, prefix = '') {
  const entries = [];
  for (const name of (await readdir(resolve(root, prefix))).sort()) {
    const path = prefix ? `${prefix}/${name}` : name;
    safePath(path);
    if (path === 'bundle-manifest.json') continue;
    const absolute = resolve(root, path);
    const stat = await lstat(absolute);
    if (stat.isDirectory()) entries.push(...await inventory(root, path));
    else if (stat.isSymbolicLink()) {
      const target = await readlink(absolute);
      const destination = relative(root, resolve(dirname(absolute), target));
      if (isAbsolute(target) || destination === '..' || destination.startsWith('../')) throw new Error(`External symlink: ${path}`);
      entries.push({ path, type: 'symlink', target });
    } else if (stat.isFile()) entries.push({ path, type: 'file', bytes: stat.size, sha256: await sha256(absolute), executable: Boolean(stat.mode & 0o111) });
    else throw new Error(`Unsupported bundle entry: ${path}`);
  }
  return entries;
}
export function validateManifest(manifest, target = `${process.platform}-${process.arch}`) {
  if (manifest.schemaVersion !== 1 || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(manifest.version)) throw new Error('Unsupported bundle manifest');
  if (!['darwin-arm64', 'darwin-x64'].includes(manifest.platform) || manifest.platform !== target) throw new Error('Bundle platform does not match this computer');
  if (manifest.minimumMacOS !== '15.0') throw new Error('Bundle macOS requirement is missing or unsupported');
  if (manifest.node?.version !== NODE_VERSION || manifest.node?.archiveSha256 !== NODE_ARCHIVES[target] || manifest.node?.sourceUrl !== `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-${target}.tar.gz`) throw new Error('Node provenance does not match the official runtime pin');
  if (manifest.model?.id !== MODEL_ID || manifest.model?.revision !== MODEL_REVISION || manifest.model?.dtype !== 'q8' || manifest.model?.dimension !== 768) throw new Error('Bundle model does not match the approved pin');
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error('Bundle file inventory is empty');
  const paths = new Map();
  let total = 0;
  for (const file of manifest.files) {
    safePath(file.path);
    if (paths.has(file.path)) throw new Error('Duplicate bundle file');
    if (file.type === 'file') {
      if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256) || typeof file.executable !== 'boolean') throw new Error('Invalid bundle file checksum');
      total += file.bytes;
    } else if (file.type !== 'symlink' || typeof file.target !== 'string') throw new Error('Invalid bundle file type');
    paths.set(file.path, file);
  }
  if (total !== manifest.payloadBytes || !Number.isSafeInteger(manifest.unpackedBytes) || manifest.unpackedBytes !== total + Buffer.byteLength(JSON.stringify(manifest, null, 2) + '\n')) throw new Error('Bundle size does not match inventory');
  const required = ['package.json', 'LICENSE', 'dist/index.js', 'dist/setup.js', 'dist/doctor.js', 'dist/register-commands.js', 'dist/embeddings/localEmbedWorker.js', 'dist/embeddings/localEmbedLoader.js', 'scripts/sass.sh', 'scripts/validate-bundle.mjs', 'runtime/bin/node', ...REQUIRED_LICENSES.map((file) => `licenses/${file}`)];
  for (const path of required) if (paths.get(path)?.type !== 'file' || paths.get(path).bytes === 0) throw new Error(`Missing required bundle file: ${path}`);
  for (const name of ['postgres', 'pg_ctl', 'initdb']) {
    if (!paths.get(`node_modules/@embedded-postgres/${manifest.platform}/native/bin/${name}`)?.executable) throw new Error(`Missing executable database binary: ${name}`);
  }
  if (!paths.get('runtime/bin/node').executable || !paths.get('scripts/sass.sh').executable) throw new Error('Bundle launchers must be executable');
  if (![...paths.keys()].some((path) => path.startsWith('assets/emoji/')) || !paths.has('assets/avatar.png') || !paths.has('assets/banner.png')) throw new Error('Standard artwork is missing');
  if (![...paths.keys()].some((path) => path.startsWith('node_modules/canvas/') && path.endsWith('.node'))) throw new Error('canvas native addon is missing');
  if (![...paths.keys()].some((path) => path.startsWith('node_modules/onnxruntime-node/') && path.endsWith('.node'))) throw new Error('ONNX native addon is missing');
  const modelPrefix = `models/${MODEL_ID}/${MODEL_REVISION}/`;
  if (!Array.isArray(manifest.model.files) || manifest.model.files.length !== 5 || new Set(manifest.model.files.map((file) => file.path)).size !== 5) throw new Error('Pinned model file inventory is missing');
  for (const file of manifest.model.files) {
    const record = paths.get(modelPrefix + safePath(file.path));
    if (!record || record.type !== 'file' || record.bytes !== file.bytes || record.sha256 !== file.sha256) throw new Error(`Pinned model file mismatch: ${file.path}`);
  }
  const criticalModelFiles = {
    'config.json': [5031, '8d011bfe08b5e345bbe0b81e5c6fd02c381920b345b986047bc2a33ce7b90d1d'],
    'onnx/model_quantized.onnx': [495165, 'd06edd601f851c633a2519304cbeb8dc6170d7ceb61b436625c17fb9b6e74953'],
    'onnx/model_quantized.onnx_data': [313724928, '278a7ff1248c3618e4bd11a607fc54f7bdc7778854230f3956d3f86bd9db4f3b'],
    'tokenizer.json': [32170510, '4d777ef5bdc1aa36227abdfb77c3e49e7b9c892d16e1b6bda41c393504828be4'],
    'tokenizer_config.json': [1599, '17bd5d6e9364ca49a534e1502076593317c298d4a663623091ed45388f004874'],
  };
  for (const [path, [bytes, checksum]] of Object.entries(criticalModelFiles)) {
    const record = paths.get(modelPrefix + path);
    if (record?.bytes !== bytes || record?.sha256 !== checksum) throw new Error(`Approved model pin mismatch: ${path}`);
  }
  for (const path of paths.keys()) {
    if (path.startsWith('models/') && (!path.startsWith(modelPrefix) || !Object.hasOwn(criticalModelFiles, path.slice(modelPrefix.length)))) throw new Error(`Unapproved model file: ${path}`);
    if (/^(?:\.env(?:\.|$)|\.git(?:\/|$)|src\/|data\/|\.sass-data\/)/.test(path)) throw new Error('Private or source data in bundle');
  }
  return manifest;
}
export async function validateBundle(root, target) {
  const manifest = validateManifest(JSON.parse(await readFile(resolve(root, 'bundle-manifest.json'), 'utf8')), target);
  await verifyInventory(root, manifest.files);
  return manifest;
}
export async function verifyInventory(root, files) {
  const actual = await inventory(resolve(root));
  const expected = new Map(files.map((file) => [file.path, file]));
  if (actual.length !== expected.size || actual.some((file) => JSON.stringify(file) !== JSON.stringify(expected.get(file.path)))) throw new Error('Bundle files differ from verified manifest');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const manifest = await validateBundle(resolve(process.argv[2] || '.'));
    console.log(`Verified Sass ${manifest.version} (${manifest.platform}, ${manifest.unpackedBytes} bytes)`);
  } catch (error) { console.error(`Bundle validation failed: ${error.message}`); process.exitCode = 1; }
}
