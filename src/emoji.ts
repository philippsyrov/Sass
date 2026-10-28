/**
 * emoji.ts — Sass's custom emoji
 *
 * The images ship in assets/emoji (sass_<name>.png) and live on the Discord app as
 * application emoji (`npm run emoji` or the setup wizard uploads them). On startup
 * the bot looks them up by name, so no IDs are hardcoded. Any that are missing
 * fall back to a Unicode emoji, so text and reactions keep working either way.
 */
import type { Client } from 'discord.js';

export const SASS_EMOJI_NAMES = [
  'stare', 'done', 'judge', 'blush', 'sleep', 'fire', 'mid', 'yawn', 'eyeroll', 'clown', 'pout',
] as const;

export type SassEmojiName = (typeof SASS_EMOJI_NAMES)[number];

/** Used when the app has no emoji called sass_<name>. */
export const UNICODE_FALLBACK: Readonly<Record<SassEmojiName, string>> = {
  stare: '😶',
  done: '😮‍💨',
  judge: '🤨',
  blush: '😳',
  sleep: '😴',
  fire: '🔥',
  mid: '😐',
  yawn: '🥱',
  eyeroll: '🙄',
  clown: '🤡',
  pout: '😤',
};

/**
 * Current value for each emoji: `<:sass_name:id>` once the app emoji are loaded,
 * otherwise the Unicode fallback. Either form works in message text and in
 * `message.react()`. Read it at use time; it is filled in when the client is ready.
 */
export const SASS_EMOJI: Record<SassEmojiName, string> = { ...UNICODE_FALLBACK };

/** The parts of a discord.js emoji this module needs. */
export interface NamedEmoji {
  id: string | null;
  name: string | null;
  animated?: boolean | null;
}

export function isSassEmojiName(name: string): name is SassEmojiName {
  return (SASS_EMOJI_NAMES as readonly string[]).includes(name);
}

/** Build the value for every Sass emoji from a list of app emoji, matching on `sass_<name>`. */
export function resolveSassEmoji(emojis: Iterable<NamedEmoji>): Record<SassEmojiName, string> {
  const resolved: Record<SassEmojiName, string> = { ...UNICODE_FALLBACK };
  for (const emoji of emojis) {
    if (!emoji.id || !emoji.name?.startsWith('sass_')) continue;
    const key = emoji.name.slice('sass_'.length);
    if (!isSassEmojiName(key)) continue;
    resolved[key] = `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
  }
  return resolved;
}

/** Update SASS_EMOJI from a list of app emoji. Returns the names that fell back to Unicode. */
export function applySassEmoji(emojis: Iterable<NamedEmoji>): SassEmojiName[] {
  Object.assign(SASS_EMOJI, resolveSassEmoji(emojis));
  return SASS_EMOJI_NAMES.filter((name) => SASS_EMOJI[name] === UNICODE_FALLBACK[name]);
}

/**
 * Fetch the application's emoji and fill in SASS_EMOJI. Call once the client is ready.
 * Never throws: on failure the Unicode fallbacks stay in place.
 */
export async function loadSassEmoji(client: Pick<Client, 'application'>): Promise<void> {
  try {
    if (!client.application) throw new Error('client.application is not available yet');
    const emojis = await client.application.emojis.fetch();
    const missing = applySassEmoji(emojis.values());
    if (missing.length === 0) {
      console.log(`Custom emoji: all ${SASS_EMOJI_NAMES.length} loaded`);
    } else {
      console.log(`Custom emoji: ${SASS_EMOJI_NAMES.length - missing.length}/${SASS_EMOJI_NAMES.length} loaded, Unicode for ${missing.map((n) => `sass_${n}`).join(', ')} (run \`npm run emoji\` to upload them)`);
    }
  } catch (err) {
    console.error('Could not load custom emoji, using Unicode:', (err as Error).message);
  }
}

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

/**
 * Pick a Sass emoji to react to a message with, based on its text.
 * Returns a value for `message.react()` (custom `<:sass_name:id>` or Unicode), or null.
 */
export function pickCustomReaction(context: string): string | null {
  const lower = context.toLowerCase();
  if (/\b(dumb|stupid|idiot|clown|braindead)\b/.test(lower)) return SASS_EMOJI.clown;
  if (/\b(boring|bored|tired|sleep|zzz)\b/.test(lower)) return SASS_EMOJI.sleep;
  if (/\b(love|cute|sweet|wholesome|ily|❤️)\b/.test(lower)) return SASS_EMOJI.blush;
  if (/\b(fire|insane|goated|cooked|peak)\b/.test(lower)) return SASS_EMOJI.fire;
  if (/\b(mid|meh|okay|whatever|idc)\b/.test(lower)) return SASS_EMOJI.mid;
  if (/\b(sus|cap|lie|lying|fake)\b/.test(lower)) return SASS_EMOJI.judge;
  if (/\b(yawn|lame|cringe|corny)\b/.test(lower)) return SASS_EMOJI.yawn;
  return null;
}
