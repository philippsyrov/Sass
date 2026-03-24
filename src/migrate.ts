/**
 * migrate.ts — One-time migration from local files + old pair_interactions to guild-scoped Postgres
 *
 * Reads user-memory.json, wild-quotes.json, beefs.json, vector-memory.db (SQLite)
 * and inserts into new guild-scoped Postgres tables.
 *
 * Uses the `interactions` table to determine which server each user belongs to.
 * Users active in multiple servers get entries in each.
 *
 * Usage: npm run migrate
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');

const { Pool } = pg;

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set. Cannot migrate.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, max: 5 });

  try {
    console.log('Connecting to database...');
    const client = await pool.connect();
    client.release();
    console.log('Connected.\n');

    // Step 1: Build user→server(s) mapping from interactions table
    console.log('Building user→server mapping from interactions table...');
    const interactionsResult = await pool.query(
      'SELECT DISTINCT user_id, server_id FROM interactions WHERE user_id IS NOT NULL AND server_id IS NOT NULL'
    );
    const userServers = new Map<string, Set<string>>();
    for (const row of interactionsResult.rows) {
      const uid = row.user_id as string;
      const sid = row.server_id as string;
      if (!userServers.has(uid)) userServers.set(uid, new Set());
      userServers.get(uid)?.add(sid);
    }
    console.log(`Found ${userServers.size} users across servers.`);

    // Find the most active server as fallback
    const serverCounts = new Map<string, number>();
    for (const servers of userServers.values()) {
      for (const sid of servers) {
        serverCounts.set(sid, (serverCounts.get(sid) || 0) + 1);
      }
    }
    let fallbackServer = '';
    let maxCount = 0;
    for (const [sid, count] of serverCounts) {
      if (count > maxCount) { fallbackServer = sid; maxCount = count; }
    }
    console.log(`Fallback server (most active): ${fallbackServer}\n`);

    // Step 2: Migrate user-memory.json → users table
    const memoryFile = join(DATA_DIR, 'user-memory.json');
    if (existsSync(memoryFile)) {
      console.log('Migrating user-memory.json...');
      const users = JSON.parse(readFileSync(memoryFile, 'utf-8')) as Record<string, {
        name: string; roasts: string[]; lastSeen: number; messageCount: number;
        timesRoasted: number; facts?: string[]; coldShoulder?: { active: boolean; attemptsNeeded: number; attemptsMade: number };
        gender?: string | null;
      }>;

      let userCount = 0;
      for (const [userId, data] of Object.entries(users)) {
        const servers = userServers.get(userId) || new Set([fallbackServer]);
        if (servers.size === 0) servers.add(fallbackServer);

        for (const serverId of servers) {
          await pool.query(
            `INSERT INTO users (server_id, user_id, name, roasts, last_seen, message_count, times_roasted, facts,
               cold_shoulder_active, cold_shoulder_attempts_needed, cold_shoulder_attempts_made, gender)
             VALUES ($1, $2, $3, $4, to_timestamp($5), $6, $7, $8, $9, $10, $11, $12)
             ON CONFLICT (server_id, user_id) DO NOTHING`,
            [
              serverId, userId, data.name || '', data.roasts || [],
              (data.lastSeen || 0) / 1000, data.messageCount || 0, data.timesRoasted || 0,
              data.facts || [], data.coldShoulder?.active ?? false,
              data.coldShoulder?.attemptsNeeded ?? 0, data.coldShoulder?.attemptsMade ?? 0,
              data.gender ?? null,
            ]
          );
          userCount++;
        }
      }
      console.log(`  Inserted ${userCount} user rows.\n`);
    } else {
      console.log('No user-memory.json found, skipping.\n');
    }

    // Step 3: Migrate wild-quotes.json → wild_quotes table
    const quotesFile = join(DATA_DIR, 'wild-quotes.json');
    if (existsSync(quotesFile)) {
      console.log('Migrating wild-quotes.json...');
      const quotes = JSON.parse(readFileSync(quotesFile, 'utf-8')) as Array<{
        userId: string; name: string; quote: string; timestamp: number;
      }>;

      let quoteCount = 0;
      for (const q of quotes) {
        const servers = userServers.get(q.userId) || new Set([fallbackServer]);
        if (servers.size === 0) servers.add(fallbackServer);

        for (const serverId of servers) {
          await pool.query(
            `INSERT INTO wild_quotes (server_id, user_id, name, quote, timestamp)
             VALUES ($1, $2, $3, $4, to_timestamp($5))`,
            [serverId, q.userId, q.name, q.quote, (q.timestamp || Date.now()) / 1000]
          );
          quoteCount++;
        }
      }
      console.log(`  Inserted ${quoteCount} wild quote rows.\n`);
    } else {
      console.log('No wild-quotes.json found, skipping.\n');
    }

    // Step 4: Migrate beefs.json → beefs table
    const beefsFile = join(DATA_DIR, 'beefs.json');
    if (existsSync(beefsFile)) {
      console.log('Migrating beefs.json...');
      const beefs = JSON.parse(readFileSync(beefsFile, 'utf-8')) as Record<string, {
        incidents: number; firstBeef: number; lastBeef: number; lastTopic: string | null;
      }>;

      let beefCount = 0;
      for (const [key, data] of Object.entries(beefs)) {
        const [userId1, userId2] = key.split('-');
        if (!userId1 || !userId2) continue;

        // Find servers where both users exist
        const servers1 = userServers.get(userId1) || new Set([fallbackServer]);
        const servers2 = userServers.get(userId2) || new Set([fallbackServer]);
        const sharedServers = new Set([...servers1].filter((s) => servers2.has(s)));
        if (sharedServers.size === 0) sharedServers.add(fallbackServer);

        const [id1, id2] = [userId1, userId2].sort();
        for (const serverId of sharedServers) {
          await pool.query(
            `INSERT INTO beefs (server_id, user1_id, user2_id, incidents, first_beef, last_beef, last_topic)
             VALUES ($1, $2, $3, $4, to_timestamp($5), to_timestamp($6), $7)
             ON CONFLICT (server_id, user1_id, user2_id) DO NOTHING`,
            [serverId, id1, id2, data.incidents, (data.firstBeef || Date.now()) / 1000,
             (data.lastBeef || Date.now()) / 1000, data.lastTopic]
          );
          beefCount++;
        }
      }
      console.log(`  Inserted ${beefCount} beef rows.\n`);
    } else {
      console.log('No beefs.json found, skipping.\n');
    }

    // Step 5: Migrate vector-memory.db (SQLite) → vector_memories table
    const sqliteFile = join(DATA_DIR, 'vector-memory.db');
    if (existsSync(sqliteFile)) {
      console.log('Migrating vector-memory.db (SQLite)...');
      // Dynamic import to avoid crash if better-sqlite3 isn't installed
      try {
        // Dynamic require — better-sqlite3 must be temporarily installed: npm i better-sqlite3
        const { default: Database } = await (Function('return import("better-sqlite3")')() as Promise<{ default: new (path: string, opts: { readonly: boolean }) => {
          prepare(sql: string): { all(): Array<{ userId: string; type: string; content: string; embedding: string; createdAt: number }> };
          close(): void;
        } }>);
        const db = new Database(sqliteFile, { readonly: true });
        const rows = db.prepare('SELECT userId, type, content, embedding, createdAt FROM memories').all();

        let memoryCount = 0;
        for (const row of rows) {
          const servers = userServers.get(row.userId) || new Set([fallbackServer]);
          if (servers.size === 0) servers.add(fallbackServer);

          const embeddingArray = JSON.parse(row.embedding) as number[];

          for (const serverId of servers) {
            await pool.query(
              `INSERT INTO vector_memories (server_id, user_id, type, content, embedding, created_at)
               VALUES ($1, $2, $3, $4, $5, to_timestamp($6))`,
              [serverId, row.userId, row.type, row.content, embeddingArray, (row.createdAt || Date.now()) / 1000]
            );
            memoryCount++;
          }
        }
        db.close();
        console.log(`  Inserted ${memoryCount} vector memory rows.\n`);
      } catch (err) {
        console.error('  SQLite migration failed (better-sqlite3 may not be installed):', (err as Error).message);
        console.log('  Skipping vector memory migration. You can reinstall better-sqlite3 temporarily to run this.\n');
      }
    } else {
      console.log('No vector-memory.db found, skipping.\n');
    }

    // Step 6: Migrate pair_interactions — add server_id
    console.log('Migrating pair_interactions...');
    // Check if old pair_interactions has server_id column already
    const colCheck = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'pair_interactions' AND column_name = 'server_id'`
    );

    if (colCheck.rows.length === 0) {
      // Old schema — needs migration
      const oldPairs = await pool.query('SELECT user1_id, user2_id, interaction_count, last_interaction FROM pair_interactions');
      console.log(`  Found ${oldPairs.rows.length} existing pair records.`);

      // Drop old table and recreate with server_id
      await pool.query('ALTER TABLE pair_interactions RENAME TO pair_interactions_old');
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

      let pairCount = 0;
      for (const row of oldPairs.rows) {
        const u1 = row.user1_id as string;
        const u2 = row.user2_id as string;

        // Find servers where both users interacted
        const servers1 = userServers.get(u1) || new Set([fallbackServer]);
        const servers2 = userServers.get(u2) || new Set([fallbackServer]);
        const sharedServers = new Set([...servers1].filter((s) => servers2.has(s)));
        if (sharedServers.size === 0) sharedServers.add(fallbackServer);

        for (const serverId of sharedServers) {
          await pool.query(
            `INSERT INTO pair_interactions (server_id, user1_id, user2_id, interaction_count, last_interaction)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (server_id, user1_id, user2_id) DO UPDATE SET
               interaction_count = pair_interactions.interaction_count + EXCLUDED.interaction_count`,
            [serverId, u1, u2, row.interaction_count, row.last_interaction]
          );
          pairCount++;
        }
      }

      await pool.query('DROP TABLE pair_interactions_old');
      console.log(`  Migrated ${pairCount} pair interaction rows.\n`);
    } else {
      console.log('  pair_interactions already has server_id — skipping.\n');
    }

    console.log('═══════════════════════════════════════');
    console.log('  ✅ MIGRATION COMPLETE');
    console.log('═══════════════════════════════════════');
    console.log('\nOld local files (user-memory.json, wild-quotes.json, beefs.json, vector-memory.db)');
    console.log('have NOT been deleted. Verify the data in Postgres, then delete them manually.');

  } catch (err) {
    console.error('Migration failed:', (err as Error).message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Fatal:', (err as Error).message);
  process.exit(1);
});
