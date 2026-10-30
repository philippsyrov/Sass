/**
 * Word-wrap setup copy to the live terminal width (never mid-word).
 */

const MIN_WIDTH = 40;
const MAX_PROSE = 72;

export function terminalColumns(): number {
  const cols = process.stdout.columns;
  if (typeof cols === 'number' && cols >= MIN_WIDTH) return cols;
  return 80;
}

/** Max width for body text (indented prose). */
export function proseWidth(): number {
  return Math.min(MAX_PROSE, terminalColumns());
}

/** Visible length ignoring ANSI escape sequences. */
export function visibleLength(text: string): number {
  let len = 0;
  let i = 0;
  while (i < text.length) {
    if (text[i] === '\u001b') {
      const end = text.indexOf('m', i);
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    len += 1;
    i += 1;
  }
  return len;
}

/**
 * Wrap plain text to width at word boundaries. Each output line includes indent.
 */
export function wrapPlain(text: string, indent = '  ', width = proseWidth()): string[] {
  const inner = Math.max(20, width - indent.length);
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  if (words.length === 0 || words[0] === '') return [];
  const lines: string[] = [];
  let current = words[0] ?? '';
  for (let w = 1; w < words.length; w += 1) {
    const word = words[w] ?? '';
    const candidate = `${current} ${word}`;
    if (candidate.length <= inner) current = candidate;
    else {
      lines.push(`${indent}${current}`);
      current = word;
    }
  }
  lines.push(`${indent}${current}`);
  return lines;
}

export function printWrapped(text: string, indent = '  '): void {
  for (const line of wrapPlain(text, indent)) {
    console.log(line);
  }
}
