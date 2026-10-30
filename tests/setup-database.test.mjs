import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));

async function importTs(relativePath) {
  const distPath = relativePath.replace(/^\.\/src\//, './dist/').replace(/\.ts$/, '.js');
  const distUrl = pathToFileURL(join(root, distPath)).href;
  try {
    return await import(distUrl);
  } catch {
    const { register } = await import('tsx/esm/api');
    register();
    return import(pathToFileURL(join(root, relativePath)).href);
  }
}

test('embedded choice sets SASS_EMBEDDED_PG and clears DATABASE_URL', async () => {
  const { applyEmbeddedDatabase, applyHostedDatabase, applySkipDatabase, describeDatabaseSummary } = await importTs('./src/setup/databaseStep.ts');
  const values = { DATABASE_URL: 'postgres://old', SASS_EMBEDDED_PG: '0' };
  applyEmbeddedDatabase(values);
  assert.equal(values.SASS_EMBEDDED_PG, '1');
  assert.equal(values.DATABASE_URL, '');
  assert.match(describeDatabaseSummary(values), /local embedded/);

  applyHostedDatabase(values, 'postgres://host/db');
  assert.equal(values.SASS_EMBEDDED_PG, '');
  assert.equal(values.DATABASE_URL, 'postgres://host/db');

  applySkipDatabase(values);
  assert.equal(values.DATABASE_URL, '');
});

test('skip warning lists memory features', async () => {
  const { SKIP_DATABASE_LINES } = await importTs('./src/setup/databaseStep.ts');
  const text = SKIP_DATABASE_LINES.join('\n');
  assert.match(text, /forgetme/i);
  assert.match(text, /affinity/i);
  assert.match(text, /dreaming/i);
});

test('provisionExternalPostgres uses injected docker success without running docker', async () => {
  const { provisionExternalPostgres } = await importTs('./src/setup/externalPostgres.ts');
  const result = await provisionExternalPostgres({
    docker: async () => ({
      ok: true,
      databaseUrl: 'postgres://sass:pw@127.0.0.1:5432/sass',
      detail: 'mock docker',
    }),
    native: async () => ({ ok: false, detail: 'skipped', installHint: 'hint' }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.databaseUrl.includes('127.0.0.1'), true);
});
