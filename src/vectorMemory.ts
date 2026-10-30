/**
 * vectorMemory.ts — Guild-scoped vector memory backed by PostgreSQL
 *
 * Stores embeddings in Postgres REAL[] columns.
 * Cosine similarity computed in JS (dataset is small per guild+user).
 * No local SQLite — everything goes through Postgres.
 */

import { getPool, isDatabaseConnected } from './database/index.js';
import { queryAI, getEmbeddingOpenAI } from './ai/providers.js';
import { UTILITY_SYSTEM_PROMPT } from './ai/prompts.js';
import { resolveEmbeddingOpenAIConfig } from './ai/clientConfig.js';
import type { MemoryType, SearchResult, MemoryRow } from './types.js';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { captureUserDataToken, withUserDataWrite } from './database/userDataGuard.js';
import { DISTILL_INTERVAL_MS, isValidDistilledProfile } from './memory/profilePolicy.js';

function embeddingProvider(): string {
  // An unset provider belongs to installations that used API embeddings before local setup existed.
  return process.env.SASS_EMBEDDING_PROVIDER?.trim().toLowerCase() || 'openai';
}

async function embed(text: string, purpose: 'query' | 'document' = 'document'): Promise<{ vector: number[]; space: string }> {
  const provider = embeddingProvider();
  if (provider === 'off') throw new Error('Memory search is disabled');
  if (provider === 'local') {
    const { embedLocally, localEmbeddingFingerprint } = await import('./embeddings/localEmbed.js');
    const vector = await embedLocally(text, purpose);
    return { vector, space: JSON.stringify(['local', localEmbeddingFingerprint(), vector.length]) };
  }
  if (provider !== 'openai' && provider !== 'ollama') throw new Error(`Unknown embedding provider: ${provider}`);
  const model = process.env.OPENAI_EMBEDDING_MODEL?.trim() || 'text-embedding-3-small';
  const response = await getEmbeddingOpenAI().embeddings.create({
    model,
    input: text,
  });
  const embedding = response.data[0]?.embedding;
  if (!embedding || embedding.length === 0) {
    throw new Error('Empty embedding response from OpenAI');
  }
  const baseURL = resolveEmbeddingOpenAIConfig().baseURL?.replace(/\/+$/, '') || 'https://api.openai.com/v1';
  return { vector: embedding, space: JSON.stringify([provider, baseURL, model, embedding.length]) };
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
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
  if (embeddingProvider() === 'off') return;
  if (!isDatabaseConnected()) return;
  const pool = getPool();
  if (!pool) return;

  try {
    const token = captureUserDataToken(guildId, userId);
    const { vector, space } = await embed(content);
    await withUserDataWrite(token, () => pool.query(
      `INSERT INTO vector_memories (server_id, user_id, type, content, embedding, embedding_space, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [guildId, userId, type, content, vector, space]
    ));
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
  if (embeddingProvider() === 'off') return [];
  if (!isDatabaseConnected()) return [];
  const pool = getPool();
  if (!pool) return [];

  try {
    const { vector: queryVector, space } = await embed(query, 'query');

    let rows: Array<{ content: string; type: string; user_id: string; embedding: number[]; embedding_space: string | null }>;
    if (userId) {
      const result = await pool.query(
        'SELECT content, type, user_id, embedding, embedding_space FROM vector_memories WHERE server_id = $1 AND user_id = $2',
        [guildId, userId]
      );
      rows = result.rows as typeof rows;
    } else {
      const result = await pool.query(
        'SELECT content, type, user_id, embedding, embedding_space FROM vector_memories WHERE server_id = $1',
        [guildId]
      );
      rows = result.rows as typeof rows;
    }

    if (rows.length === 0) return [];

    // Unknown legacy vectors stay available as raw memories, but their coordinate system is not known.
    const scored = rows.filter((row) => row.embedding_space === space && row.embedding.length === queryVector.length).map((row) => ({
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
const DEDUP_SIMILARITY_THRESHOLD = 0.85;
const MAX_ROASTS = 100;
const DEFAULT_TIMEOUT_MS = 120_000;
const REQUEST_TIMEOUT_MS = 30_000;

export interface DistillRunOptions { signal?: AbortSignal; timeoutMs?: number; maxProfiles?: number }
export interface DistillRunResult { status: 'completed' | 'skipped' | 'aborted' | 'failed' | 'limited'; attempts?: number; updated?: number; failures?: number }
interface DistillResult { deduped: number; pruned: number; capped: number }
interface Run { signal?: AbortSignal; deadline: number; maxProfiles: number; attempts: number; updated: number; failures: number; rotation: number; profileRotation: number }
class RunStopped extends Error { constructor(readonly status: 'aborted' | 'limited') { super(status); } }
function checkRun(run?: Run): void {
  if (run?.signal?.aborted) throw new RunStopped('aborted');
  if (run && Date.now() >= run.deadline) throw new RunStopped('limited');
}

// Pool acquisition can outlive a cancelled job. Release any client arriving late.
async function acquireClient(run?: Run): Promise<PoolClient> {
  const pool = getPool();
  if (!pool) throw new Error('Database unavailable');
  checkRun(run);
  if (!run) return pool.connect();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const pending = pool.connect();
  const stopped = new Promise<never>((_, reject) => {
    onAbort = () => reject(new RunStopped('aborted'));
    run.signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => reject(new RunStopped('limited')), Math.max(1, run.deadline - Date.now()));
    if (run.signal?.aborted) onAbort();
  });
  let client: PoolClient;
  try {
    client = await Promise.race([pending, stopped]);
  } catch (error) {
    void pending.then(late => late.release(), () => console.error('[DISTILL] Pending connection failed after cancellation'));
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) run.signal?.removeEventListener('abort', onAbort);
  }
  try { checkRun(run); } catch (error) { client.release(); throw error; }
  return client;
}

// Destroy a connection on interruption: a server-side timeout cannot help if
// the transport itself stalls. Closing it also rolls back an open transaction.
async function withClient<T>(run: Run | undefined, work: (client: PoolClient, discarded: () => boolean, discard: () => void) => Promise<T>): Promise<T> {
  const client = await acquireClient(run);
  let released = false;
  let destroyed = false;
  const release = (discard: boolean) => {
    if (!released) { released = true; destroyed = discard; client.release(discard); }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    checkRun(run);
    if (!run) return await work(client, () => destroyed, () => release(true));
    const stopped = new Promise<never>((_, reject) => {
      onAbort = () => { release(true); reject(new RunStopped('aborted')); };
      run.signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => { release(true); reject(new RunStopped('limited')); }, Math.max(1, run.deadline - Date.now()));
      if (run.signal?.aborted) onAbort();
    });
    checkRun(run);
    return await Promise.race([work(client, () => destroyed, () => release(true)), stopped]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) run?.signal?.removeEventListener('abort', onAbort);
    release(false);
  }
}

// Bound each SQL statement and lock wait by the remaining job time. The five
// second ceiling also gives shutdown a prompt cooperative cancellation point.
async function setQueryDeadline(client: PoolClient, run?: Run): Promise<void> {
  if (!run) return;
  checkRun(run);
  const milliseconds = Math.max(1, Math.min(5000, Math.floor(run.deadline - Date.now())));
  await client.query("SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $1, true)", [`${milliseconds}ms`]);
  checkRun(run);
}
async function runQuery<T extends QueryResultRow>(sql: string, params: unknown[], run?: Run): Promise<QueryResult<T>> {
  const pool = getPool();
  if (!pool) throw new Error('Database unavailable');
  if (!run) return pool.query<T>(sql, params);
  return withClient(run, async (client, discarded, discard) => {
    let began = false;
    try {
      checkRun(run);
      await client.query('BEGIN'); began = true;
      await setQueryDeadline(client, run);
      const result = await client.query<T>(sql, params);
      checkRun(run);
      await client.query('COMMIT'); began = false;
      return result;
    } catch (error) {
      if (began && !discarded()) try { await client.query('ROLLBACK'); } catch { discard(); console.error('[DISTILL] Rollback failed'); }
      checkRun(run);
      throw error;
    }
  });
}

// Each user has a short transaction. The transaction-scoped lock serializes only
// cleanup workers, never ordinary writes. OFFSET caps the actual snapshot, not a stale count.
async function cleanupGuild(guildId: string, run?: Run): Promise<DistillResult> {
  const pool = getPool();
  if (!isDatabaseConnected() || !pool) throw new Error('Database unavailable');
  const total: DistillResult = { deduped: 0, pruned: 0, capped: 0 };
  checkRun(run);
  const users = await runQuery<{ user_id: string }>('SELECT DISTINCT user_id FROM vector_memories WHERE server_id = $1 ORDER BY user_id', [guildId], run);
  for (const { user_id: userId } of users.rows) {
    checkRun(run);
    await withClient(run, async (client, discarded, discard) => {
    let began = false;
    try {
      checkRun(run);
      await client.query('BEGIN'); began = true;
      await setQueryDeadline(client, run);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [guildId, userId]);
      await setQueryDeadline(client, run);
      const rows = await client.query<{ id: number; embedding: number[]; embedding_space: string | null }>(
        `SELECT id, embedding, embedding_space FROM vector_memories WHERE server_id = $1 AND user_id = $2 AND type = 'roast' ORDER BY created_at DESC, id DESC`, [guildId, userId]);
      const duplicateIds: number[] = [];
      const kept: Array<{ id: number; embedding: number[]; embedding_space: string | null }> = [];
      for (const memory of rows.rows) {
        checkRun(run);
        let duplicate = false;
        for (const newer of kept) {
          checkRun(run);
          if (memory.embedding_space && memory.embedding_space === newer.embedding_space &&
              cosineSimilarity(memory.embedding, newer.embedding) > DEDUP_SIMILARITY_THRESHOLD) { duplicate = true; break; }
        }
        if (duplicate) duplicateIds.push(memory.id); else kept.push(memory);
      }
      if (duplicateIds.length) {
        await setQueryDeadline(client, run);
        const deleted = await client.query("DELETE FROM vector_memories WHERE server_id = $1 AND user_id = $2 AND type = 'roast' AND id = ANY($3::int[])", [guildId, userId, duplicateIds]);
        total.deduped += deleted.rowCount ?? 0;
      }
      await setQueryDeadline(client, run);
      const pruned = await client.query("DELETE FROM vector_memories WHERE server_id = $1 AND user_id = $2 AND type = 'roast' AND created_at < NOW() - INTERVAL '90 days'", [guildId, userId]);
      await setQueryDeadline(client, run);
      const capped = await client.query(`DELETE FROM vector_memories WHERE id IN (
        SELECT id FROM vector_memories WHERE server_id = $1 AND user_id = $2 AND type = 'roast'
        ORDER BY created_at DESC, id DESC OFFSET $3)`, [guildId, userId, MAX_ROASTS]);
      checkRun(run);
      await client.query('COMMIT'); began = false;
      total.pruned += pruned.rowCount ?? 0; total.capped += capped.rowCount ?? 0;
    } catch (error) {
      if (began && !discarded()) try { await client.query('ROLLBACK'); } catch { discard(); console.error('[DISTILL] Rollback failed'); }
      checkRun(run);
      throw error;
    }
    });
  }
  return total;
}

export async function distillMemories(guildId: string): Promise<DistillResult> {
  return cleanupGuild(guildId);
}

let running = false;
let previousSlot = -1;
let slotSequence = 0;
function nextRotation(): number {
  const slot = Math.floor(Date.now() / DISTILL_INTERVAL_MS);
  slotSequence = slot === previousSlot ? slotSequence + 1 : 0;
  previousSlot = slot;
  return slot + slotSequence;
}
function rotate<T>(items: T[], position: number): T[] {
  if (!items.length) return items;
  const offset = position % items.length;
  return items.slice(offset).concat(items.slice(0, offset));
}
export async function distillAllGuilds(options: DistillRunOptions = {}): Promise<DistillRunResult> {
  if (running) return { status: 'skipped' };
  running = true;
  const rotation = nextRotation();
  const run: Run = { signal: options.signal, deadline: Date.now() + Math.max(0, options.timeoutMs ?? DEFAULT_TIMEOUT_MS), maxProfiles: Math.max(0, Math.floor(options.maxProfiles ?? 25)), attempts: 0, updated: 0, failures: 0, rotation, profileRotation: rotation };
  let status: DistillRunResult['status'] = 'completed';
  console.log('[DISTILL] Starting memory distillation');
  try {
    checkRun(run);
    const pool = getPool();
    if (!isDatabaseConnected() || !pool) throw new Error('Database unavailable');
    const guilds = await runQuery<{ server_id: string }>('SELECT DISTINCT server_id FROM vector_memories ORDER BY server_id', [], run);
    run.profileRotation = Math.floor(run.rotation / Math.max(1, guilds.rows.length));
    for (const { server_id: guildId } of rotate(guilds.rows, run.rotation)) {
      checkRun(run);
      await cleanupGuild(guildId, run);
      await refreshGuild(guildId, run);
    }
    checkRun(run);
    if (run.failures) status = 'failed';
  } catch (error) {
    status = error instanceof RunStopped ? error.status : 'failed';
  } finally {
    running = false;
    console.log(`[DISTILL] Finished: ${status}; ${run.attempts} attempted, ${run.updated} updated, ${run.failures} failed`);
  }
  return { status, attempts: run.attempts, updated: run.updated, failures: run.failures };
}

async function generateProfile(guildId: string, userId: string, run?: Run): Promise<string | null> {
  const pool = getPool();
  if (!isDatabaseConnected() || !pool) throw new Error('Database unavailable');
  checkRun(run);
  const token = captureUserDataToken(guildId, userId);
  const userResult = await runQuery(`SELECT name, facts, roasts, message_count, times_roasted, gender, affinity
    FROM users WHERE server_id = $1 AND user_id = $2`, [guildId, userId], run);
  checkRun(run);
  const user = userResult.rows[0] as { name: string; facts: string[] | null; roasts: string[] | null; message_count: number; times_roasted: number; gender: string | null; affinity: number } | undefined;
  if (!user?.name) return null;
  const memories = await runQuery<{ id: number; content: string; type: string }>(`SELECT id, content, type FROM vector_memories WHERE server_id = $1 AND user_id = $2 ORDER BY created_at DESC, id DESC LIMIT 10`, [guildId, userId], run);
  checkRun(run);
  const parts = ["Compress this user data into ONE sentence (max 30 words) for a Discord bot's memory.", 'Include: key traits, notable facts, roast ammo, relationship. Be factual, no sass.', `Name: ${user.name}`];
  if (user.gender) parts.push(`Gender: ${user.gender}`);
  const affinityTier = user.affinity >= 80 ? 'close friend' : user.affinity >= 60 ? 'liked' : user.affinity >= 40 ? 'neutral' : user.affinity >= 20 ? 'cold' : 'enemy';
  parts.push(`Affinity: ${Math.round(user.affinity)}% (${affinityTier})`, `Messages: ${user.message_count ?? 0}, Times roasted: ${user.times_roasted ?? 0}`);
  if (user.facts?.length) parts.push(`Facts: ${user.facts.join(', ')}`);
  if (user.roasts?.length) parts.push(`Recent roast topics: ${user.roasts.join(', ')}`);
  if (memories.rows.length) parts.push(`Recent memories: ${memories.rows.map(m => `[${m.type}] ${m.content}`).join(', ')}`);
  const timeout = Math.max(1, Math.min(REQUEST_TIMEOUT_MS, run ? run.deadline - Date.now() : REQUEST_TIMEOUT_MS));
  const controller = new AbortController();
  const saveRun: Run = run
    ? { ...run, signal: controller.signal, deadline: Math.min(run.deadline, Date.now() + timeout) }
    : { signal: controller.signal, deadline: Date.now() + timeout, maxProfiles: 1, attempts: 0, updated: 0, failures: 0, rotation: 0, profileRotation: 0 };
  const abort = () => controller.abort();
  run?.signal?.addEventListener('abort', abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { reject(run && Date.now() >= run.deadline ? new RunStopped('limited') : new Error('Profile request timed out')); controller.abort(); }, timeout);
      controller.signal.addEventListener('abort', () => reject(new RunStopped(run?.signal?.aborted ? 'aborted' : 'limited')), { once: true });
    });
    const profile = await Promise.race([queryAI(parts.join('\n'), { systemPrompt: UTILITY_SYSTEM_PROMPT, maxTokens: 50, temperature: 0.3, signal: controller.signal, timeoutMs: timeout }), timeoutPromise]);
    checkRun(run);
    if (!isValidDistilledProfile(profile)) throw new Error('Invalid profile response');
    const text = profile.trim();
    // Never recreate a deleted user from stale source data.
    const save = withUserDataWrite(token, () => {
      checkRun(run);
      if (controller.signal.aborted) throw new Error('Profile request timed out');
      return runQuery(`UPDATE users SET distilled_profile = $3, profile_updated_at = NOW()
        WHERE server_id = $1 AND user_id = $2
        AND ROW(name, facts, roasts, message_count, times_roasted, gender, affinity)
          IS NOT DISTINCT FROM ROW($4::text, $5::text[], $6::text[], $7::integer, $8::integer, $9::text, $10::real)
        AND ARRAY(SELECT id FROM vector_memories WHERE server_id = $1 AND user_id = $2
          ORDER BY created_at DESC, id DESC LIMIT 10) = $11::int[]`,
      [guildId, userId, text, user.name, user.facts, user.roasts, user.message_count, user.times_roasted, user.gender, user.affinity, memories.rows.map(m => m.id)], saveRun);
    });
    const saved = await Promise.race([save, timeoutPromise]);
    return saved?.rowCount ? text : null;
  } finally {
    if (timer) clearTimeout(timer);
    run?.signal?.removeEventListener('abort', abort);
  }
}

export async function distillUserProfile(guildId: string, userId: string): Promise<string | null> {
  try { return await generateProfile(guildId, userId); }
  catch { console.error('[DISTILL] Profile generation failed'); return null; }
}

async function refreshGuild(guildId: string, run: Run): Promise<void> {
  const pool = getPool();
  if (!pool) throw new Error('Database unavailable');
  checkRun(run);
  const users = await runQuery<{ user_id: string }>(`SELECT user_id FROM users WHERE server_id = $1 AND (profile_updated_at IS NULL OR profile_updated_at < NOW() - INTERVAL '6 hours') ORDER BY user_id`, [guildId], run);
  for (const { user_id: userId } of rotate(users.rows, run.profileRotation)) {
    checkRun(run);
    if (run.attempts >= run.maxProfiles) throw new RunStopped('limited');
    run.attempts++;
    try {
      if (await generateProfile(guildId, userId, run)) run.updated++;
      else run.failures++;
    } catch (error) {
      if (error instanceof RunStopped) throw error;
      run.failures++;
    }
  }
}
export async function distillGuildProfiles(guildId: string): Promise<number> {
  const rotation = nextRotation();
  const run: Run = { deadline: Date.now() + DEFAULT_TIMEOUT_MS, maxProfiles: 25, attempts: 0, updated: 0, failures: 0, rotation, profileRotation: rotation };
  try { await refreshGuild(guildId, run); } catch { console.error('[DISTILL] Guild profile distillation failed'); }
  return run.updated;
}
