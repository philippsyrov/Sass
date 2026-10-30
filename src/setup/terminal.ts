/**
 * Terminal styling for setup and installers. No dependencies; respects NO_COLOR and non-TTY.
 */

import { wrapPlain } from './wrap.js';

export { printWrapped, proseWidth, wrapPlain } from './wrap.js';

const tty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
const colorOn = tty && !process.env.NO_COLOR;

const esc = (n: number): string => (colorOn ? `\u001b[${n}m` : '');
export const reset = esc(0);
export const bold = esc(1);
export const dim = esc(2);
export const magenta = esc(35);
const green = esc(32);
const yellow = esc(33);
const red = esc(31);
const cyan = esc(36);

export function shouldAnimateWelcome(): boolean {
  return tty && !process.env.CI && colorOn && process.env.SASS_TEST_TERMINAL !== '1';
}

const TYPEWRITER_MS = Math.min(30, Math.max(8, Number(process.env.SASS_TYPEWRITER_MS) || 18));

export async function typewriterLine(line: string): Promise<void> {
  if (!shouldAnimateWelcome() || process.env.SASS_SETUP_NO_TYPEWRITER) {
    console.log(line);
    return;
  }
  process.stdout.write(line.slice(0, 2));
  for (let i = 2; i < line.length; i += 1) {
    await new Promise((r) => setTimeout(r, TYPEWRITER_MS));
    process.stdout.write(line[i] ?? '');
  }
  console.log('');
}

export const SETUP_STEP_COUNT = 5;

export function blank(): void {
  console.log('');
}

/** OSC 8 hyperlink; plain URL fallback when colors/links disabled. */
export function hyperlink(url: string, label?: string): string {
  const text = label ?? url;
  if (!tty) {
    return label && label !== url ? `${text} — ${url}` : url;
  }
  if (!colorOn) {
    return label && label !== url ? `${text} (${url})` : url;
  }
  return `\u001b]8;;${url}\u0007${text}\u001b]8;;\u0007`;
}

/** @deprecated use printWelcomeBanner from banner.ts */
export function printWelcome(): void {
  blank();
  console.log(`${bold}Sass setup${reset}`);
  console.log(`${dim}A few questions to connect Discord and your AI. Secrets stay hidden.${reset}`);
  console.log(`${dim}Press Ctrl+C anytime to quit without saving.${reset}`);
  blank();
}

export function sectionStep(step: number, title: string): void {
  blank();
  console.log(`${bold}${cyan}Step ${step} of ${SETUP_STEP_COUNT} · ${title}${reset}`);
  blank();
}

export function explain(text: string): void {
  for (const line of wrapPlain(text, '  ')) {
    console.log(line);
  }
}

/** One short label plus an optional dim line with a clickable link. */
export function fieldHelp(label: string, link?: { url: string; text: string }): void {
  for (const line of wrapPlain(label, '  ')) {
    console.log(line);
  }
  if (link) {
    console.log(`  ${dim}Get it:${reset} ${hyperlink(link.url, link.text)}`);
  }
  blank();
}

export function whereToFind(path: string, url?: string): void {
  if (url) {
    console.log(`  ${dim}Where to find it:${reset} ${path}`);
    console.log(`  ${hyperlink(url)}`);
  } else {
    console.log(`  ${dim}Where to find it:${reset} ${path}`);
  }
  blank();
}

export function note(text: string): void {
  console.log(`  ${text}`);
}

export function success(text: string): void {
  console.log(`  ${green}✓${reset} ${text}`);
}

export function warn(text: string): void {
  console.log(`  ${yellow}!${reset} ${text}`);
}

export function errorLine(text: string): void {
  console.log(`  ${red}✗${reset} ${text}`);
}

export function formatEnterDefault(value: string | number): string {
  return `(Enter = ${value})`;
}

export function formatEnterKeep(): string {
  return '(Enter = keep current)';
}

export function summaryBox(lines: string[]): void {
  blank();
  const width = Math.min(72, Math.max(40, ...lines.map((l) => l.length)) + 4);
  const bar = '─'.repeat(width - 2);
  console.log(`${dim}┌${bar}┐${reset}`);
  for (const line of lines) {
    console.log(`${dim}│${reset} ${line.padEnd(width - 4)} ${dim}│${reset}`);
  }
  console.log(`${dim}└${bar}┘${reset}`);
  blank();
}
