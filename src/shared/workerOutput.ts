import type { Readable, Writable } from 'node:stream';

// There are only two application output streams. Retain failure state so later
// workers also drain safely after a terminal or downstream consumer disappears.
const outputs = new WeakMap<Writable, { failed: boolean; sources: Set<Readable> }>();

/** Release paused readers when their output destination is no longer usable. */
export function discardWorkerOutput(destination: Writable): void {
  let state = outputs.get(destination);
  if (!state) {
    state = { failed: true, sources: new Set() };
    outputs.set(destination, state);
  }
  state.failed = true;
  for (const reader of state.sources) {
    reader.unpipe(destination);
    reader.resume();
  }
  state.sources.clear();
}

export function forwardWorkerOutput(source: Readable | null, destination: Writable): void {
  if (!source) return;
  let state = outputs.get(destination);
  if (!state) {
    state = { failed: false, sources: new Set() };
    outputs.set(destination, state);
    const drain = (): void => discardWorkerOutput(destination);
    destination.on('error', drain);
    destination.once('close', drain);
    destination.once('finish', drain);
  }
  if (state.failed || destination.destroyed || destination.writableFinished) { source.resume(); return; }
  state.sources.add(source);
  const current = state;
  source.once('close', () => { current.sources.delete(source); });
  // pipe respects destination backpressure; failed destinations are unpiped and
  // continuously drained above so worker shutdown never waits on its logs.
  source.pipe(destination, { end: false });
}
