/**
 * database/index.ts — Barrel re-exports + initDatabase()
 *
 * All consuming files import from this module.
 * Internal modules (pool, schema, logging, queries, affinity) are implementation details.
 */

import { connectPool, setConnected } from './pool.js';
import { createSchema } from './schema.js';

// Re-export pool utilities
export { closeDatabase, isDatabaseConnected, getPool } from './pool.js';

// Re-export logging functions
export { logInteraction, logMoodShift, logCommand, logReaction } from './logging.js';

// Re-export query functions
export { recordPairInteractionDB, getPairInteractionCountDB, getStats, getTrainingData, getTopReactions } from './queries.js';

// Re-export affinity functions
export { updateAffinity, getAffinity, wasActivityRoastedRecently, setActivityRoasted } from './affinity.js';

/**
 * Initialize the database connection and create tables if needed.
 * Fails silently if DATABASE_URL is not set (local dev without DB).
 */
export async function initDatabase(): Promise<boolean> {
  const connected = await connectPool();
  if (!connected) return false;

  try {
    await createSchema();
    setConnected(true);
    console.log('Database connected — logging enabled');
    return true;
  } catch (err) {
    console.error('Schema creation failed:', (err as Error).message);
    setConnected(false);
    return false;
  }
}
