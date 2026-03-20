import Database from 'better-sqlite3';
import OpenAI from 'openai';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'data', 'vector-memory.db');

let db;

function getDb() {
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

let openaiClient;
function getOpenAI() {
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openaiClient;
}

async function embed(text) {
  const response = await getOpenAI().embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return response.data[0].embedding;
}

function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Store a memory with its vector embedding.
 * @param {string} userId
 * @param {string} type - 'roast', 'fact', 'quote'
 * @param {string} content - the text to remember
 */
export async function storeMemory(userId, type, content) {
  try {
    const vector = await embed(content);
    const database = getDb();
    database.prepare(
      'INSERT INTO memories (userId, type, content, embedding, createdAt) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, type, content, JSON.stringify(vector), Date.now());
  } catch (err) {
    console.error('Vector memory store failed:', err.message);
  }
}

/**
 * Search for the most relevant memories given a query.
 * @param {string} query - the incoming message to match against
 * @param {string} userId - optional, filter to a specific user
 * @param {number} limit - max results
 * @returns {Array<{content: string, type: string, score: number, userId: string}>}
 */
export async function searchMemories(query, { userId = null, limit = 3 } = {}) {
  try {
    const queryVector = await embed(query);
    const database = getDb();

    let rows;
    if (userId) {
      rows = database.prepare('SELECT * FROM memories WHERE userId = ?').all(userId);
    } else {
      rows = database.prepare('SELECT * FROM memories').all();
    }

    if (rows.length === 0) return [];

    const scored = rows.map((row) => ({
      content: row.content,
      type: row.type,
      userId: row.userId,
      score: cosineSimilarity(queryVector, JSON.parse(row.embedding)),
    }));

    return scored
      .sort((a, b) => b.score - a.score)
      .filter((r) => r.score > 0.3)
      .slice(0, limit);
  } catch (err) {
    console.error('Vector memory search failed:', err.message);
    return [];
  }
}

/**
 * Get all memories for a user (for context building).
 */
export function getUserMemories(userId) {
  try {
    const database = getDb();
    return database.prepare('SELECT content, type FROM memories WHERE userId = ? ORDER BY createdAt DESC LIMIT 20').all(userId);
  } catch {
    return [];
  }
}
