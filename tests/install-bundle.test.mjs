import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
test('bundle prerequisite rejects unsupported or unreadable macOS before fetching release data', () => {
  for (const [version, supported] of [['14.7.2', false], ['15.0', true], ['15.6.1', true], ['27.0', true], ['unknown', false], ['', false]]) {
    const result = spawnSync('/bin/bash', ['-c',
      'set -e; die(){ echo "$*" >&2; exit 1; }; source "$1"; test_version="$2"; sw_vers(){ printf "%s" "$test_version"; }; sass_bundle_check_macos',
      'test', join(root, 'scripts/install-bundle.sh'), version], {encoding:'utf8'});
    assert.equal(result.status, supported ? 0 : 1, `${version}: ${result.stderr}`);
    if (!supported) assert.match(result.stderr, /requires macOS 15 or newer/);
  }
});

function fixture({ corrupt = false, unsafe = false, validateFails = false, extraMember, collision = false } = {}) {
  const work = mkdtempSync(join(tmpdir(), 'sass-bundle-'));
  const bin = join(work, 'bin');
  const tree = join(work, 'tree');
  mkdirSync(bin); mkdirSync(tree);
  for (const dir of ['runtime/bin', 'dist', 'scripts', 'models', 'licenses', 'node_modules', 'assets']) mkdirSync(join(tree, dir), { recursive: true });
  for (const file of ['package.json', 'LICENSE', 'bundle-manifest.json', 'dist/setup.js', 'dist/index.js', 'scripts/validate-bundle.mjs', 'scripts/sass.sh']) writeFileSync(join(tree, file), '{}');
  writeFileSync(join(tree, 'runtime/bin/node'), `#!/bin/sh\ncase "$1" in -e) exec "$SASS_TEST_NODE" "$@";; *validate-bundle.mjs) exit ${validateFails ? 9 : 0};; dist/setup.js) echo SETUP >>"$SASS_TEST_RUNTIME_RECORD"; exit "$SASS_TEST_SETUP_STATUS";; dist/index.js) echo START >>"$SASS_TEST_RUNTIME_RECORD";; dist/invite.js) echo INVITE >>"$SASS_TEST_RUNTIME_RECORD";; esac\n`, { mode: 0o755 });
  mkdirSync(join(tree, 'models', 'pinned'), { recursive: true });
  writeFileSync(join(tree, 'models', 'pinned', 'weights'), 'verified-new');
  if (collision) mkdirSync(join(tree, 'models', 'conflict'));
  if (unsafe) {
    const result = spawnSync('ln', ['-s', '/tmp', join(tree, 'models', 'outside')]);
    assert.equal(result.status, 0);
  }
  writeFileSync(join(tree, 'bundle-manifest.json'), JSON.stringify({ schemaVersion: 1, unpackedBytes: 100000, version: '1.2.3', platform: 'darwin-arm64', model: { id: 'onnx-community/embeddinggemma-300m-ONNX', revision: 'a'.repeat(40), dtype: 'q8', dimension: 768 } }));
  const archive = join(work, 'bundle.tar.gz');
  assert.equal(spawnSync('tar', ['-czf', archive, '-C', tree, '.']).status, 0);
  if (extraMember) {
    const script = "import io,sys,tarfile\np=sys.argv[1]\nwith tarfile.open(p,'r:gz') as f: entries=[(m,f.extractfile(m).read() if m.isfile() else None) for m in f]\nwith tarfile.open(p,'w:gz') as f:\n for m,data in entries: f.addfile(m,io.BytesIO(data) if data is not None else None)\n m=tarfile.TarInfo(sys.argv[2]);m.type={'file':tarfile.REGTYPE,'hardlink':tarfile.LNKTYPE,'fifo':tarfile.FIFOTYPE}[sys.argv[3]];m.linkname='runtime/bin/node';f.addfile(m)\n";
    const result = spawnSync('python3', ['-c', script, archive, extraMember.name, extraMember.type]);
    assert.equal(result.status, 0, result.stderr?.toString());
  }
  const bytes = readFileSync(archive);
  const manifest = {
    schemaVersion: 1, version: '1.2.3', platform: 'darwin-arm64', minimumMacOS: '15.0', archive: 'sass-v1.2.3-darwin-arm64.tar.gz',
    bytes: bytes.length, sha256: corrupt ? '0'.repeat(64) : createHash('sha256').update(bytes).digest('hex'), unpackedBytes: 100000,
    model: { id: 'onnx-community/embeddinggemma-300m-ONNX', revision: 'a'.repeat(40), dtype: 'q8', dimension: 768 },
  };
  const metadata = join(work, 'manifest.json'); writeFileSync(metadata, JSON.stringify(manifest));
  writeFileSync(join(bin, 'sw_vers'), '#!/bin/sh\nprintf "%s\\n" "${SASS_TEST_MACOS_VERSION:-15.0}"\n', { mode: 0o755 });
  writeFileSync(join(bin, 'plutil'), `#!/usr/bin/env python3\nimport json,sys\nv=json.load(open(sys.argv[-1]))\nfor k in sys.argv[sys.argv.index('-extract')+1].split('.'): v=v[k]\nprint(v)\n`, { mode: 0o755 });
  writeFileSync(join(work, 'setup-input'), '');
  writeFileSync(join(bin, 'mv'), '#!/bin/sh\ncase "$1" in */.sass-stage.*) if [ "${SASS_TEST_FAIL_ACTIVATE:-0}" = 1 ]; then exit 9; fi;; esac\nexec /bin/mv "$@"\n', { mode: 0o755 });
  writeFileSync(join(bin, 'curl'), `#!/bin/sh\noutput=''\nresume=0\nwhile [ "$#" -gt 0 ]; do\n  case "$1" in --continue-at) resume=1; shift 2;; -o) output="$2"; shift 2;; https://*) url="$1"; shift;; *) shift;; esac\ndone\ncase "$url" in *.json) cp "$SASS_TEST_MANIFEST" "$output";; *.tar.gz) if [ "$SASS_TEST_INTERRUPT_ONCE" = 1 ] && [ ! -f "$SASS_TEST_MARKER" ]; then head -c 20 "$SASS_TEST_ARCHIVE" >"$output"; touch "$SASS_TEST_MARKER"; exit 18; fi; if [ "$SASS_TEST_NO_RESUME" = 1 ] && [ "$resume" = 1 ] && [ -f "$output" ]; then exit 33; fi; cp "$SASS_TEST_ARCHIVE" "$output";; *) exit 22;; esac\n`, { mode: 0o755 });
  mkdirSync(join(work, 'scripts'));
  for (const name of ['install-ui.sh', 'install-bundle.sh']) writeFileSync(join(work, 'scripts', name), readFileSync(join(root, 'scripts', name)));
  const prefix = readFileSync(join(root, 'install.sh'), 'utf8').split('\nmain "$@"')[0];
  writeFileSync(join(work, 'entry.sh'), prefix);
  const destination = join(work, 'install');
  function run(action = 'sass_bundle_prepare; sass_bundle_install', extra = {}) {
    let script = `set -euo pipefail\nplatform_os() { echo darwin; }\nplatform_arch() { echo arm64; }\nsay() { echo "$*"; }\nwarn() { echo "$*" >&2; }\ndie() { warn "$*"; exit 1; }\ninstaller_spinner_start() { say "$*"; }\ninstaller_spinner_ok() { say "$*"; }\nsource "$SASS_TEST_ROOT/scripts/install-bundle.sh"\ntrap sass_bundle_cleanup EXIT\n${action}`;
    if (action === 'MAIN') script = 'source "$SASS_TEST_ENTRY"\nensure_path_line() { :; }\nmain';
    return spawnSync('/bin/bash', ['-c', script], { cwd: root, encoding: 'utf8', timeout: 10000, env: {
      ...process.env, PATH: `${bin}:${process.env.PATH}`, SASS_DIR: destination, SASS_HOME: join(work, 'state'),
      SASS_SETUP_INPUT: join(work, 'setup-input'), SASS_TEST_INTERRUPT_ONCE: '0', SASS_TEST_NO_RESUME: '0', SASS_TEST_MARKER: join(work, 'interrupted'),
      SASS_BIN_DIR: join(work, 'launcher'), SASS_SOURCE_INSTALL: '0', SASS_INSTALL_ASSUME_YES: '1', SASS_SKIP_SETUP: '0', SASS_TEST_ENTRY: join(work, 'entry.sh'), SASS_TEST_RUNTIME_RECORD: join(work, 'runtime-record'), SASS_TEST_SETUP_STATUS: '0',
      SASS_TEST_MANIFEST: metadata, SASS_TEST_ARCHIVE: archive, SASS_TEST_ROOT: root, SASS_TEST_NODE: process.execPath, ...extra,
    } });
  }
  return { work, run, runMain: (extra) => run('MAIN', extra), destination, metadata, manifest, close: () => rmSync(work, { recursive: true, force: true }) };
}

test('release preparation on an older Mac does not fetch or activate a bundle', () => {
  const f = fixture();
  try {
    const result = f.run('curl(){ echo UNEXPECTED_FETCH; exit 9; }; sass_bundle_prepare', {SASS_TEST_MACOS_VERSION:'14.7.2'});
    assert.equal(result.status, 1);
    assert.match(result.stderr, /requires macOS 15 or newer/);
    assert.ok(!result.stdout.includes('UNEXPECTED_FETCH'));
    assert.equal(existsSync(f.destination), false);
  } finally { f.close(); }
});

test('ready bundle installs without Git/npm and preserves private state on update', () => {
  const f = fixture();
  try {
    mkdirSync(f.destination); mkdirSync(join(f.destination, '.sass-data'));
    mkdirSync(join(f.destination, 'models')); writeFileSync(join(f.destination, 'models', 'cached-model'), 'cached');
    mkdirSync(join(f.destination, 'models', 'pinned'));
    writeFileSync(join(f.destination, 'models', 'pinned', 'weights'), 'old-weights');
    writeFileSync(join(f.destination, 'models', 'pinned', 'extra-cache'), 'extra');
    writeFileSync(join(f.destination, '.env'), 'SYNTHETIC=kept\n');
    writeFileSync(join(f.destination, '.env.backup-20260101'), 'backup');
    writeFileSync(join(f.destination, '.sass-data', 'synthetic-row'), 'kept');
    mkdirSync(join(f.destination, 'data')); writeFileSync(join(f.destination, 'data', 'entry'), 'data');
    mkdirSync(join(f.destination, '.cache')); writeFileSync(join(f.destination, '.cache', 'entry'), 'cache');
    const result = f.run();
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(readFileSync(join(f.destination, '.env'), 'utf8'), 'SYNTHETIC=kept\n');
    assert.equal(readFileSync(join(f.destination, '.env.backup-20260101'), 'utf8'), 'backup');
    assert.equal(readFileSync(join(f.destination, '.sass-data', 'synthetic-row'), 'utf8'), 'kept');
    assert.equal(readFileSync(join(f.destination, 'data', 'entry'), 'utf8'), 'data');
    assert.equal(readFileSync(join(f.destination, '.cache', 'entry'), 'utf8'), 'cache');
    assert.equal(readFileSync(join(f.destination, 'models', 'cached-model'), 'utf8'), 'cached');
    assert.equal(readFileSync(join(f.destination, 'models', 'pinned', 'weights'), 'utf8'), 'verified-new');
    assert.equal(readFileSync(join(f.destination, 'models', 'pinned', 'extra-cache'), 'utf8'), 'extra');
    assert.ok(existsSync(join(f.destination, 'dist/setup.js')));
  } finally { f.close(); }
});

test('copy conflict leaves the old installation intact before activation', () => {
  const f = fixture({ collision: true });
  try {
    mkdirSync(join(f.destination, 'models'), { recursive: true });
    writeFileSync(join(f.destination, 'models', 'conflict'), 'old-cache');
    writeFileSync(join(f.destination, '.env'), 'SYNTHETIC=kept\n');
    writeFileSync(join(f.destination, 'sentinel'), 'old');
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Cannot preserve models.*existing installation is unchanged/);
    assert.equal(result.stderr.includes(f.work), false, 'copy errors must not print absolute state paths');
    assert.equal(readFileSync(join(f.destination, 'models', 'conflict'), 'utf8'), 'old-cache');
    assert.equal(readFileSync(join(f.destination, '.env'), 'utf8'), 'SYNTHETIC=kept\n');
    assert.equal(readFileSync(join(f.destination, 'sentinel'), 'utf8'), 'old');
    assert.equal(existsSync(join(f.destination, 'dist')), false);
  } finally { f.close(); }
});

for (const [name, options] of [['checksum mismatch', { corrupt: true }], ['archive symlink', { unsafe: true }], ['bundle validation failure', { validateFails: true }]]) {
  test(`${name} leaves an existing installation unchanged`, () => {
    const f = fixture(options);
    try {
      mkdirSync(f.destination); writeFileSync(join(f.destination, 'sentinel'), 'old');
      const result = f.run();
      assert.notEqual(result.status, 0);
      assert.equal(readFileSync(join(f.destination, 'sentinel'), 'utf8'), 'old');
      assert.equal(existsSync(join(f.destination, 'dist')), false);
    } finally { f.close(); }
  });
}

test('missing published bundle fails without source fallback', () => {
  const f = fixture();
  try {
    const result = f.run('sass_bundle_prepare', { SASS_RELEASE_MANIFEST_URL: 'https://example.invalid/missing' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /release|bundle/i);
    assert.equal(existsSync(f.destination), false);
  } finally { f.close(); }
});

test('manifest size mismatch rejects activation', () => {
  const f = fixture();
  try {
    writeFileSync(f.metadata, JSON.stringify({ ...f.manifest, bytes: f.manifest.bytes + 1 }));
    assert.notEqual(f.run().status, 0);
    assert.equal(existsSync(f.destination), false);
  } finally { f.close(); }
});

test('HTTP manifest URLs are rejected before transport', () => {
  const f = fixture();
  try {
    const result = f.run('sass_bundle_prepare', { SASS_RELEASE_MANIFEST_URL: 'http://example.invalid/manifest.json' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /HTTPS/);
  } finally { f.close(); }
});


for (const [status, expected, exitCode] of [['0', ['SETUP', 'INVITE'], 0], ['10', ['SETUP', 'START'], 0], ['7', ['SETUP'], 7], ['130', ['SETUP'], 130]]) {
  test(`compiled setup exit ${status} has the correct start behavior`, () => {
    const f = fixture();
    try {
      const result = f.runMain({ SASS_TEST_SETUP_STATUS: status });
      assert.equal(result.status, exitCode, result.stdout + result.stderr);
      assert.deepEqual(readFileSync(join(f.work, 'runtime-record'), 'utf8').trim().split('\n'), expected);
    } finally { f.close(); }
  });
}


for (const cannotResume of ['0', '1']) {
  test(`interrupted bundle download retries safely with no-resume=${cannotResume}`, () => {
    const f = fixture();
    try {
      const first = f.run(undefined, { SASS_TEST_INTERRUPT_ONCE: '1' });
      assert.notEqual(first.status, 0);
      assert.match(first.stderr, /resume the cached download/);
      assert.equal(existsSync(f.destination), false);
      const retry = f.run(undefined, { SASS_TEST_NO_RESUME: cannotResume });
      assert.equal(retry.status, 0, retry.stderr + retry.stdout);
      assert.ok(existsSync(join(f.destination, 'dist/setup.js')));
    } finally { f.close(); }
  });
}

test('failed activation restores the complete old installation', () => {
  const f = fixture();
  try {
    mkdirSync(f.destination); writeFileSync(join(f.destination, 'sentinel'), 'old');
    const result = f.run(undefined, { SASS_TEST_FAIL_ACTIVATE: '1' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /previous installation was restored/);
    assert.equal(readFileSync(join(f.destination, 'sentinel'), 'utf8'), 'old');
  } finally { f.close(); }
});


for (const member of [
  { name: '../escaped', type: 'file' },
  { name: '/tmp/escaped', type: 'file' },
  { name: 'models/link', type: 'hardlink' },
  { name: 'models/pipe', type: 'fifo' },
]) {
  test(`archive preflight rejects ${member.type} member ${member.name}`, () => {
    const f = fixture({ extraMember: member });
    try {
      const result = f.run();
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Unsafe release archive path|link or special file/);
      assert.equal(existsSync(f.destination), false);
    } finally { f.close(); }
  });
}

test('an existing running database stops activation before data copying', () => {
  const f = fixture();
  try {
    mkdirSync(join(f.destination, '.sass-data/postgres'), { recursive: true });
    writeFileSync(join(f.destination, '.sass-data/postgres/postmaster.pid'), '12345');
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Stop Sass/);
    assert.equal(readFileSync(join(f.destination, '.sass-data/postgres/postmaster.pid'), 'utf8'), '12345');
  } finally { f.close(); }
});

test('sidecar on-disk size must match the verified internal manifest', () => {
  const f = fixture();
  try {
    writeFileSync(f.metadata, JSON.stringify({ ...f.manifest, unpackedBytes: 100001 }));
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unpackedBytes/);
    assert.equal(existsSync(f.destination), false);
  } finally { f.close(); }
});
