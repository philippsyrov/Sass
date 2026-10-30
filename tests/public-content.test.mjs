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
    assert.equal((result.stderr.match(/private denylist: \[tracked path #\d+\]:2/g) ?? []).length, 1);
    assert.ok(!result.stderr.includes(privateValue));
    assert.ok(!result.stderr.includes('untracked.txt'));
    // A clean unstaged edit must not hide the value already in the index.
    writeFileSync(join(dir, 'tracked.txt'), 'clean working copy\n');
    const staged = spawnSync(process.execPath, [guard], { cwd: dir, encoding: 'utf8' });
    assert.equal(staged.status, 1);
    assert.match(staged.stderr, /private denylist: \[tracked path #\d+\]:2/);
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
    assert.match(privateFiles.stderr, /tracked private path: \[tracked path #\d+\]:1/);
    assert.match(privateFiles.stderr, /tracked private path: \[tracked path #\d+\]:1/);
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

test('denylist matching ignores case and Unicode normalization', () => {
  const result = scan('SAMPLE CAFE\u0301 HANDLE', 'README.md', ['sample café handle']);
  assert.deepEqual(result, [{ category: 'private denylist', file: 'README.md', line: 1 }]);
});

test('flags personal decision narratives and private model plans in documentation', () => {
  for (const line of [
    'The owner decided to keep a personal backlog of ideas.',
    'The user requested that this decision be recorded for their application.',
    'Private training plan: fine-tune a model on personal examples.',
    'Our internal research notes describe the fine-tuning roadmap.',
  ]) {
    assert.ok(scan(line, 'docs/example.md').some(({ category }) => category === 'internal planning'), line);
  }
});

test('allows neutral product decisions, configuration and actual privacy disclosures', () => {
  for (const line of [
    'Decision: Store guild-scoped memories in PostgreSQL.',
    'Set CREATOR_ID to the administrator’s Discord user ID.',
    'Interaction logs retain message content until deleted.',
    'The model provider receives the prompt to generate a reply.',
    'Fine-tuning support is not included.',
  ]) assert.deepEqual(scan(line, 'docs/DECISIONS.md'), [], line);
  assert.deepEqual(scan('Copyright 2025 Example Author', 'LICENSE'), []);
});

test('rejects tracked internal notes and private chat assets by path', async () => {
  const { privatePath } = await import('../scripts/check-public-content.mjs');
  for (const file of [
    'docs/superpowers/plans/example.md', '.claude/handoff-2025.md',
    'reviews/example.md', 'docs/reviews/example.md', 'BACKLOG.md',
    'docs/research-notes.md', 'docs/research/note.md', 'docs/review-notes.md',
    'docs/LOCAL_ACCEPTANCE_ISSUES.md',
    'assets/screenshots/chat.png',
  ]) assert.equal(privatePath(file), true, file);
  for (const file of ['docs/DECISIONS.md', 'docs/PRIVACY.md', 'src/creator.ts', 'LICENSE']) {
    assert.equal(privatePath(file), false, file);
  }
});

test('scans tracked filenames without printing their private values', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync, spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const dir = mkdtempSync(join(tmpdir(), 'filename-guard-'));
  const guard = fileURLToPath(new URL('../scripts/check-public-content.mjs', import.meta.url));
  const privateValue = 'SyntheticCafé';
  const names = ['syntheticcafe\u0301.md', ['person', 'private.test.md'].join('@'), ['374829', '561283', '746219.md'].join(''), ['３７４８２９', '５６１２８３', '７４６２１９.md'].join('')];
  try {
    execFileSync('git', ['init', '-q', dir]);
    mkdirSync(join(dir, 'dir', 'HOME', 'someone'), { recursive: true });
    mkdirSync(join(dir, '.git', 'info'), { recursive: true });
    const pathName = join('dir', 'HOME', 'someone', 'notes.md');
    for (const name of [...names, pathName]) writeFileSync(join(dir, name), 'content\n');
    execFileSync('git', ['add', '--', ...names, pathName], { cwd: dir });
    writeFileSync(join(dir, '.git', 'info', 'public-content-denylist.json'), JSON.stringify([privateValue]));
    const result = spawnSync(process.execPath, [guard], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /private denylist: \[tracked path #\d+\]:1/);
    assert.match(result.stderr, /email: \[tracked path #\d+\]:1/);
    assert.equal((result.stderr.match(/numeric identifier: \[tracked path #\d+\]:1/g) ?? []).length, 2);
    assert.match(result.stderr, /home path: \[tracked path #\d+\]:1/);
    for (const name of [...names, pathName, privateValue]) assert.ok(!result.stderr.includes(name));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('allows user deletion requests while flagging attributed product decisions', () => {
  assert.deepEqual(scan('/forgetme: the user requested deletion of stored data.', 'docs/PRIVACY.md'), []);
  assert.ok(scan('The user requested that the product decision be recorded.', 'docs/example.md')
    .some(({ category }) => category === 'internal planning'));
});

test('flags private planning in source comments and multiline documentation', () => {
  assert.ok(scan('// Private training plan: use a personal dataset.', 'src/example.ts')
    .some(({ category }) => category === 'internal planning'));
  assert.ok(scan('The owner\ndecided to change the product direction.', 'docs/example.md')
    .some(({ category }) => category === 'internal planning'));
  assert.deepEqual(scan("const message = 'The owner decided';", 'src/example.ts'), []);
});

test('guard and synthetic test fixtures pass their own text checks', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const [path, file] of [
    ['../scripts/check-public-content.mjs', 'scripts/check-public-content.mjs'],
    ['./public-content.test.mjs', 'tests/public-content.test.mjs'],
  ]) {
    const content = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.deepEqual(scan(content, file), [], `${file} contains a guard finding`);
  }
});
