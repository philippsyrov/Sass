/**
 * Sass setup mascot — pre-rendered ANSI half-block art (truecolor + 256-color).
 */

import { MASCOT_30_256, MASCOT_30_TRUECOLOR, MASCOT_45_256, MASCOT_45_TRUECOLOR } from './mascotData.generated.js';

const MIN_COLS = 40;
const LARGE_MIN_COLS = 60;
const LARGE_MIN_ROWS = 34;
const SMALL_MIN_ROWS = 18;

export type MascotVariant = 45 | 30;

export interface MascotDisplayPlan {
  variant: MascotVariant;
  lines: readonly string[];
}

function ttyOk(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export function supportsTruecolor(): boolean {
  const ct = process.env.COLORTERM?.toLowerCase() ?? '';
  if (ct === 'truecolor' || ct === '24bit') return true;
  if (process.env.TERM_PROGRAM === 'iTerm.app') return true;
  if (process.env.TERM?.includes('direct')) return true;
  return false;
}

export function shouldShowMascot(): boolean {
  if (!ttyOk()) return false;
  if (process.env.NO_COLOR) return false;
  if (process.env.CI) return false;
  if (process.env.SASS_SETUP_NO_MASCOT === '1') return false;
  if (process.env.SASS_TEST_TERMINAL === '1') return false;
  const cols = process.stdout.columns ?? 80;
  if (cols < MIN_COLS) return false;
  return true;
}

export function pickMascotVariant(preferLarge = true): MascotVariant | null {
  if (!shouldShowMascot()) return null;
  const cols = process.stdout.columns ?? 80;
  const rows = process.stdout.rows ?? 24;
  if (!preferLarge) {
    return cols >= MIN_COLS && rows >= SMALL_MIN_ROWS ? 30 : null;
  }
  if (cols >= LARGE_MIN_COLS && rows >= LARGE_MIN_ROWS) return 45;
  if (cols >= MIN_COLS && rows >= SMALL_MIN_ROWS) return 30;
  return null;
}

function linesForVariant(variant: MascotVariant): readonly string[] {
  const tc = variant === 45 ? MASCOT_45_TRUECOLOR : MASCOT_30_TRUECOLOR;
  const c256 = variant === 45 ? MASCOT_45_256 : MASCOT_30_256;
  return supportsTruecolor() ? tc : c256;
}

export function mascotPlan(preferLarge = true): MascotDisplayPlan | null {
  const variant = pickMascotVariant(preferLarge);
  if (variant === null) return null;
  return { variant, lines: linesForVariant(variant) };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Quick line reveal; skipped when SASS_SETUP_NO_MASCOT_ANIM=1 or non-interactive clack off. */
export async function printMascot(plan: MascotDisplayPlan | null): Promise<void> {
  if (!plan) return;
  const animate = shouldShowMascot() && !process.env.SASS_SETUP_NO_MASCOT_ANIM && ttyOk();
  const maxMs = 280;
  const perLine = animate ? Math.min(18, Math.max(4, Math.floor(maxMs / plan.lines.length))) : 0;

  if (animate && perLine > 0) {
    let skipped = false;
    const onData = (): void => {
      skipped = true;
    };
    process.stdin.once('data', onData);
    if (typeof process.stdin.setRawMode === 'function') process.stdin.setRawMode(true);
    process.stdin.resume();
    for (const line of plan.lines) {
      if (skipped) break;
      process.stdout.write(`  ${line}\n`);
      await sleep(perLine);
    }
    process.stdin.off('data', onData);
    if (typeof process.stdin.setRawMode === 'function') process.stdin.setRawMode(false);
    process.stdin.pause();
    if (skipped) {
      for (const line of plan.lines) process.stdout.write(`  ${line}\n`);
    }
  } else {
    for (const line of plan.lines) console.log(`  ${line}`);
  }
  console.log('');
}
