/**
 * schema.ts — CREATE TABLE statements, ALTER TABLE migrations, column type checks
 *
 * Called once during initDatabase() after pool connection is established.
 */

import { readFileSync, existsSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getRawPool } from './pool.js';

/**
 * Migrate pair_interactions from old (non-guild-scoped) schema to new.
 */
async function migratePairInteractions(): Promise<void> {
  const pool = getRawPool();
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
  const pool = getRawPool();
  if (!pool) return;

  const __migrateDirname = dirname(fileURLToPath(import.meta.url));
  const dataDir = join(__migrateDirname, '..', '..', 'data');

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

/**
 * Create all tables, run ALTER migrations, and perform one-time local file migration.
 */
export async function createSchema(): Promise<void> {
  const pool = getRawPool();
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
      affinity REAL DEFAULT 50.0,
      PRIMARY KEY (server_id, user_id)
    );

    ALTER TABLE users ADD COLUMN IF NOT EXISTS affinity REAL DEFAULT 50.0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS affinity_gained_today REAL DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS affinity_gain_date DATE DEFAULT CURRENT_DATE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_activity_roast TIMESTAMPTZ;

    ALTER TABLE interactions ADD COLUMN IF NOT EXISTS prompt_tokens INTEGER;
    ALTER TABLE interactions ADD COLUMN IF NOT EXISTS completion_tokens INTEGER;
    ALTER TABLE interactions ADD COLUMN IF NOT EXISTS affinity REAL;

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

  // Migrate local JSON files to Postgres (one-time, on first deploy after guild-scoping)
  await migrateLocalFiles();
}
