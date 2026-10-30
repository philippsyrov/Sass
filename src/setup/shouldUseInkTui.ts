/** Full-screen Ink wizard (macOS Terminal 80×24). */

export function shouldUseInkTui(): boolean {
  if (process.env.SASS_SETUP_INK === '0') return false;
  if (process.env.SASS_TEST_TERMINAL === '1') return false;
  if (process.env.TERM === 'dumb') return false;
  if (process.env.CI) return false;
  if (process.env.NO_COLOR) return false;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  return true;
}
