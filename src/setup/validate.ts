/**
 * Pure helpers for `npm run setup`: input cleanup, validation and .env rendering.
 * No I/O here so they can be checked without a terminal or real tokens.
 */

export type Check = { ok: true; value: string; warning?: string } | { ok: false; error: string };

export interface ProviderPreset {
  key: string;
  label: string;
  /** `openai` = any OpenAI-compatible API, `ollama` = Ollama's native API. */
  aiProvider: 'openai' | 'ollama';
  /** Base URL for OpenAI-compatible hosts. Empty = the OpenAI default. */
  baseUrl?: string;
  /** Local servers ignore the key but the SDK needs a non-empty one. */
  localKey?: string;
  /** True when the user has to type the base URL. */
  askBaseUrl?: boolean;
  /** Can the host fetch Discord image URLs (image roasts over `image_url`)? */
  fetchesImageUrls: boolean;
  /** Does the host serve `text-embedding-3-small` for vector memory? */
  servesEmbeddings: boolean;
}

// Base URLs match the table in docs/CONFIGURATION.md.
export const PROVIDERS: readonly ProviderPreset[] = [
  { key: 'openai', label: 'OpenAI', aiProvider: 'openai', fetchesImageUrls: true, servesEmbeddings: true },
  { key: 'openrouter', label: 'OpenRouter', aiProvider: 'openai', baseUrl: 'https://openrouter.ai/api/v1', fetchesImageUrls: true, servesEmbeddings: false },
  { key: 'groq', label: 'Groq', aiProvider: 'openai', baseUrl: 'https://api.groq.com/openai/v1', fetchesImageUrls: true, servesEmbeddings: false },
  { key: 'xai', label: 'xAI', aiProvider: 'openai', baseUrl: 'https://api.x.ai/v1', fetchesImageUrls: true, servesEmbeddings: false },
  { key: 'together', label: 'Together', aiProvider: 'openai', baseUrl: 'https://api.together.xyz/v1', fetchesImageUrls: true, servesEmbeddings: false },
  { key: 'lmstudio', label: 'LM Studio (local)', aiProvider: 'openai', baseUrl: 'http://localhost:1234/v1', localKey: 'lm-studio', fetchesImageUrls: false, servesEmbeddings: false },
  { key: 'other', label: 'Another OpenAI-compatible API (you have its base URL)', aiProvider: 'openai', askBaseUrl: true, fetchesImageUrls: true, servesEmbeddings: false },
  { key: 'ollama', label: 'Ollama (local, native API)', aiProvider: 'ollama', fetchesImageUrls: false, servesEmbeddings: false },
];

/** Strip whitespace and quotes people paste along with a value. */
export function cleanInput(raw: string): string {
  let value = raw.trim();
  if (value.length >= 2 && /^(['"`]).*\1$/.test(value)) value = value.slice(1, -1).trim();
  return value;
}

export function isPlaceholder(value: string | undefined): boolean {
  return value != null && /^your_.*_here$/i.test(value.trim());
}

/** Discord snowflake IDs are 17 to 20 digits. */
export function checkSnowflake(raw: string, what: string): Check {
  const value = cleanInput(raw);
  if (!value) return { ok: false, error: `${what} is required.` };
  if (!/^\d{17,20}$/.test(value)) {
    return { ok: false, error: `${what} should be a number with 17 to 20 digits (you entered ${value.length} characters). Use Copy ID in Discord, not a name or a link.` };
  }
  return { ok: true, value };
}

/** The bot user ID encoded in the first part of a bot token, if it decodes. */
export function botIdFromToken(token: string): string | null {
  const first = token.split('.')[0];
  if (!first) return null;
  try {
    const decoded = Buffer.from(first.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return /^\d{17,20}$/.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export function checkDiscordToken(raw: string): Check {
  let value = cleanInput(raw);
  if (/^bot\s+/i.test(value)) value = value.replace(/^bot\s+/i, '');
  if (!value) return { ok: false, error: 'The bot token is required.' };
  if (isPlaceholder(value)) return { ok: false, error: 'That is the placeholder from .env.example, not a token.' };
  if (/\s/.test(value)) return { ok: false, error: 'A bot token has no spaces. Copy it again from Developer Portal → your app → Bot → Reset Token.' };
  const parts = value.split('.');
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    if (/^[A-Za-z0-9_-]{32}$/.test(value)) {
      return { ok: false, error: 'That looks like the Client Secret (OAuth2 page). Sass needs the bot token: Developer Portal → your app → Bot → Reset Token.' };
    }
    if (/^\d{17,20}$/.test(value)) {
      return { ok: false, error: 'That is an ID, not a token. The token is on Developer Portal → your app → Bot → Reset Token.' };
    }
    return { ok: false, error: 'A bot token has three parts separated by dots. Copy it again from Developer Portal → your app → Bot → Reset Token.' };
  }
  if (!botIdFromToken(value)) {
    return { ok: true, value, warning: 'The token does not look like a usual bot token. Double-check you copied all of it.' };
  }
  return { ok: true, value };
}

export function normalizeBaseUrl(raw: string): Check {
  let value = cleanInput(raw);
  if (!value) return { ok: false, error: 'A base URL is required for this provider.' };
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: `"${value}" is not a valid URL.` };
  }
  let path = url.pathname.replace(/\/+$/, '');
  let warning: string | undefined;
  for (const suffix of ['/chat/completions', '/completions', '/embeddings', '/models']) {
    if (path.endsWith(suffix)) {
      path = path.slice(0, -suffix.length);
      warning = `Removed "${suffix}": the base URL stops before the endpoint name.`;
      break;
    }
  }
  const normalized = `${url.protocol}//${url.host}${path}`;
  if (!/\/v\d/.test(path) && !warning) {
    warning = 'Most OpenAI-compatible base URLs end in /v1. Check your provider\'s docs if requests fail.';
  }
  return warning ? { ok: true, value: normalized, warning } : { ok: true, value: normalized };
}

export function normalizeHost(raw: string): Check {
  const value = cleanInput(raw).replace(/\/+$/, '');
  if (!value) return { ok: false, error: 'The Ollama URL is required.' };
  const withScheme = /^https?:\/\//i.test(value) ? value : `http://${value}`;
  try {
    const url = new URL(withScheme);
    return { ok: true, value: `${url.protocol}//${url.host}` };
  } catch {
    return { ok: false, error: `"${value}" is not a valid URL.` };
  }
}

/** Known key prefixes. A mismatch is only a warning: hosts change formats. */
const KEY_PREFIXES: Record<string, string> = {
  openai: 'sk-',
  openrouter: 'sk-or-',
  groq: 'gsk_',
  xai: 'xai-',
};

export function checkApiKey(raw: string, providerKey: string): Check {
  const value = cleanInput(raw);
  if (!value) return { ok: false, error: 'An API key is required for this provider.' };
  if (isPlaceholder(value)) return { ok: false, error: 'That is the placeholder from .env.example, not a key.' };
  if (/\s/.test(value)) return { ok: false, error: 'An API key has no spaces. Copy it again.' };
  const prefix = KEY_PREFIXES[providerKey];
  if (prefix && !value.startsWith(prefix)) {
    return { ok: true, value, warning: `Keys for this provider usually start with "${prefix}". Make sure it is the right key.` };
  }
  return { ok: true, value };
}

export function checkModel(raw: string): Check {
  const value = cleanInput(raw);
  if (!value) return { ok: false, error: 'A model name is required.' };
  if (/\s/.test(value)) return { ok: false, error: 'Model names have no spaces.' };
  return { ok: true, value };
}

export function checkDatabaseUrl(raw: string): Check {
  const value = cleanInput(raw);
  if (!value) return { ok: true, value: '' };
  if (!/^postgres(ql)?:\/\//i.test(value)) {
    return { ok: false, error: 'DATABASE_URL should start with postgres:// or postgresql://. Leave it empty to run without a database.' };
  }
  try {
    new URL(value);
  } catch {
    return { ok: false, error: 'That connection string is not a valid URL. Special characters in the password must be URL-encoded.' };
  }
  return { ok: true, value };
}

export function checkChance(raw: string): Check {
  const value = cleanInput(raw);
  const n = Number(value);
  if (!value || !Number.isFinite(n) || n < 0 || n > 1) return { ok: false, error: 'Enter a number from 0 to 1, for example 0.4.' };
  return { ok: true, value };
}

export function checkPositiveInt(raw: string): Check {
  const value = cleanInput(raw);
  if (!/^\d+$/.test(value) || Number(value) < 1) return { ok: false, error: 'Enter a whole number of 1 or more.' };
  return { ok: true, value };
}

export function inviteUrl(clientId: string): string {
  // Same permissions as the README: View Channels, Send Messages, Embed Links, Attach Files,
  // Read Message History, Add Reactions, Use External Emojis.
  return `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot+applications.commands&permissions=379968`;
}

function quoteEnvValue(value: string): string {
  if (value === '' || /^[A-Za-z0-9_\-.:/@+=,%?&~]+$/.test(value)) return value;
  if (!value.includes("'")) return `'${value}'`;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Fill `.env.example` with values, keeping its comments and order.
 * `KEY=...` and commented `# KEY=...` lines are replaced when a value is given;
 * keys in `values` that the template lacks are appended. `undefined` keeps the template line,
 * and an empty value leaves a commented example commented.
 */
export function renderEnv(template: string, values: Record<string, string | undefined>): string {
  const done = new Set<string>();
  const lines = template.split(/\r?\n/).map((line) => {
    const match = /^(#\s*)?([A-Z][A-Z0-9_]*)=/.exec(line);
    const key = match?.[2];
    if (!key || !(key in values)) return line;
    const value = values[key];
    if (value === undefined || done.has(key)) return line;
    done.add(key);
    // Leave an optional, commented-out example commented when there is nothing to set.
    if (value === '' && match?.[1]) return line;
    return `${key}=${quoteEnvValue(value)}`;
  });
  const extra = Object.entries(values).filter(([key, value]) => value !== undefined && !done.has(key));
  if (extra.length > 0) {
    if (lines.at(-1) !== '') lines.push('');
    for (const [key, value] of extra) lines.push(`${key}=${quoteEnvValue(value ?? '')}`);
  }
  let out = lines.join('\n');
  if (!out.endsWith('\n')) out += '\n';
  return out;
}

/** Describe a secret without printing any of it. */
export function describeSecret(value: string | undefined): string {
  if (!value) return 'not set';
  return `set (${value.length} characters, hidden)`;
}
