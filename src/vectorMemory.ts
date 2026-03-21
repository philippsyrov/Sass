import Database from 'better-sqlite3';
import OpenAI from 'openai';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { MemoryType, SearchResult, MemoryRow } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'data', 'vector-memory.db');

let db: Database.Database | null = null;

interface MemoryDbRow {
  id: number;
  userId: string;
  type: string;
  content: string;
  embedding: string;
  createdAt: number;
}

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding TEXT NOT NULL,
        createdAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memories_userId ON memories(userId);
    `);
  }
  return db;
}

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
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Store a memory with its vector embedding.
 */
export async function storeMemory(userId: string, type: MemoryType, content: string): Promise<void> {
  try {
    const vector = await embed(content);
    const database = getDb();
    database.prepare(
      'INSERT INTO memories (userId, type, content, embedding, createdAt) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, type, content, JSON.stringify(vector), Date.now());
  } catch (err) {
    console.error('Vector memory store failed:', (err as Error).message);
  }
}

/**
 * Search for the most relevant memories given a query.
 */
export async function searchMemories(
  query: string,
  { userId = null, limit = 3 }: { userId?: string | null; limit?: number } = {}
): Promise<SearchResult[]> {
  try {
    const queryVector = await embed(query);
    const database = getDb();

    let rows: MemoryDbRow[];
    if (userId) {
      rows = database.prepare('SELECT * FROM memories WHERE userId = ?').all(userId) as MemoryDbRow[];
    } else {
      rows = database.prepare('SELECT * FROM memories').all() as MemoryDbRow[];
    }

    if (rows.length === 0) return [];

    const scored = rows.map((row) => ({
      content: row.content,
      type: row.type,
      userId: row.userId,
      score: cosineSimilarity(queryVector, JSON.parse(row.embedding) as number[]),
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
 * Get all memories for a user (for context building).
 */
export function getUserMemories(userId: string): MemoryRow[] {
  try {
    const database = getDb();
    return database.prepare('SELECT content, type FROM memories WHERE userId = ? ORDER BY createdAt DESC LIMIT 20').all(userId) as MemoryRow[];
  } catch (_err) {
    return [];
  }
}
