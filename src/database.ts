/**
 * database.ts — PostgreSQL logging & persistence layer
 *
 * Logs interactions for analytics and debugging.
 * Uses Railway's internal DATABASE_URL (private network, no egress fees).
 *
 * Tables:
 *   interactions — every message Sass sends (roasts, commands, auto-sass)
 *   mood_history — mood shifts with triggers
 *   command_usage — slash/mention command tracking
 */

import pg from 'pg';
import type { InteractionLog, MoodLog, CommandLog, StatsResult, TrainingDataRow } from './types.js';

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

    isConnected = true;
    console.log('Database connected \u2014 logging enabled');
    return true;
  } catch (err) {
    console.error('Database connection failed:', (err as Error).message);
    console.log('Bot will continue without database logging.');
    return false;
  }
}

async function createTables(): Promise<void> {
  if (!pool) return;
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

export function isDatabaseConnected(): boolean {
  return isConnected;
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
