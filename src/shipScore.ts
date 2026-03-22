/**
 * shipScore.ts — Deterministic ship compatibility scores
 *
 * Same pair always gets the same base score (hash-based).
 * Score evolves over time based on observed interactions:
 *   - Beefs lower the score
 *   - Positive interactions (replies, reactions) boost it
 *   - 100% only unlocks with 50+ interactions (proven pair)
 *
 * Pair interactions are stored in PostgreSQL (survives deploys)
 * with an in-memory cache for fast lookups.
 */

import { userMemory } from './userMemory.js';
import { recordPairInteractionDB, getPairInteractionCountDB, isDatabaseConnected } from './database.js';

const BEEF_PENALTY_PER_INCIDENT = 3;  // each beef lowers score by 3%
const MAX_BEEF_PENALTY = 30;          // cap so beefs don't zero out the score
const INTERACTION_BOOST_PER = 0.5;    // each interaction boosts score by 0.5%
const MAX_INTERACTION_BOOST = 40;     // cap boost at +40%
const UNLOCK_100_THRESHOLD = 50;      // 50+ interactions needed to unlock 100%

// In-memory cache of pair interaction counts (populated from DB on first access)
const pairCache = new Map<string, number>();
const MAX_CACHE_SIZE = 5000;

/**
 * Get a sorted key for a user pair (order-independent).
 */
function pairKey(id1: string, id2: string): string {
  const sorted = [id1, id2].sort();
  return `${sorted[0]}:${sorted[1]}`;
}

/**
 * Record an interaction between two users (reply, reaction, etc.).
 * Writes to both cache and DB.
 */
export function recordPairInteraction(userId1: string, userId2: string): void {
  if (userId1 === userId2) return; // no self-shipping boost
  const key = pairKey(userId1, userId2);
  const current = pairCache.get(key) || 0;
  pairCache.set(key, current + 1);

  // Evict oldest if over cap
  if (pairCache.size > MAX_CACHE_SIZE) {
    const oldest = pairCache.keys().next().value;
    if (oldest !== undefined) pairCache.delete(oldest);
  }

  // Persist to DB (fire and forget)
  recordPairInteractionDB(userId1, userId2).catch((err) =>
    console.error('DB pair interaction failed:', (err as Error).message)
  );
}

/**
 * Get interaction count for a pair.
 * Checks cache first, falls back to DB.
 */
export async function getPairInteractionsAsync(userId1: string, userId2: string): Promise<number> {
  const key = pairKey(userId1, userId2);
  const cached = pairCache.get(key);
  if (cached !== undefined) return cached;

  // Try DB
  if (isDatabaseConnected()) {
    const count = await getPairInteractionCountDB(userId1, userId2);
    pairCache.set(key, count);
    return count;
  }

  return 0;
}

/**
 * Sync version — returns cached value only (0 if not cached).
 * Use getPairInteractionsAsync for DB-backed lookups.
 */
export function getPairInteractions(userId1: string, userId2: string): number {
  return pairCache.get(pairKey(userId1, userId2)) || 0;
}

/**
 * Warm the cache for a pair from DB. Call before getShipScore.
 */
export async function warmPairCache(userId1: string, userId2: string): Promise<void> {
  const key = pairKey(userId1, userId2);
  if (pairCache.has(key)) return;
  if (isDatabaseConnected()) {
    const count = await getPairInteractionCountDB(userId1, userId2);
    pairCache.set(key, count);
  }
}

/**
 * Simple hash of two strings → deterministic number.
 * Always sorts IDs so order doesn't matter (A+B = B+A).
 */
function hashPair(id1: string, id2: string): number {
  const sorted = [id1, id2].sort();
  const combined = `${sorted[0]}:${sorted[1]}`;
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Get the ship score for a pair of users.
 * Base hash + interaction boost - beef penalty.
 * 100% only unlocks with 50+ interactions.
 * Call warmPairCache() before this for DB-backed counts.
 */
export function getShipScore(userId1: string, userId2: string): number {
  // Base score from hash — deterministic, range 5-75
  const hash = hashPair(userId1, userId2);
  const baseScore = 5 + (hash % 71); // 5 to 75 (lower ceiling to leave room for boost)

  // Interaction boost — positive engagement raises the score
  const interactions = getPairInteractions(userId1, userId2);
  const interactionBoost = Math.min(interactions * INTERACTION_BOOST_PER, MAX_INTERACTION_BOOST);

  // Beef penalty — lower score for users with beef history
  const beef = userMemory.getBeef(userId1, userId2);
  const beefPenalty = beef
    ? Math.min(beef.incidents * BEEF_PENALTY_PER_INCIDENT, MAX_BEEF_PENALTY)
    : 0;

  // 100% only unlocks if they have 50+ interactions
  const maxScore = interactions >= UNLOCK_100_THRESHOLD ? 100 : 98;

  // Clamp to 0-maxScore
  const finalScore = Math.max(0, Math.min(maxScore, baseScore + interactionBoost - beefPenalty));

  return Math.floor(finalScore);
}
