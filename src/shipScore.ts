/**
 * shipScore.ts — Deterministic ship compatibility scores
 *
 * Same pair always gets the same base score (hash-based).
 * Score evolves over time based on observed interactions:
 *   - Beefs lower the score
 *   - Positive interactions (replies, reactions) boost it
 *   - 100% only unlocks with 50+ interactions (proven pair)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { userMemory } from './userMemory.js';

const BEEF_PENALTY_PER_INCIDENT = 3;  // each beef lowers score by 3%
const MAX_BEEF_PENALTY = 30;          // cap so beefs don't zero out the score
const INTERACTION_BOOST_PER = 0.5;    // each interaction boosts score by 0.5%
const MAX_INTERACTION_BOOST = 40;     // cap boost at +40%
const UNLOCK_100_THRESHOLD = 50;      // 50+ interactions needed to unlock 100%

const DATA_DIR = join(process.cwd(), 'data');
const INTERACTIONS_FILE = join(DATA_DIR, 'pair-interactions.json');

// In-memory store of user pair interaction counts
const pairInteractions = new Map<string, number>();
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Get a sorted key for a user pair (order-independent).
 */
function pairKey(id1: string, id2: string): string {
  const sorted = [id1, id2].sort();
  return `${sorted[0]}:${sorted[1]}`;
}

/**
 * Load pair interactions from disk.
 */
function loadInteractions(): void {
  try {
    const raw = readFileSync(INTERACTIONS_FILE, 'utf-8');
    const data = JSON.parse(raw) as Record<string, number>;
    for (const [key, count] of Object.entries(data)) {
      pairInteractions.set(key, count);
    }
    console.log(`Loaded ${pairInteractions.size} pair interactions`);
  } catch (_err) {
    // File doesn't exist yet — that's fine
  }
}

/**
 * Save pair interactions to disk (debounced).
 */
function saveInteractions(): void {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      mkdirSync(DATA_DIR, { recursive: true });
      const data: Record<string, number> = {};
      for (const [key, count] of pairInteractions) {
        data[key] = count;
      }
      writeFileSync(INTERACTIONS_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('Failed to save pair interactions:', (err as Error).message);
    }
  }, 10000); // save 10s after last change
}

// Load on startup
loadInteractions();

// Cap the map size to prevent unbounded growth
const MAX_TRACKED_PAIRS = 5000;

/**
 * Record an interaction between two users (reply, reaction, etc.).
 * Call this whenever user A engages with user B's content.
 */
export function recordPairInteraction(userId1: string, userId2: string): void {
  if (userId1 === userId2) return; // no self-shipping boost
  const key = pairKey(userId1, userId2);
  const current = pairInteractions.get(key) || 0;
  pairInteractions.set(key, current + 1);

  // Evict oldest if over cap
  if (pairInteractions.size > MAX_TRACKED_PAIRS) {
    const oldest = pairInteractions.keys().next().value;
    if (oldest !== undefined) pairInteractions.delete(oldest);
  }

  saveInteractions();
}

/**
 * Get interaction count for a pair.
 */
export function getPairInteractions(userId1: string, userId2: string): number {
  return pairInteractions.get(pairKey(userId1, userId2)) || 0;
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
