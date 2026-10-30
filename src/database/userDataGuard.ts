import { AsyncLocalStorage } from 'node:async_hooks';

interface State {
  generation: number;
  tail: Promise<void>;
  pending: number;
}
export interface UserDataToken { readonly key: string; readonly state: State | null; readonly generation: number; readonly eventEpoch: number }
const states = new Map<string, State>();
const context = new AsyncLocalStorage<UserDataToken>();
let deletionEpoch = 0;
const MAX_STATES = 5000;
const MAX_PENDING = 1000;
const keyFor = (guildId: string, userId: string): string => JSON.stringify([guildId, userId]);

function stateFor(key: string): State | null {
  const existing = states.get(key);
  if (existing) return existing;
  if (states.size >= MAX_STATES) {
    for (const [oldKey, state] of states) {
      if (state.pending === 0) { states.delete(oldKey); break; }
    }
  }
  if (states.size >= MAX_STATES) return null;
  const state: State = { generation: 0, tail: Promise.resolve(), pending: 0 };
  states.set(key, state);
  return state;
}

export function captureUserDataToken(guildId: string, userId: string): UserDataToken {
  const key = keyFor(guildId, userId);
  const inherited = context.getStore();
  if (inherited?.key === key) return inherited;
  // A participant discovered after an await cannot be safely tied to an earlier
  // event if any deletion happened in the meantime; fail closed.
  if (inherited && inherited.eventEpoch !== deletionEpoch) {
    return { key, state: null, generation: -1, eventEpoch: inherited.eventEpoch };
  }
  const state = stateFor(key);
  return { key, state, generation: state?.generation ?? -1, eventEpoch: inherited?.eventEpoch ?? deletionEpoch };
}

export function withUserDataContext<T>(guildId: string, userId: string, work: () => Promise<T>): Promise<T> {
  return context.run(captureUserDataToken(guildId, userId), work);
}

export function isUserDataTokenCurrent(token: UserDataToken): boolean {
  return !!token.state && states.get(token.key) === token.state && token.state.generation === token.generation;
}

export async function withUserDataWrite<T>(token: UserDataToken, work: () => Promise<T>): Promise<T | undefined> {
  const state = token.state;
  if (!state || states.get(token.key) !== state || state.generation !== token.generation || state.pending >= MAX_PENDING) return undefined;
  state.pending++;
  const previous = state.tail;
  let release!: () => void;
  state.tail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    if (states.get(token.key) !== state || state.generation !== token.generation) return undefined;
    return await work();
  } finally {
    state.pending--;
    release();
  }
}

export async function withUserDataDeletion<T>(guildId: string, userId: string, work: () => Promise<T>): Promise<T> {
  const key = keyFor(guildId, userId);
  const state = stateFor(key);
  if (!state) throw new Error('User data queue is full');
  // Invalidate even work that has not reached the write queue yet.
  state.generation++;
  deletionEpoch++;
  if (state.pending >= MAX_PENDING) throw new Error('User data queue is full');
  state.pending++;
  const previous = state.tail;
  let release!: () => void;
  state.tail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try { return await work(); } finally { state.pending--; release(); }
}
