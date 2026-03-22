/**
 * shipScore.ts — Deterministic ship compatibility scores
 *
 * Same pair always gets the same base score (hash-based).
 * Score evolves over time based on observed interactions:
 *   - Beefs lower the score
 *   - Future: positive interactions (replies, reactions) boost it
 *   - 100% requires real sustained evidence of closeness
 */

import { userMemory } from './userMemory.js';

const BEEF_PENALTY_PER_INCIDENT = 3;  // each beef lowers score by 3%
const MAX_BEEF_PENALTY = 30;          // cap so beefs don't zero out the score

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
 * Returns a consistent percentage (0-98) that factors in beefs.
 * 100% is reserved for pairs with proven interaction history (future feature).
 */
export function getShipScore(userId1: string, userId2: string): number {
  // Base score from hash — deterministic, range 5-95
  const hash = hashPair(userId1, userId2);
  const baseScore = 5 + (hash % 91); // 5 to 95

  // Beef penalty — lower score for users with beef history
  const beef = userMemory.getBeef(userId1, userId2);
  const beefPenalty = beef
    ? Math.min(beef.incidents * BEEF_PENALTY_PER_INCIDENT, MAX_BEEF_PENALTY)
    : 0;

  // Clamp to 0-98 (100% reserved for proven pairs)
  const finalScore = Math.max(0, Math.min(98, baseScore - beefPenalty));

  return finalScore;
}
