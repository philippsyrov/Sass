/**
 * `npm run assets` (alias `npm run emoji`): put Sass's bundled art on your Discord app.
 * - Custom emoji (assets/emoji/sass_*.png) the app doesn't have yet are uploaded.
 * - The avatar (assets/avatar.png) and banner (assets/banner.png) are set only when
 *   the bot has none, so a custom avatar or banner is never replaced.
 * Reads DISCORD_TOKEN and CLIENT_ID from .env. Safe to run again; nothing is ever deleted.
 */
import '../src/env.js';
import { summarizeUpload, uploadMissingEmoji } from '../src/emojiUpload.js';
import { setMissingProfileImages, summarizeProfile } from '../src/profileAssets.js';

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function main(): Promise<void> {
  const token = process.env.DISCORD_TOKEN?.trim() ?? '';
  const appId = process.env.CLIENT_ID?.trim() ?? '';
  let failed = false;

  console.log('Uploading Sass emoji to your Discord app (existing ones are skipped)...');
  try {
    const result = await uploadMissingEmoji({ token, appId });
    console.log(summarizeUpload(result));
    if (result.failed.length > 0) failed = true;
    if (result.uploaded.length > 0) console.log('Restart the bot to pick up new emoji.');
  } catch (err) {
    console.error(`Emoji upload failed: ${message(err)}`);
    failed = true;
  }

  console.log('Setting the bot avatar and banner (only if it has none)...');
  try {
    const result = await setMissingProfileImages({ token });
    console.log(summarizeProfile(result));
    if (result.failed.length > 0) {
      failed = true;
      console.log('The bot works without them. Run this again later, or set them in the Developer Portal → Bot.');
    }
  } catch (err) {
    console.error(`Avatar/banner check failed: ${message(err)}`);
    failed = true;
  }

  if (failed) process.exitCode = 1;
}

void main();
