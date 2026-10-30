import { distillAllGuilds } from '../vectorMemory.js';
import { lastDistillationRun, recordDistillationRun } from '../database/maintenanceState.js';
import { DISTILL_INTERVAL_MS } from './profilePolicy.js';
import { setTimeout as nodeSetTimeout, clearTimeout as nodeClearTimeout } from 'node:timers';

type RunStatus = 'completed' | 'limited' | 'skipped' | 'aborted' | 'failed';
interface SchedulerPorts {
  run: (signal: AbortSignal) => Promise<{ status: RunStatus }>;
  readLastRun: (signal?: AbortSignal) => Promise<number | null>;
  writeLastRun: (time: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  setTimer?: (work: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  error?: (message: string) => void;
  shutdownTimeoutMs?: number;
}

export function createDistillScheduler(ports: SchedulerPorts) {
  const now = ports.now ?? (() => Date.now());
  const setTimer: NonNullable<SchedulerPorts['setTimer']> = ports.setTimer ?? ((work, delay) => nodeSetTimeout(work, delay));
  const clearTimer = ports.clearTimer ?? nodeClearTimeout;
  const error = ports.error ?? console.error;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let active: Promise<void> | undefined;
  let started = false;
  let stopped = false;

  function schedule(delay: number): void {
    if (stopped) return;
    timer = setTimer(() => {
      timer = undefined;
      active = tick().finally(() => { active = undefined; });
    }, delay);
    timer.unref?.();
  }

  async function tick(): Promise<void> {
    try {
      controller = new AbortController();
      const last = await ports.readLastRun(controller.signal);
      if (stopped) return;
      if (last !== null && Number.isFinite(last)) {
        const remaining = last + DISTILL_INTERVAL_MS - now();
        if (remaining > 0) { schedule(Math.min(remaining, DISTILL_INTERVAL_MS)); return; }
      }
      // Persist before spending model calls. Failed or interrupted runs must not
      // get a fresh budget merely because the process restarts.
      await ports.writeLastRun(now(), controller.signal);
      if (stopped) return;
      await ports.run(controller.signal);
    } catch {
      error('[DISTILL] Scheduled maintenance failed; raw memory remains available.');
    } finally {
      controller = undefined;
      if (!timer) schedule(DISTILL_INTERVAL_MS);
    }
  }

  return {
    start(): void {
      if (started || stopped) return;
      started = true;
      schedule(5 * 60 * 1000);
    },
    async stop(): Promise<void> {
      stopped = true;
      if (timer) { clearTimer(timer); timer = undefined; }
      controller?.abort();
      if (!active) return;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          active,
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error('Memory maintenance did not stop in time')), ports.shutdownTimeoutMs ?? 35_000);
          }),
        ]);
      } finally { if (timeout) clearTimeout(timeout); }
    },
  };
}

const scheduler = createDistillScheduler({
  run: (signal) => distillAllGuilds({ signal }),
  readLastRun: lastDistillationRun,
  writeLastRun: recordDistillationRun,
});

export const startDistillationScheduler = () => scheduler.start();
export const stopDistillationScheduler = () => scheduler.stop();
