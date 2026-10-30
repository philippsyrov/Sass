/**
 * Optional setup path: reuse Docker container `sass-postgres` or a local Postgres install.
 */

import { execFile, spawn } from 'child_process';
import { randomBytes } from 'crypto';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const CONTAINER_NAME = 'sass-postgres';
const DB_NAME = 'sass';
const DB_USER = 'sass';

export type ExternalPostgresResult =
  | { ok: true; databaseUrl: string; detail: string }
  | { ok: false; detail: string; installHint: string };

function run(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', () => resolve({ code: 127, stdout, stderr }));
    child.on('exit', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function commandExists(name: string): Promise<boolean> {
  const check = process.platform === 'win32' ? 'where' : 'which';
  const result = await run(check, [name]);
  return result.code === 0;
}

async function dockerReady(): Promise<boolean> {
  if (!(await commandExists('docker'))) return false;
  const info = await run('docker', ['info']);
  return info.code === 0;
}

async function containerRunning(): Promise<boolean> {
  const ps = await run('docker', ['ps', '--filter', `name=^/${CONTAINER_NAME}$`, '--format', '{{.Names}}']);
  return ps.stdout.trim() === CONTAINER_NAME;
}

async function containerExists(): Promise<boolean> {
  const ps = await run('docker', ['ps', '-a', '--filter', `name=^/${CONTAINER_NAME}$`, '--format', '{{.Names}}']);
  return ps.stdout.trim() === CONTAINER_NAME;
}

function readDockerEnvPassword(containerId: string): Promise<string | null> {
  return execFileAsync('docker', ['inspect', '-f', '{{range .Config.Env}}{{println .}}{{end}}', containerId], { encoding: 'utf8' })
    .then(({ stdout }) => {
      const line = stdout.split('\n').find((entry) => entry.startsWith('POSTGRES_PASSWORD='));
      return line?.slice('POSTGRES_PASSWORD='.length) ?? null;
    })
    .catch(() => null);
}

async function ensureDockerPostgres(): Promise<ExternalPostgresResult> {
  if (!(await dockerReady())) {
    return {
      ok: false,
      detail: 'Docker is not installed or the Docker daemon is not running.',
      installHint: installHintForPlatform(),
    };
  }

  let password: string | null = null;
  if (await containerExists()) {
    const id = (await run('docker', ['ps', '-aq', '--filter', `name=^/${CONTAINER_NAME}$`])).stdout.trim();
    if (id) password = await readDockerEnvPassword(id);
    if (!(await containerRunning())) {
      const start = await run('docker', ['start', CONTAINER_NAME]);
      if (start.code !== 0) {
        return { ok: false, detail: `Could not start container ${CONTAINER_NAME}.`, installHint: installHintForPlatform() };
      }
    }
  } else {
    password = randomBytes(18).toString('base64url');
    const create = await run('docker', [
      'run', '-d',
      '--name', CONTAINER_NAME,
      '-e', `POSTGRES_USER=${DB_USER}`,
      '-e', `POSTGRES_PASSWORD=${password}`,
      '-e', `POSTGRES_DB=${DB_NAME}`,
      '-p', '127.0.0.1:5432:5432',
      '-v', `${CONTAINER_NAME}-data:/var/lib/postgresql/data`,
      '--restart', 'unless-stopped',
      'postgres:17',
    ]);
    if (create.code !== 0) {
      return { ok: false, detail: 'Could not create the Postgres Docker container.', installHint: installHintForPlatform() };
    }
  }

  if (!password) {
    return { ok: false, detail: 'Could not read the Postgres password from the existing container.', installHint: installHintForPlatform() };
  }

  const ready = await waitForDockerPostgres();
  if (!ready) {
    return { ok: false, detail: 'Postgres in Docker did not become ready in time.', installHint: installHintForPlatform() };
  }

  const user = encodeURIComponent(DB_USER);
  const pass = encodeURIComponent(password);
  return {
    ok: true,
    databaseUrl: `postgres://${user}:${pass}@127.0.0.1:5432/${DB_NAME}`,
    detail: `Using Docker container "${CONTAINER_NAME}" on 127.0.0.1:5432.`,
  };
}

async function waitForDockerPostgres(): Promise<boolean> {
  for (let i = 0; i < 30; i++) {
    try {
      await execFileAsync('docker', [
        'exec', CONTAINER_NAME, 'pg_isready', '-h', '127.0.0.1', '-U', DB_USER, '-d', DB_NAME,
      ], { timeout: 5000 });
      return true;
    } catch {
      // The container can take a few seconds to initialise its data directory.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

async function waitForTcp(host: string, port: number, attempts = 30): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      const { stdout } = await execFileAsync('pg_isready', ['-h', host, '-p', String(port)], { encoding: 'utf8', timeout: 5000 });
      if (/accepting connections/i.test(stdout)) return true;
    } catch {
      // try next
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function ensureNativePostgres(): Promise<ExternalPostgresResult> {
  const hasPsql = await commandExists('psql');
  const hasReady = await commandExists('pg_isready');
  if (!hasPsql || !hasReady) {
    return {
      ok: false,
      detail: 'No local Postgres tools found (psql / pg_isready).',
      installHint: installHintForPlatform(),
    };
  }

  const host = '127.0.0.1';
  const port = 5432;
  if (!(await waitForTcp(host, port, 3))) {
    return {
      ok: false,
      detail: 'Nothing is listening for Postgres on 127.0.0.1:5432.',
      installHint: installHintForPlatform(),
    };
  }

  const existingRole = await run('psql', [
    '-w', '-h', host, '-p', String(port), '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tAc',
    `SELECT 1 FROM pg_roles WHERE rolname = '${DB_USER}'`,
  ]);
  if (existingRole.code !== 0 || existingRole.stdout.trim() === '1') {
    return {
      ok: false,
      detail: existingRole.code !== 0
        ? 'Could not inspect local Postgres roles. Paste an existing DATABASE_URL instead.'
        : 'The sass Postgres role already exists. Paste its existing DATABASE_URL instead.',
      installHint: installHintForPlatform(),
    };
  }

  const password = randomBytes(18).toString('base64url');
  const createUser = await run('psql', [
    '-w', '-h', host, '-p', String(port), '-d', 'postgres', '-v', 'ON_ERROR_STOP=1',
    '-c', `CREATE USER ${DB_USER} WITH PASSWORD '${password.replace(/'/g, "''")}'`,
  ]);
  if (createUser.code !== 0) {
    return {
      ok: false,
      detail: 'Could not create the sass Postgres user (try pasting a full DATABASE_URL instead).',
      installHint: installHintForPlatform(),
    };
  }

  await run('psql', [
    '-w', '-h', host, '-p', String(port), '-d', 'postgres', '-v', 'ON_ERROR_STOP=1',
    '-c', `SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'`,
  ]);

  const createDb = await run('psql', [
    '-w', '-h', host, '-p', String(port), '-d', 'postgres', '-v', 'ON_ERROR_STOP=1',
    '-c', `CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}`,
  ]);
  if (createDb.code !== 0 && !/already exists/i.test(createDb.stderr)) {
    return {
      ok: false,
      detail: 'Could not create the sass database.',
      installHint: installHintForPlatform(),
    };
  }

  const user = encodeURIComponent(DB_USER);
  const pass = encodeURIComponent(password);
  return {
    ok: true,
    databaseUrl: `postgres://${user}:${pass}@${host}:${port}/${DB_NAME}`,
    detail: `Using Postgres on ${host}:${port}, database "${DB_NAME}".`,
  };
}

export function installHintForPlatform(): string {
  switch (process.platform) {
    case 'darwin':
      return 'On macOS: install Docker Desktop, or Postgres.app, or run `brew install postgresql@17` and start the service.';
    case 'win32':
      return 'On Windows: install Docker Desktop, or the PostgreSQL installer from postgresql.org.';
    default:
      return 'On Linux: install Docker, or `sudo apt install postgresql` (or your distro\'s package) and start the service.';
  }
}

/** Prefer Docker when available; otherwise try a local Postgres on 5432. */
export async function provisionExternalPostgres(deps?: {
  docker?: () => Promise<ExternalPostgresResult>;
  native?: () => Promise<ExternalPostgresResult>;
}): Promise<ExternalPostgresResult> {
  const tryDocker = deps?.docker ?? ensureDockerPostgres;
  const tryNative = deps?.native ?? ensureNativePostgres;

  const docker = await tryDocker();
  if (docker.ok) return docker;

  const native = await tryNative();
  if (native.ok) return native;

  return {
    ok: false,
    detail: `${docker.detail} ${native.detail}`.trim(),
    installHint: installHintForPlatform(),
  };
}
