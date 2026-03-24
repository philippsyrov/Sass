/**
 * database.ts — PostgreSQL persistence & logging layer
 *
 * ALL persistent data lives in Postgres (Railway private network).
 * No local files — everything is guild-scoped.
 *
 * Tables:
 *   users — per-guild user data (facts, roasts, stats, cold shoulder)
 *   wild_quotes — per-guild wild quotes for hall of fame
 *   beefs — per-guild beef tracking between user pairs
 *   vector_memories — per-guild vector embeddings for semantic search
 *   pair_interactions — per-guild interaction counts for ship scores
 *   interactions — every message Sass sends (logging/analytics)
 *   mood_history — mood shifts with triggers
 *   command_usage — slash/mention command tracking
 *   reactions — emoji reactions on Sass's messages (quality signals)
 */

import { readFileSync, existsSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import type { InteractionLog, MoodLog, CommandLog, StatsResult, TrainingDataRow, ReactionLog } from './types.js';

const { Pool } = pg;

let pool: InstanceType<typeof Pool> | null = null;
let isConnected = false;

/**
 * Initialize the database connection and create tables if needed.
 * Fails silently if DATABASE_URL is not set (local dev without DB).
 */
export async function initDatabase(): Promise<boolean> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log('DATABASE_URL not set \u2014 database logging disabled (local dev mode)');
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

    // Create tables
    await createTables();

    // Migrate local JSON files to Postgres (one-time, on first deploy after guild-scoping)
    await migrateLocalFiles();

    isConnected = true;
    console.log('Database connected \u2014 logging enabled');
    return true;
  } catch (err) {
    console.error('Database connection failed:', (err as Error).message);
    console.log('Bot will continue without database logging.');
    return false;
  }
}

async function migratePairInteractions(): Promise<void> {
  if (!pool) return;
  // Check if pair_interactions has server_id in the PK (new schema)
  // If not, migrate from old schema to new
  try {
    const colCheck = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'pair_interactions' AND column_name = 'server_id'`
    );
    if (colCheck.rows.length === 0) {
      console.log('Migrating pair_interactions to guild-scoped schema...');
      const oldData = await pool.query('SELECT user1_id, user2_id, interaction_count, last_interaction FROM pair_interactions');
      await pool.query('DROP TABLE pair_interactions');
      await pool.query(`
        CREATE TABLE pair_interactions (
          server_id TEXT NOT NULL,
          user1_id TEXT NOT NULL,
          user2_id TEXT NOT NULL,
          interaction_count INTEGER DEFAULT 1,
          last_interaction TIMESTAMPTZ DEFAULT NOW(),
          PRIMARY KEY (server_id, user1_id, user2_id)
        )
      `);
      // Find the most active server to assign old data to
      const serverResult = await pool.query(
        `SELECT server_id, COUNT(*) as cnt FROM interactions
         WHERE server_id IS NOT NULL GROUP BY server_id ORDER BY cnt DESC LIMIT 1`
      );
      const fallbackServer = (serverResult.rows[0]?.server_id as string) || 'unknown';
      for (const row of oldData.rows) {
        await pool.query(
          `INSERT INTO pair_interactions (server_id, user1_id, user2_id, interaction_count, last_interaction)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
          [fallbackServer, row.user1_id, row.user2_id, row.interaction_count, row.last_interaction]
        );
      }
      console.log(`Migrated ${oldData.rows.length} pair_interactions rows to server ${fallbackServer}`);
    }
  } catch (err) {
    console.error('pair_interactions migration check failed:', (err as Error).message);
  }
}

/**
 * One-time migration: read local JSON files, insert into Postgres, rename files so it doesn't run again.
 * Uses the interactions table to determine which server each user belongs to.
 */
async function migrateLocalFiles(): Promise<void> {
  if (!pool) return;

  const __migrateDirname = dirname(fileURLToPath(import.meta.url));
  const dataDir = join(__migrateDirname, '..', 'data');

  // Build user→server mapping
  let userServers: Map<string, Set<string>>;
  let fallbackServer: string;
  try {
    const result = await pool.query(
      'SELECT DISTINCT user_id, server_id FROM interactions WHERE user_id IS NOT NULL AND server_id IS NOT NULL'
    );
    userServers = new Map();
    for (const row of result.rows) {
      const uid = row.user_id as string;
      const sid = row.server_id as string;
      if (!userServers.has(uid)) userServers.set(uid, new Set());
      userServers.get(uid)?.add(sid);
    }
    const serverCounts = new Map<string, number>();
    for (const servers of userServers.values()) {
      for (const sid of servers) {
        serverCounts.set(sid, (serverCounts.get(sid) || 0) + 1);
      }
    }
    fallbackServer = '';
    let maxCount = 0;
    for (const [sid, count] of serverCounts) {
      if (count > maxCount) { fallbackServer = sid; maxCount = count; }
    }
  } catch (err) {
    console.error('Failed to build user→server mapping:', (err as Error).message);
    return;
  }

  // Helper to get servers for a user
  const getServers = (userId: string): Set<string> => {
    const s = userServers.get(userId);
    if (s && s.size > 0) return s;
    return new Set(fallbackServer ? [fallbackServer] : []);
  };

  // Migrate user-memory.json
  const memoryFile = join(dataDir, 'user-memory.json');
  if (existsSync(memoryFile)) {
    console.log('Migrating user-memory.json to Postgres...');
    try {
      const users = JSON.parse(readFileSync(memoryFile, 'utf-8')) as Record<string, {
        name: string; roasts: string[]; lastSeen: number; messageCount: number;
        timesRoasted: number; facts?: string[]; coldShoulder?: { active: boolean; attemptsNeeded: number; attemptsMade: number };
        gender?: string | null;
      }>;
      let count = 0;
      for (const [userId, data] of Object.entries(users)) {
        for (const serverId of getServers(userId)) {
          await pool.query(
            `INSERT INTO users (server_id, user_id, name, roasts, last_seen, message_count, times_roasted, facts,
               cold_shoulder_active, cold_shoulder_attempts_needed, cold_shoulder_attempts_made, gender)
             VALUES ($1, $2, $3, $4, to_timestamp($5), $6, $7, $8, $9, $10, $11, $12)
             ON CONFLICT (server_id, user_id) DO NOTHING`,
            [serverId, userId, data.name || '', data.roasts || [],
             (data.lastSeen || 0) / 1000, data.messageCount || 0, data.timesRoasted || 0,
             data.facts || [], data.coldShoulder?.active ?? false,
             data.coldShoulder?.attemptsNeeded ?? 0, data.coldShoulder?.attemptsMade ?? 0,
             data.gender ?? null]
          );
          count++;
        }
      }
      renameSync(memoryFile, memoryFile + '.migrated');
      console.log(`  Migrated ${count} user rows. File renamed to .migrated`);
    } catch (err) {
      console.error('  user-memory.json migration failed:', (err as Error).message);
    }
  }

  // Migrate wild-quotes.json
  const quotesFile = join(dataDir, 'wild-quotes.json');
  if (existsSync(quotesFile)) {
    console.log('Migrating wild-quotes.json to Postgres...');
    try {
      const quotes = JSON.parse(readFileSync(quotesFile, 'utf-8')) as Array<{
        userId: string; name: string; quote: string; timestamp: number;
      }>;
      let count = 0;
      for (const q of quotes) {
        for (const serverId of getServers(q.userId)) {
          await pool.query(
            `INSERT INTO wild_quotes (server_id, user_id, name, quote, timestamp)
             VALUES ($1, $2, $3, $4, to_timestamp($5))`,
            [serverId, q.userId, q.name, q.quote, (q.timestamp || Date.now()) / 1000]
          );
          count++;
        }
      }
      renameSync(quotesFile, quotesFile + '.migrated');
      console.log(`  Migrated ${count} wild quote rows. File renamed to .migrated`);
    } catch (err) {
      console.error('  wild-quotes.json migration failed:', (err as Error).message);
    }
  }

  // Migrate beefs.json
  const beefsFile = join(dataDir, 'beefs.json');
  if (existsSync(beefsFile)) {
    console.log('Migrating beefs.json to Postgres...');
    try {
      const beefs = JSON.parse(readFileSync(beefsFile, 'utf-8')) as Record<string, {
        incidents: number; firstBeef: number; lastBeef: number; lastTopic: string | null;
      }>;
      let count = 0;
      for (const [key, data] of Object.entries(beefs)) {
        const [userId1, userId2] = key.split('-');
        if (!userId1 || !userId2) continue;
        const [id1, id2] = [userId1, userId2].sort();
        const servers1 = getServers(userId1);
        const servers2 = getServers(userId2);
        const shared = new Set([...servers1].filter((s) => servers2.has(s)));
        if (shared.size === 0 && fallbackServer) shared.add(fallbackServer);
        for (const serverId of shared) {
          await pool.query(
            `INSERT INTO beefs (server_id, user1_id, user2_id, incidents, first_beef, last_beef, last_topic)
             VALUES ($1, $2, $3, $4, to_timestamp($5), to_timestamp($6), $7)
             ON CONFLICT (server_id, user1_id, user2_id) DO NOTHING`,
            [serverId, id1, id2, data.incidents, (data.firstBeef || Date.now()) / 1000,
             (data.lastBeef || Date.now()) / 1000, data.lastTopic]
          );
          count++;
        }
      }
      renameSync(beefsFile, beefsFile + '.migrated');
      console.log(`  Migrated ${count} beef rows. File renamed to .migrated`);
    } catch (err) {
      console.error('  beefs.json migration failed:', (err as Error).message);
    }
  }

  // Migrate mood.json
  const moodFile = join(dataDir, 'mood.json');
  if (existsSync(moodFile)) {
    console.log('Migrating mood.json to Postgres...');
    try {
      const moodData = JSON.parse(readFileSync(moodFile, 'utf-8')) as {
        mood: string; intensity: number; lastShift: number; lastDecay: number;
      };
      if (fallbackServer) {
        await pool.query(
          `INSERT INTO mood_state (server_id, mood, intensity, last_shift, last_decay)
           VALUES ($1, $2, $3, to_timestamp($4), to_timestamp($5))
           ON CONFLICT (server_id) DO NOTHING`,
          [fallbackServer, moodData.mood || 'neutral', moodData.intensity || 0,
           (moodData.lastShift || Date.now()) / 1000, (moodData.lastDecay || Date.now()) / 1000]
        );
      }
      renameSync(moodFile, moodFile + '.migrated');
      console.log('  Migrated mood state. File renamed to .migrated');
    } catch (err) {
      console.error('  mood.json migration failed:', (err as Error).message);
    }
  }
}

async function createTables(): Promise<void> {
  if (!pool) return;
  // Migrate old pair_interactions if needed (before CREATE TABLE IF NOT EXISTS)
  await migratePairInteractions();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS interactions (
      id SERIAL PRIMARY KEY,
      timestamp TIMESTAMPTZ DEFAULT NOW(),
      server_id TEXT,
      server_name TEXT,
      channel_id TEXT,
      channel_name TEXT,
      user_id TEXT,
      username TEXT,
      trigger_type TEXT,
      command_name TEXT,
      user_message TEXT,
      sass_response TEXT,
      mood TEXT,
      mood_intensity INTEGER,
      tokens_estimate INTEGER,
      context TEXT
    );

    ALTER TABLE interactions ADD COLUMN IF NOT EXISTS context TEXT;

    CREATE TABLE IF NOT EXISTS mood_history (
      id SERIAL PRIMARY KEY,
      timestamp TIMESTAMPTZ DEFAULT NOW(),
      server_id TEXT,
      old_mood TEXT,
      new_mood TEXT,
      intensity INTEGER,
      trigger_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS command_usage (
      id SERIAL PRIMARY KEY,
      timestamp TIMESTAMPTZ DEFAULT NOW(),
      server_id TEXT,
      user_id TEXT,
      command_name TEXT,
      command_type TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_interactions_user ON interactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_interactions_server ON interactions(server_id);
    CREATE INDEX IF NOT EXISTS idx_interactions_timestamp ON interactions(timestamp);
    CREATE INDEX IF NOT EXISTS idx_interactions_trigger ON interactions(trigger_type);
    CREATE INDEX IF NOT EXISTS idx_command_usage_command ON command_usage(command_name);

    CREATE TABLE IF NOT EXISTS reactions (
      id SERIAL PRIMARY KEY,
      timestamp TIMESTAMPTZ DEFAULT NOW(),
      server_id TEXT,
      channel_id TEXT,
      message_id TEXT,
      sass_response TEXT,
      reactor_id TEXT,
      reactor_name TEXT,
      emoji TEXT,
      emoji_id TEXT,
      is_positive BOOLEAN
    );

    ALTER TABLE reactions ADD COLUMN IF NOT EXISTS emoji_id TEXT;

    CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id);

    CREATE TABLE IF NOT EXISTS pair_interactions (
      server_id TEXT NOT NULL,
      user1_id TEXT NOT NULL,
      user2_id TEXT NOT NULL,
      interaction_count INTEGER DEFAULT 1,
      last_interaction TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (server_id, user1_id, user2_id)
    );

    CREATE TABLE IF NOT EXISTS users (
      server_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      roasts TEXT[] DEFAULT '{}',
      last_seen TIMESTAMPTZ DEFAULT NOW(),
      message_count INTEGER DEFAULT 0,
      times_roasted INTEGER DEFAULT 0,
      facts TEXT[] DEFAULT '{}',
      cold_shoulder_active BOOLEAN DEFAULT FALSE,
      cold_shoulder_attempts_needed INTEGER DEFAULT 0,
      cold_shoulder_attempts_made INTEGER DEFAULT 0,
      gender TEXT,
      affinity REAL DEFAULT 50,
      PRIMARY KEY (server_id, user_id)
    );

    ALTER TABLE users ADD COLUMN IF NOT EXISTS affinity REAL DEFAULT 50;

    CREATE TABLE IF NOT EXISTS wild_quotes (
      id SERIAL PRIMARY KEY,
      server_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      quote TEXT NOT NULL,
      timestamp TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_wild_quotes_server ON wild_quotes(server_id);

    CREATE TABLE IF NOT EXISTS beefs (
      server_id TEXT NOT NULL,
      user1_id TEXT NOT NULL,
      user2_id TEXT NOT NULL,
      incidents INTEGER DEFAULT 1,
      first_beef TIMESTAMPTZ DEFAULT NOW(),
      last_beef TIMESTAMPTZ DEFAULT NOW(),
      last_topic TEXT,
      PRIMARY KEY (server_id, user1_id, user2_id)
    );

    CREATE TABLE IF NOT EXISTS vector_memories (
      id SERIAL PRIMARY KEY,
      server_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding REAL[] NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_vector_memories_lookup ON vector_memories(server_id, user_id);

    CREATE TABLE IF NOT EXISTS mood_state (
      server_id TEXT PRIMARY KEY,
      mood TEXT NOT NULL DEFAULT 'neutral',
      intensity INTEGER DEFAULT 0,
      last_shift TIMESTAMPTZ DEFAULT NOW(),
      last_decay TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Migrate affinity column INTEGER → REAL (separate query to avoid rollback if main block ever fails)
  try {
    const typeCheck = await pool.query(
      `SELECT data_type FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'affinity'`
    );
    const currentType = typeCheck.rows[0]?.data_type;
    console.log(`[SCHEMA] affinity column type: ${currentType}`);
    if (currentType === 'integer') {
      await pool.query('ALTER TABLE users ALTER COLUMN affinity TYPE REAL USING affinity::REAL');
      console.log('[SCHEMA] affinity column migrated INTEGER → REAL');
    }
  } catch (err) {
    console.error('Affinity column migration failed:', (err as Error).message);
  }

  // Deduplicate wild quotes then add unique index (separate step to avoid breaking schema init)
  try {
    await pool.query(`
      DELETE FROM wild_quotes a USING wild_quotes b
      WHERE a.id > b.id AND a.server_id = b.server_id AND a.quote = b.quote
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS wild_quotes_server_quote_unique
      ON wild_quotes (server_id, quote)
    `);
  } catch (err) {
    console.error('Wild quotes dedup/index failed (non-fatal):', (err as Error).message);
  }
}

/**
 * Log an interaction (roast, reply, auto-sass, command response).
 */
export async function logInteraction({
  serverId, serverName, channelId, channelName,
  userId, username, triggerType, commandName,
  userMessage, sassResponse, mood, moodIntensity, context,
}: InteractionLog): Promise<void> {
  if (!isConnected || !pool) return;

  // Rough token estimate: ~4 chars per token
  const tokensEstimate = Math.ceil(
    ((userMessage || '').length + (sassResponse || '').length) / 4
  );

  try {
    await pool.query(
      `INSERT INTO interactions
        (server_id, server_name, channel_id, channel_name, user_id, username,
         trigger_type, command_name, user_message, sass_response, mood, mood_intensity, tokens_estimate, context)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [serverId, serverName, channelId, channelName, userId, username,
       triggerType, commandName, userMessage, sassResponse, mood, moodIntensity, tokensEstimate, context]
    );
  } catch (err) {
    console.error('Failed to log interaction:', (err as Error).message);
  }
}

/**
 * Log a mood shift.
 */
export async function logMoodShift({ serverId, oldMood, newMood, intensity, reason }: MoodLog): Promise<void> {
  if (!isConnected || !pool) return;

  try {
    await pool.query(
      `INSERT INTO mood_history (server_id, old_mood, new_mood, intensity, trigger_reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [serverId, oldMood, newMood, intensity, reason]
    );
  } catch (err) {
    console.error('Failed to log mood shift:', (err as Error).message);
  }
}

/**
 * Log command usage (slash or @mention command).
 */
export async function logCommand({ serverId, userId, commandName, commandType }: CommandLog): Promise<void> {
  if (!isConnected || !pool) return;

  try {
    await pool.query(
      `INSERT INTO command_usage (server_id, user_id, command_name, command_type)
       VALUES ($1, $2, $3, $4)`,
      [serverId, userId, commandName, commandType]
    );
  } catch (err) {
    console.error('Failed to log command:', (err as Error).message);
  }
}

/**
 * Get stats for analytics.
 */
export async function getStats(guildId: string): Promise<StatsResult | null> {
  if (!isConnected || !pool) return null;

  try {
    const [total, byTrigger, topUsers, topCommands, recent] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM interactions WHERE server_id = $1', [guildId]),
      pool.query('SELECT trigger_type, COUNT(*) as count FROM interactions WHERE server_id = $1 GROUP BY trigger_type ORDER BY count DESC', [guildId]),
      pool.query('SELECT username, COUNT(*) as count FROM interactions WHERE server_id = $1 AND username IS NOT NULL GROUP BY username ORDER BY count DESC LIMIT 10', [guildId]),
      pool.query('SELECT command_name, COUNT(*) as count FROM command_usage WHERE server_id = $1 GROUP BY command_name ORDER BY count DESC LIMIT 10', [guildId]),
      pool.query('SELECT COUNT(*) as count FROM interactions WHERE server_id = $1 AND timestamp > NOW() - INTERVAL \'24 hours\'', [guildId]),
    ]);

    return {
      totalInteractions: parseInt(total.rows[0].count as string),
      last24h: parseInt(recent.rows[0].count as string),
      byTrigger: byTrigger.rows as StatsResult['byTrigger'],
      topUsers: topUsers.rows as StatsResult['topUsers'],
      topCommands: topCommands.rows as StatsResult['topCommands'],
    };
  } catch (err) {
    console.error('Failed to get stats:', (err as Error).message);
    return null;
  }
}

/**
 * Export interaction input/output pairs.
 */
export async function getTrainingData(limit = 1000): Promise<TrainingDataRow[]> {
  if (!isConnected || !pool) return [];

  try {
    const result = await pool.query(
      `SELECT user_message, sass_response, trigger_type, mood
       FROM interactions
       WHERE user_message IS NOT NULL AND sass_response IS NOT NULL
       ORDER BY timestamp DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows as TrainingDataRow[];
  } catch (err) {
    console.error('Failed to get training data:', (err as Error).message);
    return [];
  }
}

/**
 * Log a reaction on a Sass message.
 */
export async function logReaction({
  serverId, channelId, messageId, sassResponse,
  reactorId, reactorName, emoji, emojiId, isPositive,
}: ReactionLog): Promise<void> {
  if (!isConnected || !pool) return;

  try {
    await pool.query(
      `INSERT INTO reactions
        (server_id, channel_id, message_id, sass_response, reactor_id, reactor_name, emoji, emoji_id, is_positive)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [serverId, channelId, messageId, sassResponse, reactorId, reactorName, emoji, emojiId ?? null, isPositive]
    );
  } catch (err) {
    console.error('Failed to log reaction:', (err as Error).message);
  }
}

/**
 * Record an interaction between two users (for ship score boosts).
 * Uses upsert — increments count if pair exists, inserts if new.
 * Guild-scoped: same pair in different servers = separate counts.
 */
export async function recordPairInteractionDB(guildId: string, userId1: string, userId2: string): Promise<void> {
  if (!isConnected || !pool) return;
  const [id1, id2] = [userId1, userId2].sort();
  try {
    await pool.query(
      `INSERT INTO pair_interactions (server_id, user1_id, user2_id, interaction_count, last_interaction)
       VALUES ($1, $2, $3, 1, NOW())
       ON CONFLICT (server_id, user1_id, user2_id)
       DO UPDATE SET interaction_count = pair_interactions.interaction_count + 1, last_interaction = NOW()`,
      [guildId, id1, id2]
    );
  } catch (err) {
    console.error('Failed to record pair interaction:', (err as Error).message);
  }
}

/**
 * Get interaction count between two users in a specific guild.
 */
export async function getPairInteractionCountDB(guildId: string, userId1: string, userId2: string): Promise<number> {
  if (!isConnected || !pool) return 0;
  const [id1, id2] = [userId1, userId2].sort();
  try {
    const result = await pool.query(
      'SELECT interaction_count FROM pair_interactions WHERE server_id = $1 AND user1_id = $2 AND user2_id = $3',
      [guildId, id1, id2]
    );
    return (result.rows[0]?.interaction_count as number) ?? 0;
  } catch (err) {
    console.error('Failed to get pair interactions:', (err as Error).message);
    return 0;
  }
}

/**
 * Update a user's affinity score with diminishing returns (clamped 0-100).
 * Positive gains slow down as affinity increases:
 *   0-50: full gains, 50-75: ×0.5, 75-90: ×0.25, 90-100: ×0.1
 * Negative changes always apply at full strength.
 */
export async function updateAffinity(guildId: string, userId: string, delta: number): Promise<void> {
  if (!isConnected || !pool) return;
  try {
    // For positive gains, apply diminishing returns based on current level
    let effectiveDelta = delta;
    if (delta > 0) {
      const current = await getAffinity(guildId, userId);
      let multiplier = 1;
      if (current >= 90) multiplier = 0.1;
      else if (current >= 75) multiplier = 0.25;
      else if (current >= 60) multiplier = 0.5;
      effectiveDelta = Math.max(0.1, delta * multiplier);
    }

    // Upsert: create user row if it doesn't exist, update affinity + last_seen
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
  } catch (err) {
    console.error('Failed to update affinity:', (err as Error).message);
  }
}

/**
 * Get a user's affinity score (default 50 if not set).
 * Applies lazy decay: -1 per day of inactivity after a 3-day grace period.
 * Floor at 30 (never drops below acquaintance tier).
 */
const AFFINITY_DECAY_PER_DAY = 1;
const AFFINITY_DECAY_GRACE_DAYS = 3;
const AFFINITY_DECAY_FLOOR = 30;

export async function getAffinity(guildId: string, userId: string): Promise<number> {
  if (!isConnected || !pool) return 50;
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
              'UPDATE users SET affinity = $3 WHERE server_id = $1 AND user_id = $2',
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
 * Get top reactions for Sass's messages — for /bestof command.
 */
export async function getTopReactions(guildId: string, limit = 5): Promise<Array<{ sassResponse: string; userMessage: string; username: string; reactionCount: number }>> {
  if (!isConnected || !pool) return [];
  try {
    const result = await pool.query(
      `SELECT r.sass_response, r.message_id, COUNT(*) as reaction_count,
              i.user_message, i.username
       FROM reactions r
       INNER JOIN interactions i
         ON i.server_id = r.server_id AND i.sass_response = r.sass_response
       WHERE r.server_id = $1
         AND r.sass_response IS NOT NULL
         AND LENGTH(TRIM(r.sass_response)) > 0
         AND i.trigger_type NOT IN ('auto-sass-activity', 'command')
         AND i.username IS NOT NULL
         AND i.username != ''
       GROUP BY r.sass_response, r.message_id, i.user_message, i.username
       HAVING COUNT(*) >= 2
       ORDER BY reaction_count DESC
       LIMIT $2`,
      [guildId, limit]
    );
    return result.rows.map((row) => ({
      sassResponse: row.sass_response as string,
      userMessage: (row.user_message as string) ?? '',
      username: (row.username as string) ?? 'unknown',
      reactionCount: parseInt(row.reaction_count as string),
    }));
  } catch (err) {
    console.error('Failed to get top reactions:', (err as Error).message);
    return [];
  }
}

export function isDatabaseConnected(): boolean {
  return isConnected;
}

/**
 * Get the connection pool for direct queries from other modules.
 * Returns null if database is not connected.
 */
export function getPool(): InstanceType<typeof Pool> | null {
  return isConnected ? pool : null;
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
