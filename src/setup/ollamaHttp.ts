import { isInkSessionActive, pushInkMessage } from './tui/prompterBridge.js';
/**
 * Ollama pull/create via HTTP streaming API (cancellable, single progress line).
 */

import { SetupCancelledError, createTrackedAbortSignal, trackOllamaDownload } from './cancelRegistry.js';

const tty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
const colorOn = tty && !process.env.NO_COLOR;

interface PullProgress {
  status?: string;
  digest?: string;
  total?: number;
  completed?: number;
}

function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} KB`;
  return `${n} B`;
}

function formatProgressLine(model: string, total: number, completed: number, speedBps: number): string {
  const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  const speed = speedBps > 0 ? `${formatBytes(speedBps)}/s` : '—';
  let eta = '—';
  if (speedBps > 0 && total > completed) {
    const sec = (total - completed) / speedBps;
    eta = sec >= 3600 ? `${Math.round(sec / 3600)}h` : sec >= 60 ? `${Math.round(sec / 60)}m` : `${Math.round(sec)}s`;
  }
  return `  ${model}: ${formatBytes(completed)} / ${formatBytes(total)} (${pct}%) · ${speed} · ETA ${eta} · Ctrl+C to cancel`;
}

async function readNdjsonStream(
  body: ReadableStream<Uint8Array>,
  onLine: (obj: PullProgress) => void,
  signal: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    if (signal.aborted) throw new SetupCancelledError();
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        try {
          onLine(JSON.parse(line) as PullProgress);
        } catch {
          /* ignore malformed */
        }
      }
      newline = buffer.indexOf('\n');
    }
  }
}

async function streamOllamaPost(
  host: string,
  path: string,
  payload: Record<string, unknown>,
  label: string,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(`${host.replace(/\/+$/, '')}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, stream: true }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`Ollama ${path} failed (HTTP ${res.status})`);
  }
  if (!res.body) {
    throw new Error(`Ollama ${path} returned no body`);
  }

  let lastCompleted = 0;
  let lastTime = Date.now();
  let speedBps = 0;
  let lastLine = '';

  const writeProgress = (line: string): void => {
    if (isInkSessionActive()) { pushInkMessage(line); return; }
    if (!tty) return;
    lastLine = line;
    if (colorOn) {
      process.stdout.write(`\r\u001b[2K${line}`);
    } else {
      process.stdout.write(`\r${line}`);
    }
  };

  await readNdjsonStream(res.body, (ev) => {
    const now = Date.now();
    if (ev.completed != null && ev.total != null && ev.total > 0) {
      const dt = (now - lastTime) / 1000;
      if (dt > 0.05 && ev.completed >= lastCompleted) {
        speedBps = (ev.completed - lastCompleted) / dt;
        lastCompleted = ev.completed;
        lastTime = now;
      }
      writeProgress(formatProgressLine(label, ev.total, ev.completed, speedBps));
    } else if (ev.status) {
      const short = ev.status.replace(/\s+/g, ' ').slice(0, 60);
      writeProgress(`  ${label}: ${short} · Ctrl+C to cancel`);
    }
  }, signal);

  if (tty && lastLine && !isInkSessionActive()) {
    process.stdout.write('\n');
  }
}

export async function ollamaPullHttp(host: string, model: string, signal?: AbortSignal): Promise<void> {
  const sig = signal ?? createTrackedAbortSignal();
  const untrackDownload = trackOllamaDownload(model, sig);
  try {
    await streamOllamaPost(host, '/api/pull', { name: model }, model, sig);
  } catch (err) {
    if (sig.aborted || (err instanceof Error && err.name === 'AbortError')) {
      throw new SetupCancelledError();
    }
    throw err;
  } finally {
    untrackDownload();
  }
}

export async function ollamaCreateHttp(host: string, name: string, modelfile: string, signal?: AbortSignal): Promise<void> {
  const sig = signal ?? createTrackedAbortSignal();
  try {
    await streamOllamaPost(host, '/api/create', { name, modelfile }, name, sig);
  } catch (err) {
    if (sig.aborted || (err instanceof Error && err.name === 'AbortError')) {
      throw new SetupCancelledError();
    }
    throw err;
  }
}

export async function ollamaPullHttpWithProgress(host: string, model: string): Promise<boolean> {
  if (isInkSessionActive()) pushInkMessage(`Pulling ${model}`);
  else if (!tty || process.env.CI || process.env.NO_COLOR) {
    process.stdout.write(`  … Pulling ${model}\n`);
  }
  try {
    await ollamaPullHttp(host, model);
    if (isInkSessionActive()) pushInkMessage(`Pulled ${model}`);
    else process.stdout.write(`  ✓ Pulled ${model}\n`);
    return true;
  } catch (err) {
    if (err instanceof SetupCancelledError) throw err;
    if (isInkSessionActive()) pushInkMessage(`Pull ${model} failed`);
    else process.stdout.write(`  ✗ Pull ${model} failed\n`);
    return false;
  }
}
