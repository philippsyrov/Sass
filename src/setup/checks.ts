/**
 * Optional network checks for `npm run setup`. Each one only reads, never prints
 * secrets, and returns a plain result so the wizard can keep going on failure.
 */
import { ApplicationFlags } from 'discord.js';

const TIMEOUT_MS = 10_000;

export interface DiscordApp {
  id: string;
  name: string;
  presenceIntent: boolean;
  messageContentIntent: boolean;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError') return 'timed out';
    const cause = (err as Error & { cause?: { code?: string } }).cause?.code;
    return cause ? `${err.message} (${cause})` : err.message;
  }
  return String(err);
}

/** GET /applications/@me with the bot token: proves the token works and reads intent flags. */
export async function fetchDiscordApp(token: string): Promise<Result<DiscordApp>> {
  try {
    const res = await fetch('https://discord.com/api/v10/applications/@me', {
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401) return { ok: false, error: 'Discord rejected the token (401). Reset it in the Developer Portal and paste the new one.' };
    if (!res.ok) return { ok: false, error: `Discord answered HTTP ${res.status}.` };
    const body = await res.json() as { id?: string; name?: string; flags?: number };
    const flags = body.flags ?? 0;
    const has = (full: number, limited: number) => (flags & full) !== 0 || (flags & limited) !== 0;
    return {
      ok: true,
      data: {
        id: body.id ?? '',
        name: body.name ?? '(unnamed app)',
        presenceIntent: has(ApplicationFlags.GatewayPresence, ApplicationFlags.GatewayPresenceLimited),
        messageContentIntent: has(ApplicationFlags.GatewayMessageContent, ApplicationFlags.GatewayMessageContentLimited),
      },
    };
  } catch (err) {
    return { ok: false, error: `Could not reach Discord: ${errorMessage(err)}` };
  }
}

/** GET {baseUrl}/models on an OpenAI-compatible API and return the model IDs. */
export async function listOpenAIModels(baseUrl: string, apiKey: string): Promise<Result<string[]>> {
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) return { ok: false, error: `The API rejected the key (HTTP ${res.status}).` };
    if (!res.ok) return { ok: false, error: `${baseUrl}/models answered HTTP ${res.status}.` };
    const body = await res.json() as { data?: Array<{ id?: unknown }> };
    const ids = (body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string');
    return { ok: true, data: ids };
  } catch (err) {
    return { ok: false, error: `Could not reach ${baseUrl}: ${errorMessage(err)}` };
  }
}

/** GET {host}/api/tags on Ollama and return the installed model names. */
export async function listOllamaModels(host: string): Promise<Result<string[]>> {
  try {
    const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return { ok: false, error: `${host}/api/tags answered HTTP ${res.status}.` };
    const body = await res.json() as { models?: Array<{ name?: unknown }> };
    const names = (body.models ?? []).map((m) => m.name).filter((n): n is string => typeof n === 'string');
    return { ok: true, data: names };
  } catch (err) {
    return { ok: false, error: `Could not reach Ollama at ${host}: ${errorMessage(err)}. Is \`ollama serve\` running?` };
  }
}

/** Ollama names default to the `latest` tag, so `llama3.1` matches `llama3.1:latest`. */
export function hasOllamaModel(installed: string[], model: string): boolean {
  const want = model.includes(':') ? model : `${model}:latest`;
  return installed.includes(model) || installed.includes(want);
}
