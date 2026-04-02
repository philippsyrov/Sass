import { existsSync, readFileSync } from 'fs';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import pg from 'pg';

if (existsSync('.env')) {
  const parsed = dotenv.parse(readFileSync('.env'));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] == null) {
      process.env[key] = value;
    }
  }
}

const { Pool } = pg;

const REQUIRED_VARS = [
  'DISCORD_TOKEN',
  'CLIENT_ID',
  'AI_PROVIDER',
  'OPENAI_API_KEY',
  'DATABASE_URL',
  'CREATOR_ID',
] as const;

const REQUIRED_TABLES = [
  'users',
  'vector_memories',
  'interactions',
  'beefs',
  'wild_quotes',
  'mood_state',
] as const;

function formatStatus(ok: boolean, label: string, detail: string): string {
  return `${ok ? '✅' : '⚠️ '} ${label}: ${detail}`;
}

async function checkDatabase(url: string | undefined): Promise<{
  connected: boolean;
  pool: InstanceType<typeof Pool> | null;
  detail: string;
}> {
  if (!url) {
    return { connected: false, pool: null, detail: 'missing DATABASE_URL' };
  }

  try {
    const pool = new Pool({
      connectionString: url,
      max: 1,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
    });
    await pool.query('SELECT 1');
    return { connected: true, pool, detail: 'connected' };
  } catch (err) {
    return { connected: false, pool: null, detail: (err as Error).message };
  }
}

async function checkEmbeddings(): Promise<{ ok: boolean; detail: string }> {
  if (!process.env.OPENAI_API_KEY) {
    return { ok: false, detail: 'missing OPENAI_API_KEY' };
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    await client.embeddings.create({
      model: 'text-embedding-3-small',
      input: 'test',
    });
    return { ok: true, detail: 'working' };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}

async function checkSchema(pool: InstanceType<typeof Pool> | null): Promise<{
  presentCount: number;
  detail: string;
}> {
  if (!pool) {
    return { presentCount: 0, detail: '0/6 present (database unavailable)' };
  }

  try {
    const result = await pool.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [REQUIRED_TABLES]
    );
    const present = new Set((result.rows as Array<{ table_name: string }>).map((row) => row.table_name));
    const presentCount = REQUIRED_TABLES.filter((name) => present.has(name)).length;
    return { presentCount, detail: `${presentCount}/${REQUIRED_TABLES.length} present` };
  } catch (err) {
    return { presentCount: 0, detail: (err as Error).message };
  }
}

async function getStats(pool: InstanceType<typeof Pool> | null): Promise<string> {
  if (!pool) {
    return 'database unavailable';
  }

  try {
    const [memories, users, interactions] = await Promise.all([
      pool.query('SELECT COUNT(*) AS count FROM vector_memories'),
      pool.query('SELECT COUNT(*) AS count FROM users'),
      pool.query('SELECT COUNT(*) AS count FROM interactions'),
    ]);
    const memoryCount = Number((memories.rows[0] as { count: string } | undefined)?.count ?? '0');
    const userCount = Number((users.rows[0] as { count: string } | undefined)?.count ?? '0');
    const interactionCount = Number((interactions.rows[0] as { count: string } | undefined)?.count ?? '0');
    return `${memoryCount.toLocaleString()} memories, ${userCount.toLocaleString()} users, ${interactionCount.toLocaleString()} interactions`;
  } catch (err) {
    return (err as Error).message;
  }
}

async function main(): Promise<void> {
  console.log('Sass Doctor');
  console.log('═══════════════════════════════');

  for (const envVar of REQUIRED_VARS) {
    const value = process.env[envVar];
    if (envVar === 'CLIENT_ID') {
      if (!value) {
        console.log(formatStatus(false, envVar, 'not set'));
      } else if (value === '1000000000000000013') {
        console.log(formatStatus(true, envVar, 'set (staging)'));
      } else {
        console.log(formatStatus(true, envVar, 'set (production)'));
      }
      continue;
    }
    console.log(formatStatus(Boolean(value), envVar, value ? 'set' : 'not set'));
  }

  const environment = process.env.CLIENT_ID === '1000000000000000013' ? 'STAGING' : 'PRODUCTION';
  console.log(`Environment: ${environment}`);

  const db = await checkDatabase(process.env.DATABASE_URL);
  console.log(formatStatus(db.connected, 'Database', db.detail));

  const embeddings = await checkEmbeddings();
  console.log(formatStatus(embeddings.ok, 'Embeddings', embeddings.detail));

  const schema = await checkSchema(db.pool);
  console.log(formatStatus(schema.presentCount === REQUIRED_TABLES.length, 'Tables', schema.detail));

  const stats = await getStats(db.pool);
  console.log(`📊 Stats: ${stats}`);

  await db.pool?.end().catch((err) => {
    console.error('Doctor pool shutdown failed:', (err as Error).message);
  });
}

void main().catch((err) => {
  console.error('Doctor failed:', (err as Error).message);
  process.exitCode = 1;
});
