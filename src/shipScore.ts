/**
 * shipScore.ts — Deterministic ship compatibility scores (guild-scoped)
 *
 * Same pair always gets the same base score (hash-based).
 * Score evolves over time based on observed interactions:
 *   - Beefs lower the score
 *   - Positive interactions (replies, reactions) boost it
 *   - 100% only unlocks with 50+ interactions (proven pair)
 *
 * All data is scoped to guild — same pair in different servers = independent scores.
 */

import { captureUserDataToken, isUserDataTokenCurrent, withUserDataWrite } from './database/userDataGuard.js';
import { getBeef } from './userMemory.js';
import { recordPairInteractionDB, getPairInteractionCountDB, isDatabaseConnected } from './database/index.js';

const BEEF_PENALTY_PER_INCIDENT = 2;  // each beef lowers score by 2%
const MAX_BEEF_PENALTY = 30;          // cap so beefs don't zero out the score
const INTERACTION_BOOST_PER = 0.5;    // each interaction boosts score by 0.5%
const MAX_INTERACTION_BOOST = 40;     // cap boost at +40%
const UNLOCK_100_THRESHOLD = 50;      // 50+ interactions needed to unlock 100%

// In-memory cache of pair interaction counts (populated from DB on first access)
// Key format: "guildId:id1:id2"
const pairCache = new Map<string, number>();
const MAX_CACHE_SIZE = 5000;

/**
 * Get a sorted key for a user pair in a guild (order-independent).
 */
function pairKey(guildId: string, id1: string, id2: string): string {
  const sorted = [id1, id2].sort();
  return `${guildId}:${sorted[0]}:${sorted[1]}`;
}

/** Clear only cached pairs involving this user in this guild. */
export function clearUserPairCache(guildId: string, userId: string): void {
  for (const key of pairCache.keys()) {
    const [guild, first, second] = key.split(':');
    if (guild === guildId && (first === userId || second === userId)) pairCache.delete(key);
  }
}

function pairTokens(guildId: string, userId1: string, userId2: string) {
  const [first, second] = [userId1, userId2].sort() as [string, string];
  return [captureUserDataToken(guildId, first), captureUserDataToken(guildId, second)] as const;
}

function cacheCount(key: string, count: number): void {
  pairCache.set(key, count);
  if (pairCache.size > MAX_CACHE_SIZE) {
    const oldest = pairCache.keys().next().value;
    if (oldest !== undefined) pairCache.delete(oldest);
  }
}

/**
 * Record an interaction between two users in a guild.
 * Writes to both cache and DB.
 */
export function recordPairInteraction(guildId: string, userId1: string, userId2: string): void {
  if (userId1 === userId2) return;
  const tokens = pairTokens(guildId, userId1, userId2);
  if (!tokens.every(isUserDataTokenCurrent)) return;
  const key = pairKey(guildId, userId1, userId2);
  cacheCount(key, (pairCache.get(key) || 0) + 1);

  // Persist to DB (fire and forget)
  recordPairInteractionDB(guildId, userId1, userId2).catch((err) =>
    console.error('DB pair interaction failed:', (err as Error).message)
  );
}

/**
 * Get interaction count for a pair in a guild.
 * Checks cache first, falls back to DB.
 */
export async function getPairInteractionsAsync(guildId: string, userId1: string, userId2: string): Promise<number> {
  const tokens = pairTokens(guildId, userId1, userId2);
  if (!tokens.every(isUserDataTokenCurrent)) return 0;
  const key = pairKey(guildId, userId1, userId2);
  const cached = pairCache.get(key);
  if (cached !== undefined) return cached;
  if (!isDatabaseConnected()) return 0;

  const read = async (): Promise<number> => {
    const existing = pairCache.get(key);
    if (existing !== undefined) return existing;
    const count = await getPairInteractionCountDB(guildId, userId1, userId2);
    if (!tokens.every(isUserDataTokenCurrent)) return 0;
    // A new interaction may have populated the cache while the read was pending.
    if (!pairCache.has(key)) cacheCount(key, count);
    return pairCache.get(key) ?? 0;
  };
  const result = await withUserDataWrite(tokens[0], async () => {
    if (userId1 === userId2) return read();
    return withUserDataWrite(tokens[1], read);
  });
  return result ?? 0;
}

/**
 * Sync version — returns cached value only (0 if not cached).
 */
export function getPairInteractions(guildId: string, userId1: string, userId2: string): number {
  if (!pairTokens(guildId, userId1, userId2).every(isUserDataTokenCurrent)) return 0;
  return pairCache.get(pairKey(guildId, userId1, userId2)) || 0;
}

/**
 * Warm the cache for a pair from DB. Call before getShipScore.
 */
export async function warmPairCache(guildId: string, userId1: string, userId2: string): Promise<void> {
  await getPairInteractionsAsync(guildId, userId1, userId2);
}

/**
 * Simple hash of two strings → deterministic number.
 */
function hashPair(id1: string, id2: string): number {
  const sorted = [id1, id2].sort();
  const combined = `${sorted[0]}:${sorted[1]}`;
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

/**
 * Get the ship score for a pair of users in a guild.
 * Base hash + interaction boost - beef penalty.
 * Call warmPairCache() before this for DB-backed counts.
 */
export async function getShipScore(guildId: string, userId1: string, userId2: string): Promise<number> {
  const hash = hashPair(userId1, userId2);
  const baseScore = 15 + (hash % 61);

  const interactions = getPairInteractions(guildId, userId1, userId2);
  const interactionBoost = Math.min(interactions * INTERACTION_BOOST_PER, MAX_INTERACTION_BOOST);

  const beef = await getBeef(guildId, userId1, userId2);
  const beefPenalty = beef
    ? Math.min(beef.incidents * BEEF_PENALTY_PER_INCIDENT, MAX_BEEF_PENALTY)
    : 0;

  const maxScore = interactions >= UNLOCK_100_THRESHOLD ? 100 : 98;
  const finalScore = Math.max(0, Math.min(maxScore, baseScore + interactionBoost - beefPenalty));

  return Math.floor(finalScore);
}
