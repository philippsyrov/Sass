import { getPool } from './pool.js';
import type { PoolClient } from 'pg';

const JOB = 'memory-distillation';

async function queryState<T>(signal: AbortSignal | undefined, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = getPool();
  if (!pool) throw new Error('Database unavailable');
  signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(new Error('Maintenance state operation stopped'));
  const timeout = setTimeout(abort, 5_000);
  signal?.addEventListener('abort', abort, { once: true });
  let client: PoolClient | undefined;
  let released = false;
  const release = (failed = false) => {
    if (client && !released) { released = true; client.release(failed); }
  };
  let stop!: () => void;
  const interrupted = new Promise<never>((_, reject) => {
    stop = () => { release(true); reject(new Error('Maintenance state operation stopped')); };
    controller.signal.addEventListener('abort', stop, { once: true });
  });
  try {
    const acquired = pool.connect().then(connection => {
      if (controller.signal.aborted) { connection.release(true); throw new Error('Maintenance state operation stopped'); }
      client = connection;
      return connection;
    });
    const connection = await Promise.race([acquired, interrupted]);
    controller.signal.throwIfAborted();
    return await Promise.race([work(connection), interrupted]);
  } catch (error) { release(true); throw error; }
  finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', stop);
    release();
  }
}

export async function lastDistillationRun(signal?: AbortSignal): Promise<number | null> {
  const result = await queryState(signal, client => client.query<{ started_at: Date }>(
    'SELECT started_at FROM maintenance_state WHERE job_name = $1', [JOB],
  ));
  const value = result.rows[0]?.started_at;
  return value ? new Date(value).getTime() : null;
}

export async function recordDistillationRun(time: number, signal?: AbortSignal): Promise<void> {
  await queryState(signal, client => client.query(
    `INSERT INTO maintenance_state (job_name, started_at) VALUES ($1, $2)
     ON CONFLICT (job_name) DO UPDATE SET started_at = EXCLUDED.started_at`,
    [JOB, new Date(time)],
  ));
}
