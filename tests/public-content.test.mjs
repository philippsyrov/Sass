import test from 'node:test';
import assert from 'node:assert/strict';
import { scanText } from '../scripts/check-public-content.mjs';

const scan = (text, file = 'src/example.ts', denylist = []) => scanText(text, file, denylist);

test('detects home paths, personal emails and non-synthetic identifiers without returning values', () => {
  const sensitive = [
    ['/', 'Users', 'someone', 'project'].join('/'),
    ['C:', 'Users', 'someone', 'project'].join('\\'),
    ['/', 'home', 'someone'].join('/'),
    ['C:', 'Users', 'someone', 'project'].join('/'),
    ['person', 'private.test'].join('@'),
    ['374829', '561283', '746219'].join(''),
  ];
  const result = scan(sensitive.join('\n'));
  assert.deepEqual(result.map(({ category, line }) => [category, line]), [
    ['home path', 1], ['home path', 2], ['home path', 3], ['home path', 4], ['email', 5], ['numeric identifier', 6],
  ]);
  assert.ok(sensitive.every((value) => !JSON.stringify(result).includes(value)));
});

test('accepts documented synthetic identifiers, example email, GitHub noreply and API paths', () => {
  const examples = [
    '1'.repeat(18), '1234567890'.repeat(2), '9876543210'.repeat(2), '1' + '0'.repeat(16) + '12',
    ['sample', 'example.com'].join('@'), ['123+name', 'users.noreply.github.com'].join('@'),
    '/users/@me', 'abc' + '1234567890123456789' + 'def',
  ];
  assert.deepEqual(scan(examples.join('\n')), []);
});

test('allows copyright attribution only in legal notices', () => {
  const line = 'Copyright Example ' + ['author', 'supplier.test'].join('@');
  assert.deepEqual(scan(line, 'LICENSE'), []);
  assert.equal(scan(line, 'README.md')[0].category, 'email');
});

test('private denylist reports only the location and category', () => {
  const value = ['private', 'handle'].join('-');
  assert.deepEqual(scan(`safe\n${value}`, 'src/a.ts', [value]), [
    { category: 'private denylist', file: 'src/a.ts', line: 2 },
  ]);
});

test('command scans tracked files and private denylist without exposing matched values', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync, spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const dir = mkdtempSync(join(tmpdir(), 'public-content-'));
  const guard = fileURLToPath(new URL('../scripts/check-public-content.mjs', import.meta.url));
  const privateValue = ['private', 'fixture'].join('-');
  try {
    execFileSync('git', ['init', '-q', dir]);
    writeFileSync(join(dir, 'tracked.txt'), `first\n${privateValue}\n`);
    writeFileSync(join(dir, 'untracked.txt'), ['/', 'Users', 'private'].join('/'));
    execFileSync('git', ['add', 'tracked.txt'], { cwd: dir });
    mkdirSync(join(dir, '.git', 'info'), { recursive: true });
    writeFileSync(join(dir, '.git', 'info', 'public-content-denylist.json'), JSON.stringify([privateValue]));
    const result = spawnSync(process.execPath, [guard], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal((result.stderr.match(/private denylist: tracked\.txt:2/g) ?? []).length, 1);
    assert.ok(!result.stderr.includes(privateValue));
    assert.ok(!result.stderr.includes('untracked.txt'));
    // A clean unstaged edit must not hide the value already in the index.
    writeFileSync(join(dir, 'tracked.txt'), 'clean working copy\n');
    const staged = spawnSync(process.execPath, [guard], { cwd: dir, encoding: 'utf8' });
    assert.equal(staged.status, 1);
    assert.match(staged.stderr, /private denylist: tracked\.txt:2/);
    assert.ok(!staged.stderr.includes(privateValue));
    execFileSync('git', ['add', 'tracked.txt'], { cwd: dir });
    const clean = spawnSync(process.execPath, [guard], { cwd: dir, encoding: 'utf8' });
    assert.equal(clean.status, 0);

    // Tracked private paths fail by name, without scanning or printing content.
    const secret = ['person', 'private.test'].join('@');
    writeFileSync(join(dir, '.env'), secret);
    mkdirSync(join(dir, 'data'));
    writeFileSync(join(dir, 'data', 'private.txt'), secret);
    execFileSync('git', ['add', '-f', '.env', 'data/private.txt'], { cwd: dir });
    const privateFiles = spawnSync(process.execPath, [guard], { cwd: dir, encoding: 'utf8' });
    assert.equal(privateFiles.status, 1);
    assert.match(privateFiles.stderr, /tracked private path: \.env:1/);
    assert.match(privateFiles.stderr, /tracked private path: data\/private\.txt:1/);
    assert.ok(!privateFiles.stderr.includes(secret));
    assert.ok(!privateFiles.stderr.includes('email:'));

    writeFileSync(join(dir, '.git', 'info', 'public-content-denylist.json'), 'invalid');
    const invalid = spawnSync(process.execPath, [guard], { cwd: dir, encoding: 'utf8' });
    assert.equal(invalid.status, 1);
    assert.ok(!invalid.stderr.includes('invalid'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
