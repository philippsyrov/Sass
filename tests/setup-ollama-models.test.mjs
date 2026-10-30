import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const clientId = '123456789012345678';
const token = 'MTIzNDU2Nzg5MDEyMzQ1Njc4.fake-test.signature';

async function importDist(relativePath) {
  const distPath = relativePath.replace(/^\.\/src\//, './dist/').replace(/\.ts$/, '.js');
  return import(new URL(join(root, distPath), import.meta.url).href);
}

test('ollamaChatModels excludes embedding models', async () => {
  const { ollamaChatModels } = await importDist('./src/setup/ollamaModels.ts');
  const chat = ollamaChatModels(['qwen3.5:4b', 'nomic-embed-text', 'embeddinggemma:latest']);
  assert.deepEqual(chat, ['qwen3.5:4b']);
});

test('defaultOllamaChatModelIndex prefers installed env model', async () => {
  const { defaultOllamaChatModelIndex } = await importDist('./src/setup/ollamaModels.ts');
  const models = ['qwen3.5:4b', 'llama3.1:8b'];
  assert.equal(defaultOllamaChatModelIndex(models, 'qwen3.5:4b'), 0);
  assert.equal(defaultOllamaChatModelIndex(models, 'llama3.1:8b'), 1);
  assert.equal(defaultOllamaChatModelIndex(models, 'llama3.1:8b-not-installed'), 0);
});

test('installed chat models skip download prompt', { timeout: 60_000 }, async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'sass-ollama-setup-'));
  await mkdir(join(cwd, 'src'));
  await writeFile(join(cwd, 'src/index.ts'), '');
  await writeFile(join(cwd, 'package.json'), '{}');
  await writeFile(join(cwd, '.env.example'), await readFile(join(root, '.env.example')));
  await writeFile(join(cwd, 'Modelfile'), await readFile(join(root, 'Modelfile')));

  const piped = [
    clientId, token, '234567890123456789',
    'n', '8', '', '', 'n', 'n', 'n', 'y', 'n',
  ].join('\n');

  const child = spawn(process.execPath, [
    '--import', import.meta.resolve('tsx'),
    join(root, 'src/setup.ts'),
  ], {
    cwd,
    env: {
      PATH: process.env.PATH,
      SASS_SETUP_ADVANCED: '1', SASS_TEST_SKIP_EMBEDDED: '1',
      SASS_TEST_SKIP_LOCAL_BOOTSTRAP: '1',
      SASS_TEST_OLLAMA_MODELS: 'qwen3.5:4b,nomic-embed-text',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (c) => { output += c; });
  child.stderr.on('data', (c) => { output += c; });
  child.stdin.end(`${piped}\n`);
  const [code] = await once(child, 'close');
  t.after(() => rm(cwd, { recursive: true, force: true }));

  assert.equal(code, 0, output);
  assert.ok(!output.includes('Download chat model'), output);
  assert.ok(!output.includes('llama3.1:8b'), output);
  const written = await readFile(join(cwd, '.env'), 'utf8');
  assert.match(written, /OLLAMA_MODEL=qwen3\.5:4b/);
});

test('modelfile create uses chosen base when bundled FROM is missing', async () => {
  const { parseModelfileFrom, modelfileContentWithFrom } = await importDist('./src/setup/modelfile.ts');
  const from = parseModelfileFrom(root);
  assert.equal(from, 'llama3.1:8b');
  const adapted = modelfileContentWithFrom(root, 'qwen3.5:4b');
  assert.match(adapted, /^FROM qwen3\.5:4b/m);
  assert.match(adapted, /You are Sass/);
});
