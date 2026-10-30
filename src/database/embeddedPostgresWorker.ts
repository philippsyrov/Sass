import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { readFile } from 'fs/promises';
import { join } from 'path';
import type { LocalDbConfig } from './embeddedPostgres.js';

interface StartMessage {
  type: 'start';
  config: LocalDbConfig;
  databaseDir: string;
  initialised: boolean;
}

let instance: EmbeddedPostgres | undefined;
let startup: Promise<void> | undefined;
let stopping = false;
let started = false;
let serverPid: number | undefined;

function send(message: { type: string; error?: string }): void {
  if (!process.connected) return;
  process.send?.(message, (error: Error | null) => {
    if (error) void stop();
  });
}

async function start(message: StartMessage): Promise<void> {
  const { config, databaseDir, initialised } = message;
  instance = new EmbeddedPostgres({
    databaseDir, port: config.port, user: config.user,
    password: config.password, persistent: true, postgresFlags: ['-h', '127.0.0.1'],
  });
  if (!initialised) await instance.initialise();
  await instance.start();
  started = true;
  serverPid = Number((await readFile(join(databaseDir, 'postmaster.pid'), 'utf8')).split('\n')[0]);
  const client = new pg.Client({
    host: '127.0.0.1', port: config.port, user: config.user,
    password: config.password, database: 'postgres', connectionTimeoutMillis: 10000,
  });
  client.on('error', (error: Error) => console.error('Local Postgres setup connection failed:', error.message));
  try {
    await client.connect();
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [config.database]);
    if (existing.rowCount === 0) {
      await client.query(`CREATE DATABASE ${client.escapeIdentifier(config.database)}`);
    }
  } finally {
    await client.end();
  }
  send({ type: 'ready' });
}

async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  try {
    // Disconnect can arrive during initdb. Do not leave a server behind when
    // startup completes after its application has already exited.
    await startup;
  } catch (error) {
    console.error('Local Postgres worker startup failed:', error instanceof Error ? error.message : 'Unknown startup error');
  }
  try {
    // start() rejects only after the server exits. Calling the library's stop()
    // then would wait forever for an exit event that has already occurred.
    if (started) {
      if (serverPid) {
        try {
          process.kill(serverPid, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
            console.error('Local Postgres exited before shutdown.');
            process.exit(1);
          }
          throw error;
        }
      }
      await instance?.stop();
    }
    process.exit(0);
  } catch (error) {
    console.error('Local Postgres worker shutdown failed:', error instanceof Error ? error.message : 'Unknown shutdown error');
    process.exit(1);
  }
}

process.on('message', (message: StartMessage) => {
  if (message.type !== 'start' || startup || stopping) return;
  startup = start(message);
  void startup.catch((error: unknown) => {
    send({ type: 'error', error: error instanceof Error ? error.message : 'Local Postgres could not start' });
    void stop();
  });
});
process.once('disconnect', () => { void stop(); });
