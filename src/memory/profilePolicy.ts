export const DISTILL_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const MAX_PROFILE_AGE_MS = 4 * DISTILL_INTERVAL_MS;

/** Only concise, plain text summaries should replace the underlying facts. */
export function isValidDistilledProfile(profile: unknown): profile is string {
  if (typeof profile !== 'string') return false;
  const text = profile.trim();
  return text.length > 0 && text.length <= 500 && text.split(/\s+/).length <= 30
    && !/[\r\n`#*<>]/.test(text)
    && !/^(?:sorry\b|i(?:'m| am) sorry\b|i (?:can(?:not|'t)|won't|am unable to)\b|unable to\b|as an ai\b|error\b|no (?:information|data|profile)\b|(?:i )?don(?:'t| not) know\b)/i.test(text)
    && !/\b(?:can't think|cannot generate|failed to generate|no information available)\b/i.test(text);
}

export function isUsableDistilledProfile(profile: unknown, updatedAt: unknown, now = Date.now()): boolean {
  if (!isValidDistilledProfile(profile) || updatedAt == null) return false;
  const time = updatedAt instanceof Date ? updatedAt.getTime() : new Date(updatedAt as string | number).getTime();
  return Number.isFinite(time) && time <= now && now - time <= MAX_PROFILE_AGE_MS;
}
