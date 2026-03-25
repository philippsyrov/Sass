/**
 * vectorMemory.ts — Guild-scoped vector memory backed by PostgreSQL
 *
 * Stores embeddings in Postgres REAL[] columns.
 * Cosine similarity computed in JS (dataset is small per guild+user).
 * No local SQLite — everything goes through Postgres.
 */

import OpenAI from 'openai';
import { getPool, isDatabaseConnected } from './database/index.js';
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
  return response.data[0]?.embedding ?? [];
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
