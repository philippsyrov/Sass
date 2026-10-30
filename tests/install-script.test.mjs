import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const installer = readFileSync(join(root, 'install.sh'), 'utf8');
function definition(name) {
  const start = installer.indexOf(`${name}() {`);
  assert.ok(start >= 0, `Missing ${name}`);
  const end = installer.indexOf('\n}\n', start);
  return installer.slice(start, end + 3);
}
function shell(script, overrides = {}) {
  const env = { ...process.env };
  for (const key of ['SASS_BRANCH', 'SASS_INSTALL_BRANCH', 'SASS_INSTALL_SOURCE_URL', 'SASS_INSTALL_SCRIPT_URL']) delete env[key];
  return spawnSync('/bin/bash', ['-c', `set -euo pipefail\n${script}`], {
    cwd: root, env: { ...env, SASS_SOURCE_INSTALL: '1', ...overrides }, encoding: 'utf8', timeout: 10_000,
  });
}

test('generated state preserves shell-special install paths and private Node PATH', () => {
  const work = mkdtempSync(join(tmpdir(), 'sass-state-'));
  try {
    const dir = join(work, "User Name's $HOME; Sass");
    const state = join(work, "Node Name's $HOME");
    for (const privateNode of ['0', '1']) {
      const result = shell(`${definition('write_env_file')}\nwrite_env_file\nsource "$SASS_HOME/env"\nprintf '%s\\n%s\\n' "$SASS_DIR" "$PATH"`, {
        SASS_HOME: state, SASS_DIR: dir, SASS_USE_PRIVATE_NODE: privateNode,
      });
      assert.equal(result.status, 0, result.stderr);
      const [savedDir, savedPath] = result.stdout.trimEnd().split('\n');
      assert.equal(savedDir, dir);
      assert.equal(savedPath, privateNode === '1' ? `${state}/node/current/bin:${process.env.PATH}` : process.env.PATH);
    }
  } finally { rmSync(work, { recursive: true, force: true }); }
});

test('source URLs retain slash-containing branch names', () => {
  for (const url of [
    'https://raw.githubusercontent.com/example/Sass/feature/install-fix/install.sh',
    'https://github.com/example/Sass/blob/feature/install-fix/install.sh',
  ]) {
    const result = shell(`${definition('sass_resolve_branch')}\nsass_resolve_branch`, { SASS_INSTALL_SOURCE_URL: url });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'feature/install-fix');
  }
  const result = shell(`${definition('sass_resolve_branch')}\nsass_resolve_branch`, { SASS_BRANCH: 'explicit/branch' });
  assert.equal(result.stdout, 'explicit/branch');
});

test('README gives the planned public bundle route and states its release status', () => {
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  assert.match(readme, /curl[^\n]+\/main\/install\.sh\s*\|\s*bash/);
  assert.match(readme, /not a working public installer today/i);
});

test('failed UI fetch still defines progress and consent helpers', () => {
  // Only evaluate definitions and UI loading; main and all install actions stay excluded.
  const prefix = installer.slice(0, installer.indexOf('\nmain "$@"'));
  const result = shell(`curl() { return 22; }\n${prefix}\ninstaller_spinner_start checking\ninstaller_spinner_ok ready\ninstaller_spinner_fail failed\ndeclare -F installer_confirm_continue`, {
    SASS_DIR: '/nonexistent/sass-test-repo', SASS_REPO: 'https://github.com/example/Sass.git',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ready/);
});

test('Bash 3.2 smoke uses temporary install paths and refused consent', () => {
  const work = mkdtempSync(join(tmpdir(), 'sass-smoke-check-'));
  try {
    const binary = join(work, 'bash32');
    const record = join(work, 'paths');
    writeFileSync(binary, `#!/bin/sh\nif [ "$1" = --version ]; then echo 'GNU bash, version 3.2.57'; exit 0; fi\nprintf '%s\\n%s\\n%s\\n' "$SASS_DIR" "$SASS_BIN_DIR" "$SASS_INSTALL_ASSUME_YES" > "$SASS_TEST_RECORD"\necho "Here's what I'll do"\necho "$SASS_INSTALL_SOURCE_URL"\necho 'Run this installer in a terminal, or set SASS_INSTALL_ASSUME_YES=1 for automation.'\nexit 1\n`, { mode: 0o755 });
    const result = spawnSync('/bin/bash', [join(root, 'scripts/test-install-bash32.sh')], {
      cwd: root, env: { ...process.env, BASH32_BIN: binary, SASS_TEST_RECORD: record }, encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const [dir, bin, assumeYes] = readFileSync(record, 'utf8').trimEnd().split('\n');
    assert.notEqual(dir, root);
    assert.notEqual(bin, join(process.env.HOME, '.local/bin'));
    assert.ok(dir && bin);
    assert.notEqual(assumeYes, '1');
  } finally { rmSync(work, { recursive: true, force: true }); }
});

test('bootstrap carries the original 45-column artwork in both color formats', () => {
  const ui = readFileSync(join(root, 'scripts/install-ui.sh'), 'utf8');
  for (const kind of ['truecolor', '256']) {
    const marker = 'SASS_ART_' + kind.toUpperCase();
    const embedded = ui.split("  cat <<'" + marker + "'\n")[1].split(marker + '\n')[0];
    assert.equal(embedded, readFileSync(join(root, `assets/mascot/sass-45.${kind}.ans`), 'utf8'));
  }
});


test('profile PATH preserves literal dollar signs, spaces and quotes', () => {
  const work = mkdtempSync(join(tmpdir(), 'sass-profile-'));
  try {
    writeFileSync(join(work, '.zshrc'), '');
    const bin = join(work, "Literal $SASS_LITERAL_UNSET and 'quotes'");
    const result = shell(`${definition('ensure_path_line')}\nsay() { :; }\nensure_path_line "$SASS_TEST_BIN"\nsource "$HOME/.zshrc"\nprintf '%s' "$PATH"`, { HOME: work, SASS_TEST_BIN: bin });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${bin}:${process.env.PATH}`);
  } finally { rmSync(work, { recursive: true, force: true }); }
});


test('headless installers require explicit consent before archive or install writes', () => {
  for (const ui of [false, true]) for (const source of [false, true]) for (const consent of [false, true]) {
    const work = mkdtempSync(join(tmpdir(), 'sass-consent-'));
    try {
      const scripts = join(work, 'scripts');
      const bin = join(work, 'bin');
      mkdirSync(scripts); mkdirSync(bin);
      writeFileSync(join(work, 'install.sh'), installer);
      if (ui) writeFileSync(join(scripts, 'install-ui.sh'), readFileSync(join(root, 'scripts/install-ui.sh')));
      writeFileSync(join(scripts, 'install-bundle.sh'), `sass_bundle_prepare() { SASS_BUNDLE_BYTES=10; SASS_BUNDLE_UNPACKED_BYTES=20; }\nsass_bundle_install() { echo archive > "$SASS_TEST_RECORD"; return 42; }\n`);
      writeFileSync(join(bin, 'curl'), '#!/bin/sh\nexit 22\n', { mode: 0o755 });
      writeFileSync(join(bin, 'node'), '#!/bin/sh\necho 22\n', { mode: 0o755 });
      writeFileSync(join(bin, 'git'), '#!/bin/sh\necho clone > "$SASS_TEST_RECORD"\nexit 42\n', { mode: 0o755 });
      const record = join(work, 'record');
      const dir = join(work, 'destination');
      const home = join(work, 'home');
      const env = { ...process.env, HOME: work, PATH: `${bin}:${process.env.PATH}`, SASS_DIR: dir, SASS_HOME: home,
        SASS_BIN_DIR: join(work, 'launcher'), SASS_SOURCE_INSTALL: source ? '1' : '0', SASS_TEST_RECORD: record, CI: '1' };
      delete env.SASS_INSTALL_ASSUME_YES;
      if (consent) env.SASS_INSTALL_ASSUME_YES = '1';
      const result = spawnSync('/bin/bash', [join(work, 'install.sh')], { cwd: work, env, encoding: 'utf8', timeout: 10_000 });
      const label = `ui=${ui} source=${source} consent=${consent}`;
      assert.notEqual(result.status, 0, label);
      if (consent) {
        assert.equal(readFileSync(record, 'utf8').trim(), source ? 'clone' : 'archive', label);
      } else {
        assert.match(result.stdout + result.stderr, /terminal.*SASS_INSTALL_ASSUME_YES=1/i, label);
        assert.equal(existsSync(record), false, label);
        assert.equal(existsSync(dir), false, label);
        assert.equal(existsSync(home), false, label);
      }
    } finally { rmSync(work, { recursive: true, force: true }); }
  }
});

test('both consent helpers reject a missing TTY unless automation is explicit', () => {
  const fallback = `${definition('has_interactive_tty')}\nwarn() { printf '%s\\n' "$*"; }\n${definition('installer_confirm_continue')}`;
  const ui = `source "$SASS_TEST_UI"`;
  for (const [name, definitions] of [['fallback', fallback], ['UI', ui]]) {
    for (const consent of ['0', '1']) {
      const result = shell(`${definitions}\ninstaller_confirm_continue`, {
        SASS_TEST_UI: join(root, 'scripts/install-ui.sh'), SASS_INSTALL_ASSUME_YES: consent,
      });
      assert.equal(result.status, consent === '1' ? 0 : 1, `${name}: ${result.stdout} ${result.stderr}`);
      if (consent === '0') assert.match(result.stdout, /terminal.*SASS_INSTALL_ASSUME_YES=1/i);
    }
  }
});

test('source installer hands off start only after successful build and registration', () => {
  const work = mkdtempSync(join(tmpdir(), 'sass-source-handoff-'));
  try {
    mkdirSync(join(work, 'bin')); mkdirSync(join(work, 'repo')); mkdirSync(join(work, 'state'));
    const record = join(work, 'record');
    writeFileSync(join(work, 'bin', 'npm'), '#!/bin/sh\necho build >> "$SASS_TEST_RECORD"\nexit "${SASS_TEST_BUILD_STATUS:-0}"\n', { mode: 0o755 });
    writeFileSync(join(work, 'bin', 'node'), '#!/bin/sh\necho "$1" >> "$SASS_TEST_RECORD"\n', { mode: 0o755 });
    const prefix = installer.slice(0, installer.indexOf('\nmain "$@"'));
    const script = `${prefix}\ninstaller_confirm_continue() { return 0; }\ninstaller_task() { :; }\ninstaller_spinner_start() { :; }\ninstaller_spinner_ok() { :; }\nrun_setup_wizard() { return "$SASS_TEST_STATUS"; }\ninstaller_frame_exit() { echo frame >> "$SASS_TEST_RECORD"; }\nmain`;
    for (const [status, build, expected] of [['10','0',['frame','build','dist/register-commands.js','dist/index.js']], ['130','0',['frame']], ['10','1',['frame','build']]]) {
      rmSync(record, { force: true });
      const result = shell(script, { PATH: `${join(work, 'bin')}:${process.env.PATH}`, SASS_DIR: join(work, 'repo'), SASS_HOME: join(work, 'state'), SASS_INSTALL_ASSUME_YES: '1', SASS_TEST_RECORD: record, SASS_TEST_STATUS: status, SASS_TEST_BUILD_STATUS: build });
      assert.equal(result.status, status === '130' ? 130 : build === '1' ? 1 : 0, result.stderr);
      assert.deepEqual(readFileSync(record, 'utf8').trim().split('\n'), expected);
      if (result.status) assert.doesNotMatch(result.stdout, /Installation complete/);
    }
  } finally { rmSync(work, { recursive: true, force: true }); }
});

test('source wizard explicitly enables advanced model preparation', () => {
  const work = mkdtempSync(join(tmpdir(), 'sass-source-wizard-'));
  try {
    mkdirSync(join(work, 'repo')); mkdirSync(join(work, 'state'));
    writeFileSync(join(work, 'state', 'env'), '');
    const script = `${definition('run_setup_wizard')}\nsay() { echo "$*"; }\nsay_step() { :; }\nsetup_tty() { echo /dev/null; }\nnpm() { echo "advanced=$SASS_SETUP_ADVANCED"; }\nrun_setup_wizard`;
    const result = shell(script, { SASS_DIR: join(work, 'repo'), SASS_HOME: join(work, 'state'), INSTALLER_FRAME_ACTIVE: '0' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /no model is downloaded without consent/);
    assert.match(result.stdout, /advanced=1/);
  } finally { rmSync(work, { recursive: true, force: true }); }
});
