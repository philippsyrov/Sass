import { cp, mkdir, mkdtemp, readFile, writeFile, rm, stat, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { inventory, sha256, validateBundle, REQUIRED_LICENSES, NODE_VERSION, NODE_ARCHIVES } from './validate-bundle.mjs';

const here = dirname(fileURLToPath(import.meta.url));
async function copyInput(source, destination, options = {}) {
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw new Error('A release input root cannot be a symlink');
  if (info.isDirectory()) await inventory(source);
  await cp(source, destination, { recursive: true, dereference: true, ...options });
}
export async function buildRelease(configPath, outputDir) {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const base = dirname(resolve(configPath));
  const input = (name) => resolve(base, config[name]);
  const target = `${process.platform}-${process.arch}`;
  if (config.platform !== target || !target.startsWith('darwin-')) throw new Error('Build on the target Mac architecture; cross-builds are not accepted');
  const model = JSON.parse(await readFile(join(here, '../release/model-pin.json'), 'utf8'));
  // Release inputs are prepared on a build host. This command never installs,
  // downloads, or reads an existing user installation.
  const node = { version: NODE_VERSION, sourceUrl: `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-${target}.tar.gz`, archiveSha256: NODE_ARCHIVES[target] };
  if (await sha256(input('nodeArchive')) !== node.archiveSha256) throw new Error('Official Node archive checksum mismatch');
  const work = await mkdtemp(join(tmpdir(), 'sass-release-'));
  const outputs = [];
  try {
    const root = join(work, 'sass');
    await mkdir(root);
    for (const path of ['dist', 'node_modules', 'assets', 'package.json', 'LICENSE']) await copyInput(join(input('appDir'), path), join(root, path), { filter: (source) => !source.includes('/assets/screenshots') });
    await mkdir(join(root, 'scripts'));
    await copyInput(join(input('appDir'), 'scripts/sass.sh'), join(root, 'scripts/sass.sh'));
    await cp(join(here, 'validate-bundle.mjs'), join(root, 'scripts/validate-bundle.mjs'));
    await mkdir(join(root, 'runtime'));
    const extracted = spawnSync('/usr/bin/tar', ['-xzf', input('nodeArchive'), '--strip-components=1', '-C', join(root, 'runtime'), `node-${NODE_VERSION}-${target}/bin/node`, `node-${NODE_VERSION}-${target}/LICENSE`], { encoding: 'utf8' });
    if (extracted.status !== 0) throw new Error(`Official Node extraction failed: ${extracted.stderr}`);
    await mkdir(join(root, 'licenses'));
    for (const name of REQUIRED_LICENSES.filter((name) => name !== 'NODE-LICENSE')) {
      await copyInput(join(input('licensesDir'), name), join(root, 'licenses', name));
    }
    await cp(join(root, 'runtime/LICENSE'), join(root, 'licenses/NODE-LICENSE'));
    for (const name of REQUIRED_LICENSES) if ((await stat(join(root, 'licenses', name))).size === 0) throw new Error(`Empty license: ${name}`);
    const modelRoot = join(root, 'models', model.id, model.revision);
    for (const file of model.files) {
      const path = join(input('modelDir'), file.path);
      if ((await stat(path)).size !== file.bytes || await sha256(path) !== file.sha256) throw new Error(`Pinned model input mismatch: ${file.path}`);
      await mkdir(dirname(join(modelRoot, file.path)), { recursive: true });
      await cp(path, join(modelRoot, file.path));
    }
    const files = await inventory(root);
    const payloadBytes = files.reduce((total, file) => total + (file.bytes || 0), 0);
    const manifest = { schemaVersion: 1, version: config.version, platform: target, node, model, payloadBytes, unpackedBytes: payloadBytes, files };
    while (manifest.unpackedBytes !== payloadBytes + Buffer.byteLength(JSON.stringify(manifest, null, 2) + '\n')) manifest.unpackedBytes = payloadBytes + Buffer.byteLength(JSON.stringify(manifest, null, 2) + '\n');
    await writeFile(join(root, 'bundle-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    await validateBundle(root);
    const smoke = spawnSync(join(root, 'runtime/bin/node'), [join(here, 'smoke-bundle.mjs'), root], { encoding: 'utf8', timeout: 180_000, env: { HOME: work, PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' } });
    if (smoke.status !== 0 || smoke.error || /GNotificationCenterDelegate|Class .*implemented in both/.test(smoke.stderr || '')) throw new Error(`Bundle smoke check failed: ${smoke.error?.message || smoke.stderr || smoke.stdout}`);
    await mkdir(resolve(outputDir), { recursive: true });
    const archiveName = `sass-v${config.version}-${target}.tar.gz`;
    const archive = join(work, archiveName);
    const tar = spawnSync('/usr/bin/tar', ['-czf', archive, '-C', root, '.'], { encoding: 'utf8', env: { ...process.env, COPYFILE_DISABLE: '1' } });
    if (tar.status !== 0) throw new Error(`Archive failed: ${tar.stderr}`);
    const release = { schemaVersion: 1, version: config.version, platform: target, archive: archiveName, bytes: (await stat(archive)).size, sha256: await sha256(archive), unpackedBytes: manifest.unpackedBytes, model: { id: model.id, revision: model.revision, dtype: model.dtype, dimension: model.dimension } };
    const destination = join(resolve(outputDir), archiveName);
    await cp(archive, destination, { mode: constants.COPYFILE_EXCL, errorOnExist: true, force: false });
    outputs.push(destination);
    for (const [name, content] of [[`${archiveName}.json`, JSON.stringify(release, null, 2) + '\n'], [`sass-${target}.json`, JSON.stringify(release, null, 2) + '\n'], [`${archiveName}.sha256`, `${release.sha256}  ${archiveName}\n`]]) {
      const path = join(resolve(outputDir), name);
      await writeFile(path, content, { flag: 'wx' });
      outputs.push(path);
    }
    return release;
  } catch (error) {
    await Promise.all(outputs.map((path) => rm(path, { force: true })));
    throw error;
  } finally { await rm(work, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: node scripts/build-release.mjs <inputs.json> <output-directory>');
    console.log(JSON.stringify(await buildRelease(resolve(process.argv[2]), resolve(process.argv[3])), null, 2));
  } catch (error) { console.error(`Release build failed: ${error.message}`); process.exitCode = 1; }
}
