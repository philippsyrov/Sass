/**
 * pool.ts — PostgreSQL connection pool singleton
 *
 * All other database modules import from here.
 * This is the leaf dependency — no circular imports.
 */

import pg from 'pg';

const { Pool } = pg;

let pool: InstanceType<typeof Pool> | null = null;
let isConnected = false;

/**
 * Create the connection pool and verify connectivity.
 * Returns true if the pool is ready, false otherwise.
 */
export async function connectPool(): Promise<boolean> {
  const url = process.env.DATABASE_URL;
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

    // Test connection
    const client = await pool.connect();
    client.release();

    // Note: isConnected is set by initDatabase() after schema creation succeeds
    console.log('Database pool connected');
    return true;
  } catch (err) {
    console.error('Database connection failed:', (err as Error).message);
    console.log('Bot will continue without database logging.');
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
  isConnected = value;
}

/**
 * Gracefully close the database pool. Call on process shutdown.
 */
export async function closeDatabase(): Promise<void> {
  if (pool) {
    try {
      await pool.end();
      isConnected = false;
      console.log('Database pool closed');
    } catch (err) {
      console.error('Failed to close database:', (err as Error).message);
    }
  }
}
