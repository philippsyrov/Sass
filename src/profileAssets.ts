/**
 * Set the bot's avatar and banner from the bundled assets/avatar.png and
 * assets/banner.png. Used by `npm run assets` (alias `npm run emoji`) and the setup wizard.
 *
 * Only fills in what is missing: GET /users/@me first, and an image is uploaded only
 * when the bot has none. A custom avatar or banner is never replaced.
 * The token is only sent to Discord, never printed.
 */
import { existsSync, readFileSync } from 'fs';
import { defaultSleep, describeError, discordError, request, type FetchLike } from './emojiUpload.js';

export const AVATAR_PATH = 'assets/avatar.png';
export const BANNER_PATH = 'assets/banner.png';
const MAX_BYTES = 10 * 1024 * 1024;

export type ProfileField = 'avatar' | 'banner';

export interface ProfileOptions {
  token: string;
  avatarPath?: string;
  bannerPath?: string;
  fetchImpl?: FetchLike;
  log?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

export interface ProfileResult {
  set: ProfileField[];
  kept: ProfileField[];
  failed: Array<{ field: ProfileField; error: string }>;
}

function dataUri(path: string): string {
  const data = readFileSync(path);
  if (data.length > MAX_BYTES) throw new Error('file is larger than 10 MB');
  return `data:image/png;base64,${data.toString('base64')}`;
}

/**
 * Set the bundled avatar and banner where the bot has none.
 * Throws only if the bot's profile can't be read; per-image problems are in `failed`.
 */
export async function setMissingProfileImages(options: ProfileOptions): Promise<ProfileResult> {
  const opts = {
    fetchImpl: fetch,
    sleep: defaultSleep,
    avatarPath: AVATAR_PATH,
    bannerPath: BANNER_PATH,
    log: (line: string) => console.log(line),
    ...options,
  };
  if (!opts.token) throw new Error('DISCORD_TOKEN is missing');

  let res: Response;
  try {
    res = await request(opts, '/users/@me');
  } catch (err) {
    throw new Error(`Could not reach Discord: ${describeError(err)}`, { cause: err });
  }
  if (!res.ok) throw new Error(`Could not read the bot's profile. ${await discordError(res)}`);
  const me = await res.json() as { avatar?: string | null; banner?: string | null };

  const result: ProfileResult = { set: [], kept: [], failed: [] };
  const fields: Array<[ProfileField, string]> = [['avatar', opts.avatarPath], ['banner', opts.bannerPath]];
  for (const [field, path] of fields) {
    if (me[field]) {
      result.kept.push(field);
      continue;
    }
    if (!existsSync(path)) {
      result.failed.push({ field, error: `${path} not found` });
      opts.log(`  ! ${field}: ${path} not found`);
      continue;
    }
    try {
      const patch = await request(opts, '/users/@me', { method: 'PATCH', body: JSON.stringify({ [field]: dataUri(path) }) });
      if (!patch.ok) throw new Error(await discordError(patch));
      result.set.push(field);
      opts.log(`  + ${field}`);
    } catch (err) {
      result.failed.push({ field, error: describeError(err) });
      opts.log(`  ! ${field}: ${describeError(err)}`);
    }
  }
  return result;
}

/** One-line summary for the CLI and the setup wizard. */
export function summarizeProfile(result: ProfileResult): string {
  const parts: string[] = [];
  if (result.set.length > 0) parts.push(`set ${result.set.join(' and ')}`);
  if (result.kept.length > 0) parts.push(`kept your existing ${result.kept.join(' and ')}`);
  if (result.failed.length > 0) parts.push(`${result.failed.map((f) => f.field).join(' and ')} failed`);
  return `Profile: ${parts.join(', ') || 'nothing to do'}.`;
}
