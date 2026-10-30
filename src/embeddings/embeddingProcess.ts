import { fork, type ChildProcess } from 'node:child_process';
import type { EmbedProgress } from './localEmbedConfig.js';

interface Reply { id: number; result?: unknown; error?: string; progress?: Parameters<EmbedProgress>[0] }
interface Pending { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout; progress?: EmbedProgress }

export function createEmbeddingProcess(worker: URL, timeoutMs = 120_000) {
  let child: ChildProcess | undefined;
  let nextId = 0;
  const pending = new Map<number, Pending>();
  function fail(error: Error) {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  }
  function stop() {
    const previous = child;
    child = undefined;
    if (previous) {
      const timer = setTimeout(() => { previous.kill('SIGKILL'); }, 2_000);
      previous.once('exit', () => clearTimeout(timer));
      previous.kill('SIGTERM');
    }
    fail(new Error('Local memory process stopped'));
  }
  function start(): ChildProcess {
    if (child) return child;
    // An OS process has its own Objective-C runtime; worker_threads do not.
    const env: Record<string, string | undefined> = {};
    for (const key of ['HOME', 'PATH', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'SystemRoot']) {
      if (process.env[key]) env[key] = process.env[key];
    }
    const instance = fork(worker, [], { env: env as NodeJS.ProcessEnv, execArgv: worker.pathname.endsWith('.ts') ? ['--import', 'tsx'] : [], stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    child = instance;
    instance.on('message', (message: Reply) => {
      if (!message || !Number.isSafeInteger(message.id)) return;
      const request = pending.get(message.id);
      if (!request) return;
      if (message.progress) { request.progress?.(message.progress); return; }
      clearTimeout(request.timer);
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error));
      else request.resolve(message.result);
      if (pending.size === 0) { instance.unref(); instance.channel?.unref(); }
    });
    instance.on('error', (error) => { if (child === instance) { child = undefined; fail(error); } });
    instance.on('exit', (code, signal) => {
      if (child === instance) {
        child = undefined;
        fail(new Error(`Local memory process exited (${signal || code})`));
      }
    });
    return instance;
  }
  async function request(action: string, payload: unknown, progress?: EmbedProgress, requestTimeoutMs = timeoutMs): Promise<unknown> {
    if (pending.size >= 128) throw new Error('Local memory queue is full; retry later');
    const instance = start();
    instance.ref(); instance.channel?.ref();
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        stop();
      }, requestTimeoutMs);
      pending.set(id, { resolve, reject, timer, progress });
      instance.send({ id, action, payload }, (error) => {
        if (error && child === instance) { stop(); }
      });
    });
  }
  async function close(): Promise<void> {
    const instance = child;
    if (!instance) return;
    // Bound shutdown even when native inference does not return to the event loop.
    await new Promise<void>((resolve) => {
      instance.once('exit', () => resolve());
      stop();
    });
  }
  return { request, close };
}
