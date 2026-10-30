/**
 * Lightweight progress spinners for setup waits. Plain lines when non-TTY, CI, or NO_COLOR.
 */

import { isInkSessionActive, pushInkMessage } from './tui/prompterBridge.js';
import * as clack from '@clack/prompts';
import { shouldUseClackPrompter } from './createPrompter.js';

const tty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
const colorOn = tty && !process.env.NO_COLOR;
const useClackSpinner = shouldUseClackPrompter();
const animate = tty && !process.env.CI && colorOn && process.env.SASS_TEST_TERMINAL !== '1' && !useClackSpinner;

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

function greenCheck(): string {
  return colorOn ? '\u001b[32m✓\u001b[0m' : '✓';
}

function redCross(): string {
  return colorOn ? '\u001b[31m✗\u001b[0m' : '✗';
}

export async function runWithSpinner<T>(label: string, work: () => Promise<T>): Promise<T> {
  if (isInkSessionActive()) {
    pushInkMessage(`Working: ${label}`);
    try {
      const result = await work();
      pushInkMessage(`Done: ${label}`);
      return result;
    } catch (error) {
      pushInkMessage(`Failed: ${label}`);
      throw error;
    }
  }
  if (useClackSpinner) {
    const spin = clack.spinner();
    spin.start(label);
    try {
      const result = await work();
      spin.stop(`${label} — done`);
      return result;
    } catch (err) {
      spin.stop(`${label} — failed`);
      throw err;
    }
  }
  if (!animate) {
    process.stdout.write(`  … ${label}\n`);
    try {
      const result = await work();
      process.stdout.write(`  ${greenCheck()} ${label}\n`);
      return result;
    } catch (err) {
      process.stdout.write(`  ${redCross()} ${label}\n`);
      throw err;
    }
  }

  let frame = 0;
  const timer = setInterval(() => {
    const f = FRAMES[frame % FRAMES.length];
    frame += 1;
    process.stdout.write(`\r  ${f} ${label}`);
  }, 80);

  try {
    const result = await work();
    clearInterval(timer);
    process.stdout.write(`\r  ${greenCheck()} ${label}\n`);
    return result;
  } catch (err) {
    clearInterval(timer);
    process.stdout.write(`\r  ${redCross()} ${label}\n`);
    throw err;
  }
}
