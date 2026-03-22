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
    });

    // Test connection
    const client = await pool.connect();
    client.release();

    // Create tables
    await createTables();

    // Migrate local JSON files to Postgres (one-time, on first deploy after guild-scoping)
    await migrateLocalFiles();

    // One-time: restore pair interactions after a migration reset
    await boostUserAUserB();

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
}

/**
 * One-time: restore a pair's ship score after a migration reset.
 */
async function boostUserAUserB(): Promise<void> {
  if (!pool) return;
  try {
    // Check if already boosted (look for any pair with 200+ interactions)
    const existing = await pool.query(
      'SELECT interaction_count FROM pair_interactions WHERE interaction_count >= 200 LIMIT 1'
    );
    if (existing.rows.length > 0) return; // Already done

    const userAId = '1000000000000000011';
    const userBId = '1000000000000000012';

    // Find which server they share
    const serverResult = await pool.query(
      `SELECT server_id FROM interactions WHERE user_id = $1 LIMIT 1`,
      [userAId]
    );
    if (serverResult.rows.length === 0) {
      console.log('UserA not found in interactions — skipping boost');
      return;
    }

    const serverId = serverResult.rows[0].server_id as string;
    const [id1, id2] = [userAId, userBId].sort();

    await pool.query(
      `INSERT INTO pair_interactions (server_id, user1_id, user2_id, interaction_count, last_interaction)
       VALUES ($1, $2, $3, 200, NOW())
       ON CONFLICT (server_id, user1_id, user2_id) DO UPDATE SET interaction_count = 200`,
      [serverId, id1, id2]
    );
    console.log(`Boosted UserA (${userAId}) x UserB (${userBId}) to 200 interactions in server ${serverId}`);
  } catch (err) {
    console.error('UserA x UserB boost failed:', (err as Error).message);
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
      tokens_estimate INTEGER
    );

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
      is_positive BOOLEAN
    );

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
      PRIMARY KEY (server_id, user_id)
    );

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
  `);
}

/**
 * Log an interaction (roast, reply, auto-sass, command response).
 */
export async function logInteraction({
  serverId, serverName, channelId, channelName,
  userId, username, triggerType, commandName,
  userMessage, sassResponse, mood, moodIntensity,
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
         trigger_type, command_name, user_message, sass_response, mood, mood_intensity, tokens_estimate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [serverId, serverName, channelId, channelName, userId, username,
       triggerType, commandName, userMessage, sassResponse, mood, moodIntensity, tokensEstimate]
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
export async function getStats(): Promise<StatsResult | null> {
  if (!isConnected || !pool) return null;

  try {
    const [total, byTrigger, topUsers, topCommands, recent] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM interactions'),
      pool.query('SELECT trigger_type, COUNT(*) as count FROM interactions GROUP BY trigger_type ORDER BY count DESC'),
      pool.query('SELECT username, COUNT(*) as count FROM interactions WHERE username IS NOT NULL GROUP BY username ORDER BY count DESC LIMIT 10'),
      pool.query('SELECT command_name, COUNT(*) as count FROM command_usage GROUP BY command_name ORDER BY count DESC LIMIT 10'),
      pool.query('SELECT COUNT(*) as count FROM interactions WHERE timestamp > NOW() - INTERVAL \'24 hours\''),
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
  reactorId, reactorName, emoji, isPositive,
}: ReactionLog): Promise<void> {
  if (!isConnected || !pool) return;

  try {
    await pool.query(
      `INSERT INTO reactions
        (server_id, channel_id, message_id, sass_response, reactor_id, reactor_name, emoji, is_positive)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [serverId, channelId, messageId, sassResponse, reactorId, reactorName, emoji, isPositive]
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
    await pool.end();
    isConnected = false;
    console.log('Database pool closed');
  }
}
