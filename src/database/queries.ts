/**
 * queries.ts — Pair interactions, stats, interaction exports, top reactions
 */

import { isDatabaseConnected, getPool } from './pool.js';
import type { StatsResult, TrainingDataRow } from '../types.js';

/**
 * Record an interaction between two users (for ship score boosts).
 * Uses upsert — increments count if pair exists, inserts if new.
 * Guild-scoped: same pair in different servers = separate counts.
 */
export async function recordPairInteractionDB(guildId: string, userId1: string, userId2: string): Promise<void> {
  if (!isDatabaseConnected()) return;
  const pool = getPool();
  if (!pool) return;
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
  if (!isDatabaseConnected()) return 0;
  const pool = getPool();
  if (!pool) return 0;
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
 * Get stats for analytics.
 */
export async function getStats(guildId: string): Promise<StatsResult | null> {
  if (!isDatabaseConnected()) return null;
  const pool = getPool();
  if (!pool) return null;

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
  if (!isDatabaseConnected()) return [];
  const pool = getPool();
  if (!pool) return [];

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
 * Delete all data for a user in a guild — for /forgetme command.
 * Removes profile, memories, beefs, pair stats, quotes, interaction logs, reactions, and command usage.
 */
export async function deleteUserData(guildId: string, userId: string): Promise<{ deleted: boolean; tables: string[] }> {
  if (!isDatabaseConnected()) return { deleted: false, tables: [] };
  const pool = getPool();
  if (!pool) return { deleted: false, tables: [] };

  const deletedTables: string[] = [];
  try {
    await pool.query('BEGIN');

    const userResult = await pool.query('DELETE FROM users WHERE server_id = $1 AND user_id = $2', [guildId, userId]);
    if ((userResult.rowCount ?? 0) > 0) deletedTables.push('users');

    const vmResult = await pool.query('DELETE FROM vector_memories WHERE server_id = $1 AND user_id = $2', [guildId, userId]);
    if ((vmResult.rowCount ?? 0) > 0) deletedTables.push('vector_memories');

    const beefResult = await pool.query(
      'DELETE FROM beefs WHERE server_id = $1 AND (user1_id = $2 OR user2_id = $2)',
      [guildId, userId]
    );
    if ((beefResult.rowCount ?? 0) > 0) deletedTables.push('beefs');

    const pairResult = await pool.query(
      'DELETE FROM pair_interactions WHERE server_id = $1 AND (user1_id = $2 OR user2_id = $2)',
      [guildId, userId]
    );
    if ((pairResult.rowCount ?? 0) > 0) deletedTables.push('pair_interactions');

    const wqResult = await pool.query('DELETE FROM wild_quotes WHERE server_id = $1 AND user_id = $2', [guildId, userId]);
    if ((wqResult.rowCount ?? 0) > 0) deletedTables.push('wild_quotes');

    const interactionsResult = await pool.query(
      'DELETE FROM interactions WHERE server_id = $1 AND user_id = $2',
      [guildId, userId]
    );
    if ((interactionsResult.rowCount ?? 0) > 0) deletedTables.push('interactions');

    const reactionsResult = await pool.query(
      'DELETE FROM reactions WHERE server_id = $1 AND reactor_id = $2',
      [guildId, userId]
    );
    if ((reactionsResult.rowCount ?? 0) > 0) deletedTables.push('reactions');

    const commandUsageResult = await pool.query(
      'DELETE FROM command_usage WHERE server_id = $1 AND user_id = $2',
      [guildId, userId]
    );
    if ((commandUsageResult.rowCount ?? 0) > 0) deletedTables.push('command_usage');

    await pool.query('COMMIT');
    return { deleted: true, tables: deletedTables };
  } catch (err) {
    await pool.query('ROLLBACK').catch((rollbackErr) => {
      console.error('deleteUserData rollback failed:', (rollbackErr as Error).message);
    });
    console.error('deleteUserData failed:', (err as Error).message);
    return { deleted: false, tables: [] };
  }
}

/**
 * Get top reactions for Sass's messages — for /bestof command.
 */
export async function getTopReactions(guildId: string, limit = 5): Promise<Array<{ sassResponse: string; userMessage: string; username: string; reactionCount: number }>> {
  if (!isDatabaseConnected()) return [];
  const pool = getPool();
  if (!pool) return [];
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
