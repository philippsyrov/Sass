import { register } from 'tsx/esm/api';
register();
const { connectPool, getRawPool, setConnected, closeDatabase } = await import(process.env.SASS_FIXTURE_BUILT === '1' ? '../../dist/database/pool.js' : '../../src/database/pool.ts');
const { createShutdownHandler } = await import(process.env.SASS_FIXTURE_BUILT === '1' ? '../../dist/events/shutdown.js' : '../../src/events/shutdown.ts');
const connecting = connectPool();
if (process.env.SASS_FIXTURE_EARLY_CLOSE === '1') {
  await Promise.all([closeDatabase(), closeDatabase()]);
  process.send({ type: 'closed' });
  process.exit(0);
}
if (!await connecting) process.exit(1);
setConnected(true);
const pool = getRawPool();
pool.on('error', (error) => { console.error('Unexpected pool error:', error.message); });
await pool.query('CREATE TABLE IF NOT EXISTS lifecycle_probe (value text NOT NULL)');
await pool.query("INSERT INTO lifecycle_probe VALUES ('retained')");
const result = await pool.query('SELECT count(*) AS count FROM lifecycle_probe');
const { registerShutdownSignals } = await import('../../src/shared/shutdownSignals.ts');
const shutdown = createShutdownHandler({
  flushMemory: async () => {
    await pool.query('SELECT pg_sleep(0.2)');
    console.log('FLUSHED');
  },
  closeClient: async () => {}, closeEmbedder: async () => {}, closeDatabase: async () => { await Promise.all([closeDatabase(), closeDatabase()]); },
  exit: (code) => process.exit(code), log: console.log, error: console.error,
});
registerShutdownSignals(signal => void shutdown(signal));
process.send({ type: 'ready', count: Number(result.rows[0].count) });
setInterval(() => {}, 1000);
