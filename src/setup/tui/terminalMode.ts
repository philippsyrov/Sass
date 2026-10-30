/** Alternate screen buffer for the Ink setup wizard. */

const ENTER_ALT = '\u001b[?1049h';
const LEAVE_ALT = '\u001b[?1049l';

export function enterAlternateScreen(): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write(ENTER_ALT);
  process.stdout.write('\u001b[?25l');
}

export function exitAlternateScreen(): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write('\u001b[?25h');
  process.stdout.write(LEAVE_ALT);
}
