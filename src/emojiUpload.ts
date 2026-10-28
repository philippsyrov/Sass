/**
 * Upload the bundled emoji (assets/emoji/sass_*.png) to the Discord app as
 * application emoji. Used by `npm run emoji` and the setup wizard.
 *
 * Idempotent: lists the app's emoji first and only uploads names that are missing.
 * It never deletes or edits an emoji. The token is only sent to Discord, never printed.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const API = 'https://discord.com/api/v10';
const TIMEOUT_MS = 15_000;
const MAX_BYTES = 256 * 1024; // Discord's emoji size limit
const MAX_RETRIES = 3;
export const EMOJI_DIR = 'assets/emoji';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface EmojiFile {
  name: string;
  path: string;
}

export interface UploadOptions {
  token: string;
  appId: string;
  dir?: string;
  fetchImpl?: FetchLike;
  log?: (line: string) => void;
  /** Wait used for rate limits; replaceable in tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface UploadResult {
  uploaded: string[];
  skipped: string[];
  failed: Array<{ name: string; error: string }>;
}

/** sass_*.png files in `dir`, as emoji names (file name without .png). */
export function listEmojiFiles(dir = EMOJI_DIR): EmojiFile[] {
  return readdirSync(dir)
    .filter((file) => /^sass_[a-z0-9_]+\.png$/.test(file))
    .sort()
    .map((file) => ({ name: file.slice(0, -'.png'.length), path: join(dir, file) }));
}

export function describeError(err: unknown): string {
  if (err instanceof Error) return err.name === 'TimeoutError' ? 'timed out' : err.message;
  return String(err);
}

export async function discordError(res: Response): Promise<string> {
  let detail = '';
  try {
    const body = await res.json() as { message?: string };
    if (body.message) detail = `: ${body.message}`;
  } catch {
    // Not JSON; the status is enough.
  }
  if (res.status === 401) return 'Discord rejected the bot token (401)';
  if (res.status === 403) return `Discord refused (403${detail}). Check that CLIENT_ID is this bot's application ID`;
  if (res.status === 404) return 'Discord has no application with that CLIENT_ID (404)';
  return `Discord answered HTTP ${res.status}${detail}`;
}

/** Call the Discord API, waiting and retrying on rate limits (429). */
export async function request(opts: Required<Pick<UploadOptions, 'token' | 'fetchImpl' | 'sleep'>>, path: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await opts.fetchImpl(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bot ${opts.token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status !== 429 || attempt >= MAX_RETRIES) return res;
    let wait = 1;
    try {
      wait = Number((await res.json() as { retry_after?: number }).retry_after) || 1;
    } catch {
      // Use the default wait.
    }
    await opts.sleep(Math.ceil(wait * 1000));
  }
}

/** Names of the application's existing emoji. Throws if they can't be listed. */
export async function listAppEmojiNames(options: UploadOptions): Promise<Set<string>> {
  const opts = { fetchImpl: fetch, sleep: defaultSleep, ...options };
  let res: Response;
  try {
    res = await request(opts, `/applications/${options.appId}/emojis`);
  } catch (err) {
    throw new Error(`Could not reach Discord: ${describeError(err)}`, { cause: err });
  }
  if (!res.ok) throw new Error(`Could not list the app's emoji. ${await discordError(res)}`);
  const body = await res.json() as { items?: Array<{ name?: string | null }> };
  return new Set((body.items ?? []).map((e) => e.name).filter((n): n is string => Boolean(n)));
}

export function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Upload every bundled emoji the app doesn't have yet.
 * Throws only if the existing emoji can't be listed; per-file problems are in `failed`.
 */
export async function uploadMissingEmoji(options: UploadOptions): Promise<UploadResult> {
  const opts = { fetchImpl: fetch, sleep: defaultSleep, dir: EMOJI_DIR, log: (line: string) => console.log(line), ...options };
  if (!/^\d{17,20}$/.test(opts.appId)) throw new Error('CLIENT_ID (the application ID) is missing or not a number');
  if (!opts.token) throw new Error('DISCORD_TOKEN is missing');

  const files = listEmojiFiles(opts.dir);
  if (files.length === 0) throw new Error(`No sass_*.png files found in ${opts.dir}`);
  const existing = await listAppEmojiNames(opts);

  const result: UploadResult = { uploaded: [], skipped: [], failed: [] };
  for (const file of files) {
    if (existing.has(file.name)) {
      result.skipped.push(file.name);
      continue;
    }
    const data = readFileSync(file.path);
    if (data.length > MAX_BYTES) {
      result.failed.push({ name: file.name, error: 'file is larger than 256 KB' });
      opts.log(`  ! ${file.name}: file is larger than 256 KB`);
      continue;
    }
    try {
      const res = await request(opts, `/applications/${opts.appId}/emojis`, {
        method: 'POST',
        body: JSON.stringify({ name: file.name, image: `data:image/png;base64,${data.toString('base64')}` }),
      });
      if (!res.ok) throw new Error(await discordError(res));
      result.uploaded.push(file.name);
      opts.log(`  + ${file.name}`);
    } catch (err) {
      result.failed.push({ name: file.name, error: describeError(err) });
      opts.log(`  ! ${file.name}: ${describeError(err)}`);
    }
  }
  return result;
}

/** One-line summary for the CLI and the setup wizard. */
export function summarizeUpload(result: UploadResult): string {
  const parts = [`${result.uploaded.length} uploaded`, `${result.skipped.length} already there`];
  if (result.failed.length > 0) parts.push(`${result.failed.length} failed`);
  return `Emoji: ${parts.join(', ')}.`;
}
