/**
 * pool.ts — PostgreSQL connection pool singleton
 *
 * All other database modules import from here.
 * This is the leaf dependency — no circular imports.
 */

import pg from 'pg';
import { ensureEmbeddedPostgresRunning, isEmbeddedPostgresEnabled, stopEmbeddedPostgres } from './embeddedPostgres.js';

const { Pool } = pg;

let pool: InstanceType<typeof Pool> | null = null;
let isConnected = false;
let connecting: Promise<boolean> | null = null;
let closing: Promise<void> | null = null;

/**
 * Create the connection pool and verify connectivity.
 * Returns true if the pool is ready, false otherwise.
 */
export function connectPool(): Promise<boolean> {
  if (closing) return Promise.resolve(false);
  connecting ??= createPool();
  return connecting;
}

async function createPool(): Promise<boolean> {
  let url = process.env.DATABASE_URL?.trim();
  if (isEmbeddedPostgresEnabled()) {
    try {
      url = await ensureEmbeddedPostgresRunning();
      process.env.DATABASE_URL = url;
    } catch (err) {
      console.error('Local Postgres failed to start:', err instanceof Error ? err.message : 'Unknown startup error');
      console.log('Bot will continue without database logging.');
      return false;
    }
  }
  if (!url) {
    console.log('DATABASE_URL not set — database logging disabled (local dev mode)');
    return false;
  }

  try {
    pool = new Pool({
      connectionString: url,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      statement_timeout: 30000,
    });

    pool.on('error', (error: Error) => {
      console.error('Unexpected database connection error:', error.message);
    });

    // Test connection
    const client = await pool.connect();
    client.release();

    // Note: isConnected is set by initDatabase() after schema creation succeeds
    console.log('Database pool connected');
    return true;
  } catch (err) {
    console.error('Database connection failed:', (err as Error).message);
    console.log('Bot will continue without database logging.');
    if (pool) {
      await pool.end().catch((error: Error) => console.error('Failed to close unused database pool:', error.message));
      pool = null;
    }
    await stopEmbeddedPostgres();
    return false;
  }
}

/**
 * Check if the database is connected.
 */
export function isDatabaseConnected(): boolean {
  return isConnected;
}

/**
 * Get the connection pool for direct queries.
 * Returns null if database is not connected.
 */
export function getPool(): InstanceType<typeof Pool> | null {
  return isConnected ? pool : null;
}

/**
 * Get the raw pool reference (for internal use by other database modules).
 * Unlike getPool(), this returns the pool even before isConnected is set,
 * which is needed during schema creation.
 */
export function getRawPool(): InstanceType<typeof Pool> | null {
  return pool;
}

/**
 * Mark the database as connected (called after schema creation succeeds).
 */
export function setConnected(value: boolean): void {
  isConnected = value && !closing;
}

/**
 * Gracefully close the database pool. Call on process shutdown.
 */
export function closeDatabase(): Promise<void> {
  closing ??= (async () => {
    // A signal can arrive while embedded Postgres or the pool is starting.
    await connecting;
    isConnected = false;
    const current = pool;
    pool = null;
    if (current) {
      try {
        await current.end();
        console.log('Database pool closed');
      } catch (err) {
        console.error('Failed to close database:', (err as Error).message);
      }
    }
    await stopEmbeddedPostgres();
  })().finally(() => {
    connecting = null;
    closing = null;
  });
  return closing;
}
