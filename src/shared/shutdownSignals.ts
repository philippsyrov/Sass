import type { Writable } from 'node:stream';
import { discardWorkerOutput } from './workerOutput.js';

/** Register graceful shutdown for keyboard interrupt, termination and terminal hangup. */
export function registerShutdownSignals(
  handler: (signal: NodeJS.Signals) => void,
  streams: (Writable & { isTTY?: boolean })[] = [process.stdout, process.stderr],
): () => void {
  const terminalStreams = streams.filter(stream => stream.isTTY);
  const remove = (['SIGINT', 'SIGTERM', 'SIGHUP'] as const).map((signal) => {
    const listener = (): void => {
      if (signal === 'SIGHUP') {
        // A vanished macOS TTY can block synchronous writes before cleanup runs.
        // Only discard terminal output; redirected files/pipes retain their logs.
        for (const stream of terminalStreams) {
          stream.write = (...args: unknown[]): boolean => {
            const callback = args.at(-1);
            if (typeof callback === 'function') queueMicrotask(() => callback());
            return true;
          };
          discardWorkerOutput(stream);
        }
      }
      handler(signal);
    };
    process.on(signal, listener);
    return () => process.off(signal, listener);
  });
  return () => { for (const dispose of remove) dispose(); };
}
