/**
 * vectorMemory.ts — Guild-scoped vector memory backed by PostgreSQL
 *
 * Stores embeddings in Postgres REAL[] columns.
 * Cosine similarity computed in JS (dataset is small per guild+user).
 * No local SQLite — everything goes through Postgres.
 */

import OpenAI from 'openai';
import { getPool, isDatabaseConnected } from './database/index.js';
import { queryAI } from './ai/providers.js';
import { UTILITY_SYSTEM_PROMPT } from './ai/prompts.js';
import type { MemoryType, SearchResult, MemoryRow } from './types.js';

let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openaiClient;
}

async function embed(text: string): Promise<number[]> {
  const response = await getOpenAI().embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  const embedding = response.data[0]?.embedding;
  if (!embedding || embedding.length === 0) {
    throw new Error('Empty embedding response from OpenAI');
  }
  return embedding;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    magA += ai * ai;
    magB += bi * bi;
  }
  const magnitude = Math.sqrt(magA) * Math.sqrt(magB);
  if (magnitude === 0) return 0;
  return dot / magnitude;
}

/**
 * Store a memory with its vector embedding. Guild-scoped.
 */
export async function storeMemory(guildId: string, userId: string, type: MemoryType, content: string): Promise<void> {
  if (!isDatabaseConnected()) return;
  const pool = getPool();
  if (!pool) return;

  try {
    const vector = await embed(content);
    await pool.query(
      `INSERT INTO vector_memories (server_id, user_id, type, content, embedding, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [guildId, userId, type, content, vector]
    );
  } catch (err) {
    console.error('Vector memory store failed:', (err as Error).message);
  }
}

/**
 * Search for the most relevant memories given a query. Guild-scoped.
 */
export async function searchMemories(
  query: string,
  { guildId, userId = null, limit = 3 }: { guildId: string; userId?: string | null; limit?: number }
): Promise<SearchResult[]> {
  if (!isDatabaseConnected()) return [];
  const pool = getPool();
  if (!pool) return [];

  try {
    const queryVector = await embed(query);

    let rows: Array<{ content: string; type: string; user_id: string; embedding: number[] }>;
    if (userId) {
      const result = await pool.query(
        'SELECT content, type, user_id, embedding FROM vector_memories WHERE server_id = $1 AND user_id = $2',
        [guildId, userId]
      );
      rows = result.rows as typeof rows;
    } else {
      const result = await pool.query(
        'SELECT content, type, user_id, embedding FROM vector_memories WHERE server_id = $1',
        [guildId]
      );
      rows = result.rows as typeof rows;
    }

    if (rows.length === 0) return [];

    const scored = rows.map((row) => ({
      content: row.content,
      type: row.type,
      userId: row.user_id,
      score: cosineSimilarity(queryVector, row.embedding),
    }));

    return scored
      .sort((a, b) => b.score - a.score)
      .filter((r) => r.score > 0.3)
      .slice(0, limit);
  } catch (err) {
    console.error('Vector memory search failed:', (err as Error).message);
    return [];
  }
}

/**
 * Get all memories for a user in a guild (for context building).
 */
export async function getUserMemories(guildId: string, userId: string): Promise<MemoryRow[]> {
  if (!isDatabaseConnected()) return [];
  const pool = getPool();
  if (!pool) return [];

  try {
    const result = await pool.query(
      'SELECT content, type FROM vector_memories WHERE server_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 20',
      [guildId, userId]
    );
    return result.rows as MemoryRow[];
  } catch (err) {
    console.error('getUserMemories failed:', (err as Error).message);
    return [];
  }
}

// --- Memory Distillation ---
// Inspired by Claude Code's "Dream" system: periodic dedup, prune, and cap.

const DEDUP_SIMILARITY_THRESHOLD = 0.85;
const MAX_MEMORIES_PER_USER = 100;
const PRUNE_AGE_DAYS = 90;

interface DistillResult {
  deduped: number;
  pruned: number;
  capped: number;
}

/**
 * Distill memories for a single guild: deduplicate similar entries,
 * prune old roast topics, and cap total memories per user.
 */
export async function distillMemories(guildId: string): Promise<DistillResult> {
  const result: DistillResult = { deduped: 0, pruned: 0, capped: 0 };
  if (!isDatabaseConnected()) return result;
  const pool = getPool();
  if (!pool) return result;

  try {
    // Get all users with memories in this guild
    const usersResult = await pool.query(
      'SELECT DISTINCT user_id FROM vector_memories WHERE server_id = $1',
      [guildId]
    );
    const userIds = (usersResult.rows as Array<{ user_id: string }>).map((r) => r.user_id);

    for (const userId of userIds) {
      // Step 1: Dedup — find near-duplicate memories and remove the older one
      const memoriesResult = await pool.query(
        'SELECT id, embedding, created_at FROM vector_memories WHERE server_id = $1 AND user_id = $2 ORDER BY created_at ASC',
        [guildId, userId]
      );
      const memories = memoriesResult.rows as Array<{ id: number; embedding: number[]; created_at: Date }>;
      const duplicateIds: number[] = [];
      const removed = new Set<number>();

      for (let i = 0; i < memories.length; i++) {
        const memI = memories[i];
        if (!memI || removed.has(memI.id)) continue;
        for (let j = i + 1; j < memories.length; j++) {
          const memJ = memories[j];
          if (!memJ || removed.has(memJ.id)) continue;
          const similarity = cosineSimilarity(memI.embedding, memJ.embedding);
          if (similarity > DEDUP_SIMILARITY_THRESHOLD) {
            // Keep the newer one (j), remove the older one (i)
            duplicateIds.push(memI.id);
            removed.add(memI.id);
            break; // This older memory is already marked, move on
          }
        }
      }

      if (duplicateIds.length > 0) {
        await pool.query(
          'DELETE FROM vector_memories WHERE id = ANY($1::int[])',
          [duplicateIds]
        );
        result.deduped += duplicateIds.length;
      }

      // Step 2: Prune — delete old roast-type memories (facts/statements/quotes kept indefinitely)
      const pruneResult = await pool.query(
        `DELETE FROM vector_memories
         WHERE server_id = $1 AND user_id = $2 AND type = 'roast'
         AND created_at < NOW() - INTERVAL '${PRUNE_AGE_DAYS} days'`,
        [guildId, userId]
      );
      result.pruned += pruneResult.rowCount ?? 0;

      // Step 3: Cap — enforce max memories per user
      const countResult = await pool.query(
        'SELECT COUNT(*) as count FROM vector_memories WHERE server_id = $1 AND user_id = $2',
        [guildId, userId]
      );
      const count = parseInt((countResult.rows[0] as { count: string })?.count ?? '0', 10);

      if (count > MAX_MEMORIES_PER_USER) {
        const excess = count - MAX_MEMORIES_PER_USER;
        await pool.query(
          `DELETE FROM vector_memories WHERE id IN (
            SELECT id FROM vector_memories
            WHERE server_id = $1 AND user_id = $2
            ORDER BY created_at ASC
            LIMIT $3
          )`,
          [guildId, userId, excess]
        );
        result.capped += excess;
      }
    }
  } catch (err) {
    console.error('[DISTILL] Guild distillation failed:', (err as Error).message);
  }

  return result;
}

/**
 * Run distillation across all guilds with vector memories.
 * Processes guilds sequentially to avoid overwhelming the DB.
 */
export async function distillAllGuilds(): Promise<void> {
  if (!isDatabaseConnected()) return;
  const pool = getPool();
  if (!pool) return;

  console.log('[DISTILL] Starting memory distillation...');
  const startTime = Date.now();

  try {
    const guildsResult = await pool.query('SELECT DISTINCT server_id FROM vector_memories');
    const guildIds = (guildsResult.rows as Array<{ server_id: string }>).map((r) => r.server_id);

    let totalDeduped = 0;
    let totalPruned = 0;
    let totalCapped = 0;
    let totalProfiles = 0;

    for (const guildId of guildIds) {
      const result = await distillMemories(guildId);
      totalDeduped += result.deduped;
      totalPruned += result.pruned;
      totalCapped += result.capped;

      // Distill user profiles after memory cleanup
      const profiles = await distillGuildProfiles(guildId);
      totalProfiles += profiles;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[DISTILL] Done in ${elapsed}s — ${guildIds.length} guilds, ${totalDeduped} deduped, ${totalPruned} pruned, ${totalCapped} capped, ${totalProfiles} profiles updated`);
  } catch (err) {
    console.error('[DISTILL] Full distillation failed:', (err as Error).message);
  }
}

// --- Per-User Distilled Profiles ---
// Generates a compact 1-2 sentence AI summary of each user for cheaper, more coherent context.

/**
 * Generate a distilled profile for a single user in a guild.
 * Compresses facts, roast history, memories, and stats into one sentence.
 */
export async function distillUserProfile(guildId: string, userId: string): Promise<string | null> {
  if (!isDatabaseConnected()) return null;
  const pool = getPool();
  if (!pool) return null;

  try {
    // Fetch user data
    const userResult = await pool.query(
      `SELECT name, facts, roasts, message_count, times_roasted, gender, affinity
       FROM users WHERE server_id = $1 AND user_id = $2`,
      [guildId, userId]
    );
    const user = userResult.rows[0] as {
      name: string; facts: string[] | null; roasts: string[] | null;
      message_count: number; times_roasted: number; gender: string | null; affinity: number;
    } | undefined;
    if (!user?.name) return null;

    // Fetch recent vector memories
    const memoriesResult = await pool.query(
      `SELECT content, type FROM vector_memories
       WHERE server_id = $1 AND user_id = $2
       ORDER BY created_at DESC LIMIT 10`,
      [guildId, userId]
    );
    const memories = memoriesResult.rows as Array<{ content: string; type: string }>;

    // Build the distillation prompt
    const affinityTier = user.affinity >= 80 ? 'close friend'
      : user.affinity >= 60 ? 'liked'
      : user.affinity >= 40 ? 'neutral'
      : user.affinity >= 20 ? 'cold'
      : 'enemy';

    const parts: string[] = [
      `Compress this user data into ONE sentence (max 30 words) for a Discord bot's memory.`,
      `Include: key traits, notable facts, roast ammo, relationship. Be factual, no sass.`,
      ``,
      `Name: ${user.name}`,
    ];
    if (user.gender) parts.push(`Gender: ${user.gender}`);
    parts.push(`Affinity: ${Math.round(user.affinity)}% (${affinityTier})`);
    parts.push(`Messages: ${user.message_count ?? 0}, Times roasted: ${user.times_roasted ?? 0}`);
    if (user.facts?.length) parts.push(`Facts: ${user.facts.join(', ')}`);
    if (user.roasts?.length) parts.push(`Recent roast topics: ${user.roasts.join(', ')}`);
    if (memories.length > 0) {
      const memLines = memories.map((m) => `[${m.type}] ${m.content}`).join(', ');
      parts.push(`Recent memories: ${memLines}`);
    }

    const profile = await queryAI(parts.join('\n'), {
      systemPrompt: UTILITY_SYSTEM_PROMPT,
      maxTokens: 50,
      temperature: 0.3,
    });

    if (!profile) return null;

    // Store in DB — upsert to handle edge case where row was deleted between read and write
    await pool.query(
      `INSERT INTO users (server_id, user_id, name, distilled_profile, profile_updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (server_id, user_id) DO UPDATE SET
         distilled_profile = $4,
         profile_updated_at = NOW()`,
      [guildId, userId, user.name, profile.trim()]
    );

    return profile.trim();
  } catch (err) {
    console.error(`[DISTILL] Profile generation failed for ${userId}:`, (err as Error).message);
    return null;
  }
}

/**
 * Distill profiles for all users in a guild.
 * Skips users whose profiles are still fresh (< 6h old).
 */
export async function distillGuildProfiles(guildId: string): Promise<number> {
  if (!isDatabaseConnected()) return 0;
  const pool = getPool();
  if (!pool) return 0;

  let updated = 0;
  try {
    // Fetch users who need profile refresh
    const usersResult = await pool.query(
      `SELECT user_id FROM users
       WHERE server_id = $1
       AND (profile_updated_at IS NULL OR profile_updated_at < NOW() - INTERVAL '6 hours')`,
      [guildId]
    );
    const userIds = (usersResult.rows as Array<{ user_id: string }>).map((r) => r.user_id);

    for (const userId of userIds) {
      const profile = await distillUserProfile(guildId, userId);
      if (profile) {
        updated++;
        console.log(`[DISTILL] Profile updated for ${userId}`);
      }
    }
  } catch (err) {
    console.error('[DISTILL] Guild profile distillation failed:', (err as Error).message);
  }

  return updated;
}
