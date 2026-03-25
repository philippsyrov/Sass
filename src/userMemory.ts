/**
 * userMemory.ts — Guild-scoped user data backed by PostgreSQL
 *
 * All user data is stored per-guild in the `users` table.
 * No local files — everything goes through Postgres.
 *
 * Hot path optimization: `seen()` batches updates and flushes every 30s.
 * All other methods query/write directly.
 */

import { getPool, isDatabaseConnected } from './database/index.js';
import type {
  UserData, ColdShoulderStatus, WildQuote, BeefRecord,
  LeaderboardEntry, ServerStats, BufferEntry,
} from './types.js';

// --- Batched seen() updates ---
interface SeenUpdate {
  guildId: string;
  userId: string;
  displayName: string;
  messageCount: number;
  lastSeen: number;
}

const pendingSeen = new Map<string, SeenUpdate>();
const MAX_PENDING_SEEN = 2000;
const FLUSH_INTERVAL_MS = 30_000;

let flushInterval: ReturnType<typeof setInterval> | null = null;

function startFlushInterval(): void {
  if (flushInterval) return;
  flushInterval = setInterval(() => {
    flushSeen().catch((err) => console.error('Flush seen failed:', (err as Error).message));
  }, FLUSH_INTERVAL_MS);
}

/**
 * Flush all pending seen() updates to Postgres in a batch.
 */
export async function flushSeen(): Promise<void> {
  if (pendingSeen.size === 0) return;
  const pool = getPool();
  if (!pool) return;

  const entries = [...pendingSeen.values()];
  pendingSeen.clear();

  try {
    // Build batch upsert
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let idx = 1;
    for (const entry of entries) {
      placeholders.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, to_timestamp($${idx + 4}))`);
      values.push(entry.guildId, entry.userId, entry.displayName, entry.messageCount, entry.lastSeen / 1000);
      idx += 5;
    }

    await pool.query(
      `INSERT INTO users (server_id, user_id, name, message_count, last_seen)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (server_id, user_id) DO UPDATE SET
         name = EXCLUDED.name,
         message_count = users.message_count + EXCLUDED.message_count,
         last_seen = EXCLUDED.last_seen`,
      values
    );
  } catch (err) {
    console.error('Batch seen flush failed:', (err as Error).message);
  }
}

/**
 * Stop the flush interval and flush remaining data. Call on shutdown.
 */
export async function shutdownUserMemory(): Promise<void> {
  if (flushInterval) {
    clearInterval(flushInterval);
    flushInterval = null;
  }
  await flushSeen();
}

// --- Helper to get a single user row ---
async function getUser(guildId: string, userId: string): Promise<UserData | null> {
  const pool = getPool();
  if (!pool) return null;

  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE server_id = $1 AND user_id = $2',
      [guildId, userId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      name: row.name as string,
      roasts: (row.roasts as string[]) || [],
      lastSeen: new Date(row.last_seen as string).getTime(),
      messageCount: row.message_count as number,
      timesRoasted: row.times_roasted as number,
      facts: (row.facts as string[]) || [],
      coldShoulder: (row.cold_shoulder_active as boolean)
        ? { active: true, attemptsNeeded: row.cold_shoulder_attempts_needed as number, attemptsMade: row.cold_shoulder_attempts_made as number }
        : undefined,
      gender: (row.gender as UserData['gender']) ?? undefined,
    };
  } catch (err) {
    console.error('getUser failed:', (err as Error).message);
    return null;
  }
}

/**
 * Get basic stats for a user (messageCount, timesRoasted).
 * Used by commands that need raw numbers.
 */
export async function getUserStats(guildId: string, userId: string): Promise<{ messageCount: number; timesRoasted: number } | null> {
  const user = await getUser(guildId, userId);
  if (!user) return null;
  return { messageCount: user.messageCount, timesRoasted: user.timesRoasted };
}

// --- Public API (all guild-scoped) ---

/**
 * Track that a user sent a message. Batched — flushes every 30s.
 */
export function seen(guildId: string, userId: string, displayName: string): void {
  if (!isDatabaseConnected()) return;
  startFlushInterval();

  const key = `${guildId}:${userId}`;
  const existing = pendingSeen.get(key);
  if (existing) {
    existing.messageCount++;
    existing.displayName = displayName;
    existing.lastSeen = Date.now();
  } else {
    // Evict oldest if over cap
    if (pendingSeen.size >= MAX_PENDING_SEEN) {
      const oldest = pendingSeen.keys().next().value;
      if (oldest !== undefined) pendingSeen.delete(oldest);
    }
    pendingSeen.set(key, {
      guildId, userId, displayName, messageCount: 1, lastSeen: Date.now(),
    });
  }
}

/**
 * Store a roast topic so Sass can reference it later. Keeps last 5 per user.
 */
export async function addRoast(guildId: string, userId: string, topic: string): Promise<void> {
  const pool = getPool();
  if (!pool) return;

  try {
    // Append to array, keep last 5
    await pool.query(
      `INSERT INTO users (server_id, user_id, name, roasts)
       VALUES ($1, $2, '', ARRAY[$3]::TEXT[])
       ON CONFLICT (server_id, user_id) DO UPDATE SET
         roasts = (SELECT array_agg(r) FROM (
           SELECT unnest(array_append(users.roasts, $3)) AS r
         ) sub OFFSET GREATEST(0, array_length(array_append(users.roasts, $3), 1) - 5))`,
      [guildId, userId, topic]
    );
  } catch (err) {
    console.error('addRoast failed:', (err as Error).message);
  }
}

/**
 * Get context string about a user for the AI prompt.
 */
export async function getContext(guildId: string, userId: string): Promise<string> {
  const user = await getUser(guildId, userId);
  if (!user) return '';

  const parts: string[] = [];
  if (user.facts && user.facts.length > 0) {
    parts.push(
      `things you know about ${user.name}: ${user.facts.join('; ')}. weaponize this.`
    );
  }
  if (user.roasts.length > 0) {
    parts.push(
      `you've already destroyed ${user.name} before about: ${user.roasts.join(', ')}. ` +
      `use this. be petty. remind them they never learn.`
    );
  }
  if (user.messageCount > 50) {
    parts.push(`${user.name} is basically a fixture here. they can take whatever you throw at them — no mercy.`);
  } else if (user.messageCount > 20) {
    parts.push(`${user.name} is a regular. they know what they signed up for.`);
  } else if (user.messageCount <= 3) {
    parts.push(`${user.name} hasn't talked much yet. don't assume they're brand new — they might just be quiet.`);
  }
  return parts.join(' ');
}

/**
 * Build a "people in this chat" block from recent messages.
 * Batch-fetches all users in one query.
 */
export async function buildPeopleContext(guildId: string, recentMessages: BufferEntry[]): Promise<string> {
  if (!recentMessages || recentMessages.length === 0) return '';

  const pool = getPool();
  const creatorId = process.env.CREATOR_ID;

  // Collect unique non-bot users
  const seen = new Map<string, string>();
  for (const msg of recentMessages) {
    if (msg.isBot || seen.has(msg.authorId)) continue;
    seen.set(msg.authorId, msg.author);
  }
  if (seen.size === 0) return '';

  // Batch fetch from DB
  const userIds = [...seen.keys()];
  const usersMap: Record<string, UserData> = {};

  if (pool) {
    try {
      const result = await pool.query(
        'SELECT * FROM users WHERE server_id = $1 AND user_id = ANY($2)',
        [guildId, userIds]
      );
      for (const row of result.rows) {
        usersMap[row.user_id as string] = {
          name: row.name as string,
          roasts: (row.roasts as string[]) || [],
          lastSeen: new Date(row.last_seen as string).getTime(),
          messageCount: row.message_count as number,
          timesRoasted: row.times_roasted as number,
          facts: (row.facts as string[]) || [],
          gender: (row.gender as UserData['gender']) ?? undefined,
        };
      }
    } catch (err) {
      console.error('buildPeopleContext DB fetch failed:', (err as Error).message);
    }
  }

  const lines: string[] = ['PEOPLE IN THIS CHAT:'];
  for (const [userId, displayName] of seen) {
    const user = usersMap[userId];
    const parts: string[] = [];

    if (userId === creatorId) {
      parts.push('friend — be chill with them');
    } else if (user) {
      if (user.gender === 'female') parts.push('she/her');
      else if (user.gender === 'male') parts.push('he/him');
      else if (user.gender === 'nonbinary') parts.push('they/them');

      if (user.messageCount > 50) parts.push('regular, been around a while');
      else if (user.messageCount > 20) parts.push('regular');
      else if (user.messageCount <= 3) parts.push('newcomer');

      if (user.facts && user.facts.length > 0) {
        parts.push(`${displayName}'s intel: ${user.facts.join('; ')}`);
      }
      if (user.roasts.length > 0) {
        parts.push(`${displayName}'s ammo: ${user.roasts.join(', ')}`);
      }
    } else {
      parts.push('unknown — first time seeing them');
    }

    lines.push(`- ${displayName} (${parts.join(', ')})`);
  }

  return lines.join('\n');
}

/**
 * Increment the roast counter for a user.
 */
export async function recordRoast(guildId: string, userId: string): Promise<void> {
  const pool = getPool();
  if (!pool) return;

  try {
    await pool.query(
      `INSERT INTO users (server_id, user_id, name, times_roasted)
       VALUES ($1, $2, '', 1)
       ON CONFLICT (server_id, user_id) DO UPDATE SET
         times_roasted = users.times_roasted + 1`,
      [guildId, userId]
    );
  } catch (err) {
    console.error('recordRoast failed:', (err as Error).message);
  }
}

/**
 * Get the roast leaderboard — top N most roasted users in this guild.
 */
export async function getLeaderboard(guildId: string, limit = 10): Promise<LeaderboardEntry[]> {
  const pool = getPool();
  if (!pool) return [];

  const creatorId = process.env.CREATOR_ID;
  try {
    const result = await pool.query(
      `SELECT user_id, name, times_roasted FROM users
       WHERE server_id = $1 AND user_id != $2 AND times_roasted > 0
       ORDER BY times_roasted DESC LIMIT $3`,
      [guildId, creatorId || '', limit]
    );
    return result.rows.map((row) => ({
      id: row.user_id as string,
      name: row.name as string,
      timesRoasted: row.times_roasted as number,
    }));
  } catch (err) {
    console.error('getLeaderboard failed:', (err as Error).message);
    return [];
  }
}

/**
 * Store a fact about a user. Keeps last 10 facts. Auto-detects gender.
 */
export async function remember(guildId: string, userId: string, fact: string): Promise<void> {
  const pool = getPool();
  if (!pool) return;

  // Auto-detect gender from fact
  const lower = fact.toLowerCase();
  const femalePatterns = /\b(i'?m a (girl|woman|female)|i'?m (she|her)|my pronouns are she|call me (she|her)|i'm female)\b/i;
  const malePatterns = /\b(i'?m a (guy|boy|man|male|dude)|i'?m (he|him)|my pronouns are he|call me (he|him)|i'm male)\b/i;
  const nbPatterns = /\b(i'?m (nonbinary|non-binary|enby|nb)|my pronouns are they|call me they)\b/i;

  let gender: string | null = null;
  if (femalePatterns.test(lower)) gender = 'female';
  else if (malePatterns.test(lower)) gender = 'male';
  else if (nbPatterns.test(lower)) gender = 'nonbinary';

  try {
    if (gender) {
      await pool.query(
        `INSERT INTO users (server_id, user_id, name, facts, gender)
         VALUES ($1, $2, '', ARRAY[$3]::TEXT[], $4)
         ON CONFLICT (server_id, user_id) DO UPDATE SET
           facts = (SELECT array_agg(f) FROM (
             SELECT unnest(array_append(users.facts, $3)) AS f
           ) sub OFFSET GREATEST(0, array_length(array_append(users.facts, $3), 1) - 10)),
           gender = $4`,
        [guildId, userId, fact, gender]
      );
    } else {
      await pool.query(
        `INSERT INTO users (server_id, user_id, name, facts)
         VALUES ($1, $2, '', ARRAY[$3]::TEXT[])
         ON CONFLICT (server_id, user_id) DO UPDATE SET
           facts = (SELECT array_agg(f) FROM (
             SELECT unnest(array_append(users.facts, $3)) AS f
           ) sub OFFSET GREATEST(0, array_length(array_append(users.facts, $3), 1) - 10))`,
        [guildId, userId, fact]
      );
    }
  } catch (err) {
    console.error('remember failed:', (err as Error).message);
  }
}

/**
 * Get remembered facts about a user.
 */
export async function getFacts(guildId: string, userId: string): Promise<string[]> {
  const user = await getUser(guildId, userId);
  return user?.facts || [];
}

/**
 * Put a user on the cold shoulder list.
 */
export async function coldShoulder(guildId: string, userId: string): Promise<void> {
  const pool = getPool();
  if (!pool) return;

  const attemptsNeeded = 3 + Math.floor(Math.random() * 3); // 3-5
  try {
    await pool.query(
      `INSERT INTO users (server_id, user_id, name, cold_shoulder_active, cold_shoulder_attempts_needed, cold_shoulder_attempts_made)
       VALUES ($1, $2, '', TRUE, $3, 0)
       ON CONFLICT (server_id, user_id) DO UPDATE SET
         cold_shoulder_active = TRUE,
         cold_shoulder_attempts_needed = $3,
         cold_shoulder_attempts_made = 0`,
      [guildId, userId, attemptsNeeded]
    );
  } catch (err) {
    console.error('coldShoulder failed:', (err as Error).message);
  }
}

/**
 * Check if user is on the cold shoulder list.
 */
export async function getColdShoulder(guildId: string, userId: string): Promise<false | ColdShoulderStatus> {
  const user = await getUser(guildId, userId);
  const cs = user?.coldShoulder;
  if (!cs || !cs.active) return false;
  const progress = cs.attemptsMade / cs.attemptsNeeded;
  if (progress >= 1) return { phase: 'forgiven' };
  if (progress >= 0.6) return { phase: 'warming', attemptsMade: cs.attemptsMade, attemptsNeeded: cs.attemptsNeeded };
  return { phase: 'icy', attemptsMade: cs.attemptsMade, attemptsNeeded: cs.attemptsNeeded };
}

/**
 * Record an attempt to win Sass back.
 */
export async function coldShoulderAttempt(guildId: string, userId: string): Promise<false | ColdShoulderStatus> {
  const pool = getPool();
  if (!pool) return false;

  try {
    const result = await pool.query(
      `UPDATE users SET cold_shoulder_attempts_made = cold_shoulder_attempts_made + 1
       WHERE server_id = $1 AND user_id = $2 AND cold_shoulder_active = TRUE
       RETURNING cold_shoulder_attempts_needed, cold_shoulder_attempts_made`,
      [guildId, userId]
    );
    const row = result.rows[0];
    if (!row) return false;

    const needed = row.cold_shoulder_attempts_needed as number;
    const made = row.cold_shoulder_attempts_made as number;
    const forgiven = made >= needed;

    if (forgiven) {
      await pool.query(
        'UPDATE users SET cold_shoulder_active = FALSE WHERE server_id = $1 AND user_id = $2',
        [guildId, userId]
      );
      return { phase: 'forgiven' };
    }

    const progress = made / needed;
    if (progress >= 0.6) return { phase: 'warming', attemptsMade: made, attemptsNeeded: needed };
    return { phase: 'icy', attemptsMade: made, attemptsNeeded: needed };
  } catch (err) {
    console.error('coldShoulderAttempt failed:', (err as Error).message);
    return false;
  }
}

/**
 * Store a wild quote. Keeps max 20 per guild.
 */
export async function addWildQuote(guildId: string, userId: string, name: string, quote: string): Promise<void> {
  const pool = getPool();
  if (!pool) return;

  try {
    // Single atomic insert — unique constraint on (server_id, quote) prevents duplicates
    await pool.query(
      `INSERT INTO wild_quotes (server_id, user_id, name, quote)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [guildId, userId, name, quote]
    );
    // Cap at 20 per guild — delete oldest
    await pool.query(
      `DELETE FROM wild_quotes WHERE id IN (
        SELECT id FROM wild_quotes WHERE server_id = $1
        ORDER BY timestamp ASC
        OFFSET 0 LIMIT GREATEST(0,
          (SELECT COUNT(*) FROM wild_quotes WHERE server_id = $1) - 20
        )
      )`,
      [guildId]
    );
  } catch (err) {
    console.error('addWildQuote failed:', (err as Error).message);
  }
}

/**
 * Get wild quotes for hall of fame, scoped to guild.
 */
export async function getWildQuotes(guildId: string, limit = 10): Promise<WildQuote[]> {
  const pool = getPool();
  if (!pool) return [];

  try {
    const result = await pool.query(
      `SELECT user_id, name, quote, timestamp FROM wild_quotes
       WHERE server_id = $1 ORDER BY timestamp DESC LIMIT $2`,
      [guildId, limit]
    );
    return result.rows.map((row) => ({
      userId: row.user_id as string,
      name: row.name as string,
      quote: row.quote as string,
      timestamp: new Date(row.timestamp as string).getTime(),
    }));
  } catch (err) {
    console.error('getWildQuotes failed:', (err as Error).message);
    return [];
  }
}

/**
 * Track beef between two users in a guild.
 */
export async function addBeef(guildId: string, userId1: string, userId2: string, topic: string | null = null): Promise<void> {
  const pool = getPool();
  if (!pool) return;

  const [id1, id2] = [userId1, userId2].sort();
  try {
    await pool.query(
      `INSERT INTO beefs (server_id, user1_id, user2_id, incidents, first_beef, last_beef, last_topic)
       VALUES ($1, $2, $3, 1, NOW(), NOW(), $4)
       ON CONFLICT (server_id, user1_id, user2_id) DO UPDATE SET
         incidents = beefs.incidents + 1,
         last_beef = NOW(),
         last_topic = COALESCE($4, beefs.last_topic)`,
      [guildId, id1, id2, topic]
    );
  } catch (err) {
    console.error('addBeef failed:', (err as Error).message);
  }
}

/**
 * Get beef record between two users in a guild.
 */
export async function getBeef(guildId: string, userId1: string, userId2: string): Promise<BeefRecord | null> {
  const pool = getPool();
  if (!pool) return null;

  const [id1, id2] = [userId1, userId2].sort();
  try {
    const result = await pool.query(
      'SELECT incidents, first_beef, last_beef, last_topic FROM beefs WHERE server_id = $1 AND user1_id = $2 AND user2_id = $3',
      [guildId, id1, id2]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      incidents: row.incidents as number,
      firstBeef: new Date(row.first_beef as string).getTime(),
      lastBeef: new Date(row.last_beef as string).getTime(),
      lastTopic: (row.last_topic as string) ?? null,
    };
  } catch (err) {
    console.error('getBeef failed:', (err as Error).message);
    return null;
  }
}

/**
 * Get server-wide stats for wrapped command, scoped to guild.
 */
export async function getServerStats(guildId: string): Promise<ServerStats | null> {
  const pool = getPool();
  if (!pool) return null;

  const creatorId = process.env.CREATOR_ID;
  try {
    const result = await pool.query(
      `SELECT user_id, name, message_count, times_roasted, roasts, facts, gender
       FROM users WHERE server_id = $1 AND user_id != $2`,
      [guildId, creatorId || '']
    );
    if (result.rows.length === 0) return null;

    const users: Record<string, UserData> = {};
    let mostActive: UserData | null = null;
    let mostRoasted: UserData | null = null;
    let totalMessages = 0;

    for (const row of result.rows) {
      const data: UserData = {
        name: row.name as string,
        roasts: (row.roasts as string[]) || [],
        lastSeen: 0,
        messageCount: row.message_count as number,
        timesRoasted: row.times_roasted as number,
        facts: (row.facts as string[]) || [],
        gender: (row.gender as UserData['gender']) ?? undefined,
      };
      users[row.user_id as string] = data;
      totalMessages += data.messageCount;
      if (!mostActive || data.messageCount > mostActive.messageCount) mostActive = data;
      if (!mostRoasted || data.timesRoasted > (mostRoasted.timesRoasted || 0)) mostRoasted = data;
    }

    return { users, totalMessages, mostActive, mostRoasted };
  } catch (err) {
    console.error('getServerStats failed:', (err as Error).message);
    return null;
  }
}

/**
 * Check if a message text mentions the creator by name.
 */
export async function isAboutCreator(guildId: string, text: string): Promise<boolean> {
  const creatorName = await getCreatorName(guildId);
  if (!creatorName) return false;
  return text.toLowerCase().includes(creatorName.toLowerCase());
}

/**
 * Get the creator's display name in a specific guild.
 */
export async function getCreatorName(guildId: string): Promise<string | null> {
  const creatorId = process.env.CREATOR_ID;
  if (!creatorId) return null;

  // Check pending seen first (might have recent name)
  const pendingKey = `${guildId}:${creatorId}`;
  const pending = pendingSeen.get(pendingKey);
  if (pending?.displayName) return pending.displayName;

  const user = await getUser(guildId, creatorId);
  return user?.name || null;
}
