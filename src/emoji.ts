/**
 * emoji.ts — Custom Sass emoji constants
 *
 * App emoji uploaded via Discord Developer Portal.
 * Available across all servers the bot is in.
 */

export const SASS_EMOJI = {
  stare: '<:sass_stare:100000000000000900>',
  done: '<:sass_done:100000000000000901>',
  judge: '<:sass_judge:100000000000000902>',
  blush: '<:sass_blush:100000000000000903>',
  sleep: '<:sass_sleep:100000000000000908>',
  fire: '<:sass_fire:100000000000000904>',
  mid: '<:sass_mid:100000000000000909>',
  yawn: '<:sass_yawn:100000000000000910>',
  eyeroll: '<:sass_eyeroll:100000000000000905>',
  clown: '<:sass_clown:100000000000000906>',
  pout: '<:sass_pout:100000000000000907>',
} as const;

/**
 * Get the appropriate score emoji for roast battle scores.
 */
export function getScoreEmoji(score: number): string {
  if (score >= 8) return SASS_EMOJI.fire;
  if (score >= 4) return SASS_EMOJI.mid;
  return SASS_EMOJI.yawn;
}

/**
 * Build a score bar with custom emoji for roast battles.
 */
export function getScoreBar(score: number): string {
  const emoji = getScoreEmoji(score);
  return emoji.repeat(score) + '💨'.repeat(10 - score);
}
