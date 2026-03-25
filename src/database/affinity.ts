/**
 * affinity.ts — Affinity system (per-user relationship score) and activity roast tracking
 *
 * Affinity: 0-100, stored as REAL for fractional gains.
 * Decay: -1/day after 3-day grace, floor at 30.
 * Daily cap: max +3.0 positive affinity per user per day.
 */

import { isDatabaseConnected, getPool } from './pool.js';

const DAILY_AFFINITY_CAP = 3.0;
const AFFINITY_DECAY_PER_DAY = 1;
const AFFINITY_DECAY_GRACE_DAYS = 3;
const AFFINITY_DECAY_FLOOR = 30;
const ACTIVITY_ROAST_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * Update a user's affinity score with diminishing returns (clamped 0-100).
 * Positive gains slow down as affinity increases:
 *   0-60: full gains, 60-75: x0.5, 75-90: x0.25, 90-100: x0.1
 * Negative changes always apply at full strength.
 * Daily cap: max +3.0 positive affinity per user per day (DB-tracked, survives deploys).
 */
export async function updateAffinity(guildId: string, userId: string, delta: number): Promise<void> {
  if (!isDatabaseConnected()) return;
  const pool = getPool();
  if (!pool) return;
  try {
    // For positive gains, apply diminishing returns + daily cap
    let effectiveDelta = delta;
    if (delta > 0) {
      // Check daily cap first (DB-tracked so it survives deploys)
      const capCheck = await pool.query(
        `SELECT affinity, affinity_gained_today, affinity_gain_date
         FROM users WHERE server_id = $1 AND user_id = $2`,
        [guildId, userId]
      );
      const row = capCheck.rows[0];
      const current = (row?.affinity as number) ?? 50;
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const gainDate = row?.affinity_gain_date ? new Date(row.affinity_gain_date as string).toISOString().slice(0, 10) : null;
      const gainedToday = (gainDate === today) ? ((row?.affinity_gained_today as number) ?? 0) : 0;

      // Already hit daily cap — skip entirely
      if (gainedToday >= DAILY_AFFINITY_CAP) {
        console.log(`[AFFINITY CAP] guild=${guildId.slice(-4)} user=${userId.slice(-4)} daily cap reached (${gainedToday.toFixed(2)}/${DAILY_AFFINITY_CAP})`);
        return;
      }

      // Apply diminishing returns based on current level
      let multiplier = 1;
      if (current >= 90) multiplier = 0.1;
      else if (current >= 75) multiplier = 0.25;
      else if (current >= 60) multiplier = 0.5;
      effectiveDelta = delta * multiplier;

      // Clamp to remaining daily budget
      const remaining = DAILY_AFFINITY_CAP - gainedToday;
      if (effectiveDelta > remaining) {
        effectiveDelta = remaining;
      }
    }

    // Upsert: create user row if it doesn't exist, update affinity + last_seen + daily tracker
    if (delta > 0) {
      const today = new Date().toISOString().slice(0, 10);
      const result = await pool.query(
        `INSERT INTO users (server_id, user_id, name, affinity, last_seen, affinity_gained_today, affinity_gain_date)
         VALUES ($1, $2, '', GREATEST(0, LEAST(100, 50.0 + $3::REAL)), NOW(), $3::REAL, $4::DATE)
         ON CONFLICT (server_id, user_id) DO UPDATE SET
           affinity = GREATEST(0, LEAST(100, COALESCE(users.affinity, 50.0) + $3::REAL)),
           last_seen = NOW(),
           affinity_gained_today = CASE
             WHEN users.affinity_gain_date = $4::DATE THEN COALESCE(users.affinity_gained_today, 0) + $3::REAL
             ELSE $3::REAL
           END,
           affinity_gain_date = $4::DATE
         RETURNING affinity, affinity_gained_today`,
        [guildId, userId, effectiveDelta, today]
      );
      console.log(`[AFFINITY DEBUG] guild=${guildId.slice(-4)} user=${userId.slice(-4)} delta=${delta} effective=${effectiveDelta.toFixed(3)} result=${result.rows[0]?.affinity} daily=${result.rows[0]?.affinity_gained_today?.toFixed(2)}/${DAILY_AFFINITY_CAP}`);
    } else {
      // Negative changes: no cap, no diminishing returns
      const result = await pool.query(
        `INSERT INTO users (server_id, user_id, name, affinity, last_seen)
         VALUES ($1, $2, '', GREATEST(0, LEAST(100, 50.0 + $3::REAL)), NOW())
         ON CONFLICT (server_id, user_id) DO UPDATE SET
           affinity = GREATEST(0, LEAST(100, COALESCE(users.affinity, 50.0) + $3::REAL)),
           last_seen = NOW()
         RETURNING affinity`,
        [guildId, userId, effectiveDelta]
      );
      console.log(`[AFFINITY DEBUG] guild=${guildId.slice(-4)} user=${userId.slice(-4)} delta=${delta} effective=${effectiveDelta} result=${result.rows[0]?.affinity}`);
    }
  } catch (err) {
    console.error('Failed to update affinity:', (err as Error).message);
  }
}

/**
 * Get a user's affinity score (default 50 if not set).
 * Applies lazy decay: -1 per day of inactivity after a 3-day grace period.
 * Floor at 30 (never drops below acquaintance tier).
 */
export async function getAffinity(guildId: string, userId: string): Promise<number> {
  if (!isDatabaseConnected()) return 50;
  const pool = getPool();
  if (!pool) return 50;
  try {
    const result = await pool.query(
      'SELECT affinity, last_seen FROM users WHERE server_id = $1 AND user_id = $2',
      [guildId, userId]
    );
    const row = result.rows[0];
    if (!row) {
      console.log(`[AFFINITY READ] guild=${guildId.slice(-4)} user=${userId.slice(-4)} NO ROW → default 50`);
      return 50;
    }

    let affinity = (row.affinity as number) ?? 50;
    console.log(`[AFFINITY READ] guild=${guildId.slice(-4)} user=${userId.slice(-4)} raw=${row.affinity} affinity=${affinity}`);
    const lastSeen = row.last_seen ? new Date(row.last_seen as string) : null;

    // Apply decay if inactive beyond grace period
    if (lastSeen && affinity > AFFINITY_DECAY_FLOOR) {
      const daysSinceLastSeen = (Date.now() - lastSeen.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceLastSeen > AFFINITY_DECAY_GRACE_DAYS) {
        const decayDays = daysSinceLastSeen - AFFINITY_DECAY_GRACE_DAYS;
        const decayAmount = Math.floor(decayDays * AFFINITY_DECAY_PER_DAY);
        if (decayAmount > 0) {
          const decayed = Math.max(AFFINITY_DECAY_FLOOR, affinity - decayAmount);
          if (decayed !== affinity) {
            // Persist the decayed value so it doesn't recalculate the same decay next time
            await pool.query(
              'UPDATE users SET affinity = $3::REAL WHERE server_id = $1 AND user_id = $2',
              [guildId, userId, decayed]
            ).catch((err: Error) => console.error('Failed to persist affinity decay:', err.message));
            affinity = decayed;
          }
        }
      }
    }

    return affinity;
  } catch (err) {
    console.error('Failed to get affinity:', (err as Error).message);
    return 50;
  }
}

/**
 * Check if a user was activity-roasted within the last 24 hours (DB-tracked, survives deploys).
 */
export async function wasActivityRoastedRecently(guildId: string, userId: string): Promise<boolean> {
  if (!isDatabaseConnected()) return false;
  const pool = getPool();
  if (!pool) return false;
  try {
    const result = await pool.query(
      'SELECT last_activity_roast FROM users WHERE server_id = $1 AND user_id = $2',
      [guildId, userId]
    );
    const lastRoast = result.rows[0]?.last_activity_roast;
    if (!lastRoast) return false;
    return Date.now() - new Date(lastRoast as string).getTime() < ACTIVITY_ROAST_COOLDOWN_MS;
  } catch (err) {
    console.error('Failed to check activity roast:', (err as Error).message);
    return false;
  }
}

/**
 * Mark a user as activity-roasted (DB-tracked, survives deploys).
 */
export async function setActivityRoasted(guildId: string, userId: string): Promise<void> {
  if (!isDatabaseConnected()) return;
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO users (server_id, user_id, name, last_activity_roast)
       VALUES ($1, $2, '', NOW())
       ON CONFLICT (server_id, user_id) DO UPDATE SET
         last_activity_roast = NOW()`,
      [guildId, userId]
    );
  } catch (err) {
    console.error('Failed to set activity roast:', (err as Error).message);
  }
}
