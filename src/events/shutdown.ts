import { registerShutdownSignals } from '../shared/shutdownSignals.js';
import type { Client } from 'discord.js';

interface ShutdownResources {
  stopMaintenance?: () => Promise<void>;
  flushMemory: () => Promise<void>;
  closeClient: () => Promise<void>;
  closeEmbedder: () => Promise<void>;
  closeDatabase: () => Promise<void>;
  exit: (code: number) => void;
  log: (message: string) => void;
  error: (message: string) => void;
}

export function createShutdownHandler(resources: ShutdownResources): (signal: string) => Promise<void> {
  let pending: Promise<void> | undefined;
  return (signal) => {
    // A terminal can deliver another signal while the first flush is still pending.
    pending ??= (async () => {
      resources.log(`\n${signal} received — shutting down gracefully...`);
      let exitCode = 0;
      const steps = [
        ...(resources.stopMaintenance ? [['Maintenance', resources.stopMaintenance] as const] : []),
        ['Memory', resources.flushMemory],
        ['Discord', resources.closeClient],
        ['Memory search', resources.closeEmbedder],
        ['Database', resources.closeDatabase],
      ] as const;
      for (const [name, close] of steps) {
        try {
          await close();
        } catch (err) {
          exitCode = 1;
          resources.error(`${name} shutdown failed: ${err instanceof Error ? err.message : 'Unknown shutdown error'}`);
        }
      }
      resources.exit(exitCode);
    })();
    return pending;
  };
}

export function setupShutdown(client: Client): void {
  const shutdown = createShutdownHandler({
    stopMaintenance: async () => { await (await import('../memory/distillScheduler.js')).stopDistillationScheduler(); },
    flushMemory: async () => { await (await import('../userMemory.js')).shutdownUserMemory(); },
    closeClient: async () => { await client.destroy(); },
    closeEmbedder: async () => { await (await import('../embeddings/localEmbed.js')).closeLocalEmbedder(); },
    closeDatabase: async () => { await (await import('../database/pool.js')).closeDatabase(); },
    exit: (code) => process.exit(code),
    log: console.log,
    error: console.error,
  });
  registerShutdownSignals((signal) => { void shutdown(signal); });
}
