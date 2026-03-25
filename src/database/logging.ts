/**
 * logging.ts — Interaction, mood, command, and reaction logging
 *
 * All functions fail silently if the database is not connected.
 */

import { isDatabaseConnected, getPool } from './pool.js';
import type { InteractionLog, MoodLog, CommandLog, ReactionLog } from '../types.js';

/**
 * Log an interaction (roast, reply, auto-sass, command response).
 */
export async function logInteraction({
  serverId, serverName, channelId, channelName,
  userId, username, triggerType, commandName,
  userMessage, sassResponse, mood, moodIntensity, context,
}: InteractionLog): Promise<void> {
  if (!isDatabaseConnected()) return;
  const pool = getPool();
  if (!pool) return;

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
  if (!isDatabaseConnected()) return;
  const pool = getPool();
  if (!pool) return;

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
  if (!isDatabaseConnected()) return;
  const pool = getPool();
  if (!pool) return;

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
 * Log a reaction on a Sass message.
 */
export async function logReaction({
  serverId, channelId, messageId, sassResponse,
  reactorId, reactorName, emoji, emojiId, isPositive,
}: ReactionLog): Promise<void> {
  if (!isDatabaseConnected()) return;
  const pool = getPool();
  if (!pool) return;

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
