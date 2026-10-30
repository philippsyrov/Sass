/**
 * Track setup subprocesses and in-flight HTTP work so Ctrl+C cancels everything.
 */

import type { ChildProcess } from 'child_process';

export class SetupCancelledError extends Error {
  constructor(message = 'Setup cancelled') {
    super(message);
    this.name = 'SetupCancelledError';
  }
}

const abortControllers = new Set<AbortController>();
const childProcesses = new Set<ChildProcess>();

let handlersInstalled = false;

export function trackAbortController(controller: AbortController): AbortController {
  abortControllers.add(controller);
  controller.signal.addEventListener('abort', () => {
    abortControllers.delete(controller);
  }, { once: true });
  return controller;
}

export function createTrackedAbortSignal(): AbortSignal {
  return trackAbortController(new AbortController()).signal;
}

export function registerChildProcess(child: ChildProcess): void {
  childProcesses.add(child);
  child.once('exit', () => {
    childProcesses.delete(child);
  });
  child.once('error', () => {
    childProcesses.delete(child);
  });
}

function killProcessGroup(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid) return;
  try {
    if (process.platform !== 'win32') {
      process.kill(-pid, 'SIGTERM');
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }
}

/** Kill all tracked children and abort all tracked fetch/stream operations. */
export function cancelAllActiveWork(): void {
  for (const controller of abortControllers) {
    controller.abort();
  }
  abortControllers.clear();
  for (const child of childProcesses) {
    killProcessGroup(child);
  }
  childProcesses.clear();
}

export function partialOllamaDownloadHint(model: string): string {
  return `If a partial download remains: ollama rm ${model} (or remove it in the Ollama app).`;
}

export function installSetupCancelHandlers(onCancel: () => void): void {
  if (handlersInstalled) return;
  handlersInstalled = true;
  const handler = (): void => {
    cancelAllActiveWork();
    onCancel();
  };
  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);
}
