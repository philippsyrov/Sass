import { stripVTControlCharacters } from 'node:util';
import { SetupCancelledError } from '../cancelRegistry.js';

/**
 * Bridge between async setup logic and the Ink UI (one in-flight prompt at a time).
 */

export type DoneLine = { label: string; display: string };

export type PromptRequest =
  | { kind: 'action'; id: number; message: string }
  | { kind: 'text'; id: number; message: string; secret?: boolean; fallback?: string }
  | { kind: 'confirm'; id: number; message: string; defaultYes: boolean }
  | { kind: 'select'; id: number; message: string; options: string[]; defaultIndex: number };

let messages: string[] = [];
let inkSessionActive = false;

export function setInkSessionActive(active: boolean): void { inkSessionActive = active; }
export function isInkSessionActive(): boolean { return inkSessionActive; }
export function getInkMessages(): readonly string[] { return messages; }
export function pushInkMessage(message: string): void {
  const lines = stripVTControlCharacters(message).replace(/\r/g, '').split('\n').filter(Boolean);
  messages = [...messages, ...lines].slice(-100);
  rerender?.();
}

let current: PromptRequest | null = null;
let doneLines: DoneLine[] = [];
let step = 1;
let stepTitle = 'Setup';
let rerender: (() => void) | null = null;
const waiters = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void }>();
let idSeq = 0;

export function registerInkRerender(fn: () => void): void {
  rerender = fn;
}

export function getInkPrompt(): PromptRequest | null {
  return current;
}

export function getDoneLines(): readonly DoneLine[] {
  return doneLines;
}

export function setInkStep(n: number, title: string): void {
  if (n !== step) { messages = []; doneLines = []; }
  step = n;
  stepTitle = title;
  rerender?.();
}

export function getInkStep(): { step: number; title: string } {
  return { step, title: stepTitle };
}

export function pushDoneLine(label: string, display: string): void {
  doneLines = [...doneLines.slice(-8), { label, display }];
  pushInkMessage(`${label}: ${display}`);
  rerender?.();
}

function enqueuePrompt<T>(req: PromptRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    waiters.set(req.id, { resolve: resolve as (value: unknown) => void, reject });
    current = req;
    rerender?.();
  });
}

export function submitInkPrompt(id: number, value: unknown): void {
  const waiter = waiters.get(id);
  if (!waiter) return;
  waiters.delete(id);
  current = null;
  rerender?.();
  waiter.resolve(value);
}

export function cancelInkPrompt(): void {
  current = null;
  for (const waiter of waiters.values()) waiter.reject(new SetupCancelledError());
  waiters.clear();
  rerender?.();
}

export async function inkAskText(message: string, options: { secret?: boolean; fallback?: string } = {}): Promise<string> {
  const id = ++idSeq;
  return enqueuePrompt<string>({ kind: 'text', id, message, secret: options.secret, fallback: options.fallback });
}

export async function inkConfirm(message: string, defaultYes: boolean): Promise<boolean> {
  const id = ++idSeq;
  return enqueuePrompt<boolean>({ kind: 'confirm', id, message, defaultYes });
}

export async function inkSelect(message: string, options: string[], defaultIndex: number): Promise<number> {
  const id = ++idSeq;
  return enqueuePrompt<number>({ kind: 'select', id, message, options, defaultIndex });
}

export function formatSecretDisplay(value: string): string {
  if (value.length <= 4) return '••••';
  return `••••${value.slice(-4)}`;
}

export function inkAction(message: string): Promise<boolean> {
  return enqueuePrompt<boolean>({ kind: 'action', id: ++idSeq, message });
}
