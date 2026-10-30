/**
 * Welcome banner and greeting for npm run setup.
 */

import { blank, reset, bold, magenta, dim, typewriterLine, shouldAnimateWelcome } from './terminal.js';
import { mascotPlan, printMascot } from './mascot.js';

const GREETINGS = [
  "Alright, let's wire me up — Discord first, then the brain.",
  'Hi. Secrets stay hidden; roasts stay public. Ready?',
  'Few questions, then I can roast your friends properly.',
] as const;

export function pickGreeting(): string {
  const i = Math.floor(Math.random() * GREETINGS.length);
  return GREETINGS[i] ?? GREETINGS[0];
}

export function printBannerLines(): void {
  blank();
  if (shouldAnimateWelcome()) {
    console.log(`${magenta}${bold}  ╭──────────────────────────────╮${reset}`);
    console.log(`${magenta}${bold}  │  Sass · Discord roast bot  │${reset}`);
    console.log(`${magenta}${bold}  ╰──────────────────────────────╯${reset}`);
  } else {
    console.log('  Sass · Discord roast bot');
  }
}

export async function printWelcomeBanner(): Promise<void> {
  await printMascot(mascotPlan(true));
  printBannerLines();
  const greeting = pickGreeting();
  if (shouldAnimateWelcome() && !process.env.SASS_SETUP_NO_TYPEWRITER) {
    await typewriterLine(`  ${greeting}`);
  } else {
    console.log(`  ${greeting}`);
  }
  console.log(`${dim}  A few questions to connect Discord and your AI. Press Ctrl+C to quit without saving.${reset}`);
  blank();
}
