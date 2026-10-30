/**
 * Connection check for setup (same idea as doctor's database probe).
 */

import pg from 'pg';

const { Pool } = pg;

export async function verifyDatabaseConnection(databaseUrl: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });
  try {
    await pool.query('SELECT 1');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  } finally {
    await pool.end().catch((closeErr) => {
      console.error('Setup database probe shutdown failed:', (closeErr as Error).message);
    });
  }
}
