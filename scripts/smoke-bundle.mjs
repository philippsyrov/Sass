import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { validateBundle } from './validate-bundle.mjs';

const root = resolve(process.argv[2] || '.');
const manifest = await validateBundle(root);
const node = join(root, 'runtime/bin/node');
const runtime = spawnSync(node, ['-p', 'JSON.stringify({version:process.version,platform:process.platform,arch:process.arch})'], { encoding: 'utf8' });
if (runtime.status !== 0 || JSON.parse(runtime.stdout).version !== manifest.node.version) throw new Error('Private Node version mismatch');
for (const command of ['postgres', 'pg_ctl', 'initdb']) {
  const result = spawnSync(join(root, 'node_modules/@embedded-postgres', manifest.platform, 'native/bin', command), ['--version'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Embedded database binary failed: ${command}`);
}
// Importing canvas here would bypass the bundle's dependency resolution.
const canvasUrl = pathToFileURL(join(root, 'node_modules/canvas/index.js')).href;
const embedUrl = pathToFileURL(join(root, 'dist/embeddings/localEmbed.js')).href;
const script = `
import assert from 'node:assert/strict';
const { createCanvas } = await import(${JSON.stringify(canvasUrl)});
assert.ok(createCanvas(2, 2).toBuffer('image/png').length > 0);
const memory = await import(${JSON.stringify(embedUrl)});
const config = ${JSON.stringify({ SASS_EMBED_CACHE_DIR: join(root, 'models'), LOCAL_EMBED_MODEL: manifest.model.id, LOCAL_EMBED_REVISION: manifest.model.revision, EMBEDDING_DIMENSION: String(manifest.model.dimension) })};
try {
  await memory.ensureLocalEmbedder(undefined, config);
  const texts = ['where does the cat sleep?', 'the cat sleeps on a soft blanket', 'database transaction rollback'];
  const vectors = [];
  for (const [i, text] of texts.entries()) vectors.push(await memory.embedLocally(text, i === 0 ? 'query' : 'document'));
  for (const vector of vectors) assert.ok(vector.length === 768 && vector.every(Number.isFinite));
  const score = (a,b) => a.reduce((sum,x,i) => sum+x*b[i],0);
  assert.ok(score(vectors[0], vectors[1]) > score(vectors[0], vectors[2]));
} finally { await memory.closeLocalEmbedder(); }
`;
const smoke = spawnSync(node, ['--input-type=module', '-e', script], { cwd: root, encoding: 'utf8', timeout: 120_000, env: { HOME: process.env.HOME, PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' } });
if (smoke.status !== 0 || smoke.error || /GNotificationCenterDelegate|Class .*implemented in both/.test(smoke.stderr || '')) throw new Error(`Native and offline memory checks failed: ${smoke.error?.message || smoke.stderr || smoke.stdout}`);
const terms = await readFile(join(root, 'licenses/MODEL-TERMS.txt'), 'utf8');
if (!terms.includes('EmbeddingGemma 2') || !terms.includes('Apache') || !terms.includes('APACHE-2.0.txt')) throw new Error('Model license notice is incomplete');
console.log('Private runtime, database binaries, canvas and offline local memory passed.');
