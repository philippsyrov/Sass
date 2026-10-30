import type { EmbedPurpose } from './localEmbedConfig.js';
import { ensureLocalEmbedder, prepareLocalEmbedder, checkCachedLocalEmbedder, embedLocally, localEmbeddingDimension, localEmbeddingModelId, disposeLocalEmbedder } from './localEmbedEngine.js';

interface Request { id: number; action: string; payload: Record<string, string | undefined> | { text: string; purpose?: EmbedPurpose; config: Record<string, string | undefined> } }
let queue: Promise<void> = Promise.resolve();
let stopping = false;
function send(message: object) {
  if (process.connected) process.send?.(message, (error) => {
    if (error) { console.error('Local memory IPC failed:', error.message); process.exitCode = 1; }
  });
}
async function handle({ id, action, payload }: Request) {
  try {
    if (action === 'ensure') {
      await ensureLocalEmbedder((progress) => send({ id, progress }), payload as Record<string, string | undefined>);
      send({ id, result: { model: localEmbeddingModelId(), dimension: localEmbeddingDimension() } });
    } else if (action === 'prepare') {
      send({ id, result: await prepareLocalEmbedder((progress) => send({ id, progress }), payload as Record<string, string | undefined>) });
    } else if (action === 'check') {
      send({ id, result: await checkCachedLocalEmbedder(payload as Record<string, string | undefined>) });
    } else if (action === 'embed') {
      const { text, purpose, config } = payload as { text: string; purpose?: EmbedPurpose; config: Record<string, string | undefined> };
      await ensureLocalEmbedder(undefined, config);
      send({ id, result: await embedLocally(text, purpose) });
    } else throw new Error('Unknown local memory request');
  } catch (error) {
    send({ id, error: error instanceof Error ? error.message : String(error) });
  }
}
process.on('message', (message: Request) => {
  if (stopping || !message || !Number.isSafeInteger(message.id)) return;
  queue = queue.then(() => handle(message)).catch((error) => console.error('Local memory request failed:', error));
});
async function close() {
  if (stopping) return;
  stopping = true;
  try { await queue; await disposeLocalEmbedder(); }
  catch (error) { console.error('Local memory close failed:', error); }
  finally { process.exit(0); }
}
process.once('disconnect', () => { void close(); });
process.once('SIGTERM', () => { void close(); });
process.once('SIGINT', () => { void close(); });
