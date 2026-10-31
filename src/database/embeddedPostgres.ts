import { forwardWorkerOutput } from '../shared/workerOutput.js';
/**
 * Embedded PostgreSQL for zero-install local dev (embedded-postgres npm package).
 * Data persists under `.sass-data/postgres/`. Started from connectPool(), stopped on shutdown.
 */

import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'fs';
import net from 'net';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { fork, type ChildProcess } from 'child_process';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(MODULE_DIR, '..', '..');

function dataRoot(): string {
  const override = process.env.SASS_TEST_DATA_DIR?.trim();
  return override ? override : join(PROJECT_ROOT, '.sass-data');
}

export function sassDataDir(): string {
  return dataRoot();
}

export function postgresDataDir(): string {
  return join(dataRoot(), 'postgres');
}

function configFile(): string {
  return join(dataRoot(), 'local-db.json');
}

const DEFAULT_PORT = 54321;
const PORT_TRY_COUNT = 20;

export interface LocalDbConfig {
  port: number;
  user: string;
  password: string;
  database: string;
}

interface WorkerState {
  child: ChildProcess;
  ready: Promise<void>;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

let worker: WorkerState | null = null;
let startPending: Promise<string> | null = null;
let stopPending: Promise<void> | null = null;

export function isEmbeddedPostgresEnabled(): boolean {
  const value = process.env.SASS_EMBEDDED_PG?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

function loadConfig(): LocalDbConfig | null {
  const path = configFile();
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as LocalDbConfig;
    if (
      Number.isInteger(parsed.port)
      && parsed.port > 0 && parsed.port <= 65535
      && typeof parsed.user === 'string' && parsed.user.length > 0
      && typeof parsed.password === 'string' && parsed.password.length > 0
      && typeof parsed.database === 'string' && parsed.database.length > 0
    ) {
      return parsed;
    }
  } catch {
    // JSON parser errors can include credential text from the file.
    console.error('Could not read .sass-data/local-db.json.');
  }
  return null;
}

function saveConfig(config: LocalDbConfig): void {
  const dir = dataRoot();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = configFile();
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function newConfig(): LocalDbConfig {
  return {
    port: DEFAULT_PORT,
    user: 'sass',
    password: randomBytes(24).toString('base64url'),
    database: 'sass',
  };
}

export function buildConnectionString(config: LocalDbConfig): string {
  const user = encodeURIComponent(config.user);
  const password = encodeURIComponent(config.password);
  return `postgres://${user}:${password}@127.0.0.1:${config.port}/${config.database}`;
}

function clusterInitialised(): boolean {
  return existsSync(join(postgresDataDir(), 'PG_VERSION'));
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function resolvePort(config: LocalDbConfig): Promise<number> {
  if (clusterInitialised()) return config.port;
  for (let offset = 0; offset < PORT_TRY_COUNT; offset++) {
    const port = config.port + offset;
    if (await isPortFree(port)) return port;
  }
  throw new Error(`Could not find a free port between ${config.port} and ${config.port + PORT_TRY_COUNT - 1} for the local Postgres.`);
}

function startWorker(config: LocalDbConfig, initialised: boolean): WorkerState {
  const source = import.meta.url.endsWith('.ts');
  // The package installs its own exit hooks. Keep those hooks and the server out
  // of the application's terminal process group so the pool can drain first.
  const child = fork(new URL(source ? './embeddedPostgresWorker.ts' : './embeddedPostgresWorker.js', import.meta.url), [], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    execArgv: source ? ['--import', 'tsx'] : [],
  });
  // Drain worker output through the application so terminal hangup can silence
  // the lost TTY without blocking the detached database worker's own shutdown.
  forwardWorkerOutput(child.stdout, process.stdout);
  forwardWorkerOutput(child.stderr, process.stderr);
  let resolveReady: () => void;
  let rejectReady: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  let running = false;
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('exit', (code, signal) => {
      rejectReady(new Error(`Local Postgres worker exited (${signal ?? code ?? 'unknown'})`));
      if (running && !stopPending) {
        console.error(`Local Postgres worker exited unexpectedly (${signal ?? code ?? 'unknown'})`);
        if (worker?.child === child) {
          worker = null;
          startPending = null;
        }
      }
      resolve({ code, signal });
    });
    child.once('error', (error) => { rejectReady(error); resolve({ code: 1, signal: null }); });
  });
  child.on('message', (message: { type?: string; error?: string }) => {
    if (message.type === 'ready') { running = true; resolveReady(); }
    if (message.type === 'error') rejectReady(new Error(message.error ?? 'Local Postgres worker failed'));
  });
  child.send({ type: 'start', config, databaseDir: postgresDataDir(), initialised }, (error) => {
    if (error) rejectReady(error);
  });
  return { child, ready, exited };
}

/** Start embedded Postgres if needed and return a DATABASE_URL for the `pg` pool. */
export function ensureEmbeddedPostgresRunning(): Promise<string> {
  if (stopPending) return Promise.reject(new Error('Local Postgres is shutting down'));
  startPending ??= startEmbeddedPostgres().catch((error: unknown) => {
    startPending = null;
    throw error;
  });
  return startPending;
}

async function startEmbeddedPostgres(): Promise<string> {
  if (process.env.SASS_TEST_SKIP_EMBEDDED === '1') {
    const url = process.env.DATABASE_URL?.trim();
    if (!url) throw new Error('SASS_TEST_SKIP_EMBEDDED requires DATABASE_URL');
    return url;
  }

  const existing = loadConfig();
  const initialised = clusterInitialised();
  if (initialised && !existing) {
    throw new Error('Existing Postgres data needs its original .sass-data/local-db.json. Restore that file from backup; the database files have not been changed.');
  }
  const config = existing ?? newConfig();
  if (!initialised) {
    config.port = await resolvePort(config);
    saveConfig(config);
  }

  const current = startWorker(config, initialised);
  worker = current;
  try {
    await current.ready;
  } catch (error) {
    if (current.child.connected) current.child.disconnect();
    await current.exited;
    if (worker === current) worker = null;
    throw error;
  }
  const url = buildConnectionString(config);
  console.log(`Local Postgres running (data in .sass-data/postgres/, port ${config.port})`);
  return url;
}

export function stopEmbeddedPostgres(): Promise<void> {
  stopPending ??= (async () => {
    // Startup can still be preparing the cluster when a signal arrives.
    try { await startPending; }
    catch (error) { console.error('Local Postgres startup did not finish:', error instanceof Error ? error.message : 'Unknown startup error'); }
    const current = worker;
    if (!current) return;
    if (current.child.connected) current.child.disconnect();
    const result = await current.exited;
    worker = null;
    if (result.code !== 0 || result.signal) {
      throw new Error(`Local Postgres worker shutdown failed (${result.signal ?? result.code ?? 'unknown'})`);
    }
    console.log('Local Postgres stopped');
  })().finally(() => {
    startPending = null;
    stopPending = null;
  });
  return stopPending;
}
