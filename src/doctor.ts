import { existsSync, readFileSync } from 'fs';
import dotenv from 'dotenv';
import pg from 'pg';
import { describeApiEndpoint, resolveChatOpenAIConfig } from './ai/clientConfig.js';
import { checkEmbeddingHealth } from './embeddings/health.js';
import { ensureEmbeddedPostgresRunning, isEmbeddedPostgresEnabled, stopEmbeddedPostgres } from './database/embeddedPostgres.js';

if (existsSync('.env')) {
  const parsed = dotenv.parse(readFileSync('.env'));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] == null) {
      process.env[key] = value;
    }
  }
}

const { Pool } = pg;

const REQUIRED_VARS = ['DISCORD_TOKEN', 'CLIENT_ID', 'CREATOR_ID', 'AI_PROVIDER'] as const;

// Values copied straight from .env.example look like "your_..._here".
function isPlaceholder(value: string | undefined): boolean {
  return value != null && /^your_.*_here$/i.test(value.trim());
}

function realValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && !isPlaceholder(value) ? value : undefined;
}

function varDetail(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) return 'not set';
  if (isPlaceholder(value)) return 'still the placeholder from .env.example';
  return 'set';
}

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
    return { connected: false, pool: null, detail: 'DATABASE_URL not set (optional; memory and persistence are off)' };
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

  let missing = 0;
  for (const envVar of REQUIRED_VARS) {
    const ok = Boolean(realValue(envVar));
    if (!ok) missing++;
    console.log(formatStatus(ok, envVar, varDetail(envVar)));
  }

  const provider = realValue('AI_PROVIDER')?.toLowerCase();
  if (provider === 'openai') {
    const chatCfg = resolveChatOpenAIConfig();
    const chatHost = describeApiEndpoint(chatCfg.baseURL, 'api.openai.com');
    const ok = Boolean(chatCfg.apiKey);
    if (!ok) missing++;
    console.log(formatStatus(ok, 'Chat API', `${chatHost} · key ${varDetail('OPENAI_API_KEY')}`));
    console.log(formatStatus(Boolean(realValue('OPENAI_MODEL')), 'OPENAI_MODEL', process.env.OPENAI_MODEL || 'not set'));
  } else if (provider === 'ollama') {
    console.log(formatStatus(true, 'Chat (Ollama)', `${process.env.OLLAMA_HOST || 'http://localhost:11434'} · ${process.env.OLLAMA_MODEL || 'default'}`));
  } else if (provider) {
    missing++;
    console.log(formatStatus(false, 'AI_PROVIDER', `"${provider}" is not "openai" or "ollama"`));
  }

  let databaseUrl = realValue('DATABASE_URL');
  if (isEmbeddedPostgresEnabled()) {
    try {
      databaseUrl = await ensureEmbeddedPostgresRunning();
    } catch (err) {
      console.log(formatStatus(false, 'Database', `local embedded: ${(err as Error).message}`));
      databaseUrl = undefined;
    }
  }
  const db = await checkDatabase(databaseUrl);
  const dbLabel = isEmbeddedPostgresEnabled() && db.connected ? 'Database (local embedded)' : 'Database';
  console.log(formatStatus(db.connected, dbLabel, isEmbeddedPostgresEnabled() && db.connected ? 'connected (.sass-data/)' : db.detail));

  const embeddings = await checkEmbeddingHealth();
  console.log(formatStatus(embeddings.ok, 'Embeddings', embeddings.detail));

  const schema = await checkSchema(db.pool);
  console.log(formatStatus(schema.presentCount === REQUIRED_TABLES.length, 'Tables', schema.detail));

  const stats = await getStats(db.pool);
  console.log(`📊 Stats: ${stats}`);

  await db.pool?.end().catch((err) => {
    console.error('Doctor pool shutdown failed:', (err as Error).message);
  });
  if (isEmbeddedPostgresEnabled()) {
    await stopEmbeddedPostgres();
  }

  if (missing > 0) {
    console.log(`\n${missing} required setting(s) still need a real value in .env.`);
    process.exitCode = 1;
  }
}

void main().catch((err) => {
  console.error('Doctor failed:', (err as Error).message);
  process.exitCode = 1;
});
