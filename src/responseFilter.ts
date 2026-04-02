const MAX_RESPONSE_WORDS = 50;

const BANNED_FILLER_OPENERS = [
  'nah,',
  'yeah,',
  'honestly,',
  'lol,',
  'not gonna lie',
  'i mean,',
];

const TECH_REVEAL_PATTERN = /\b(openai|gpt|postgres|railway|database|api|token|embedding|vector|cosine)\b/i;
const COMMENTATOR_VOICE_PATTERN = /^(they're|everyone's|the chat is|people are)\b/i;

export function validateResponse(response: string): { valid: boolean; reason?: string } {
  const trimmed = response.trim();
  if (!trimmed) {
    return { valid: false, reason: 'empty' };
  }

  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (wordCount > MAX_RESPONSE_WORDS) {
    return { valid: false, reason: 'too_long' };
  }

  const lower = trimmed.toLowerCase();
  if (BANNED_FILLER_OPENERS.some((opener) => lower.startsWith(opener))) {
    return { valid: false, reason: 'filler_opener' };
  }

  if (TECH_REVEAL_PATTERN.test(trimmed)) {
    return { valid: false, reason: 'technical_reveal' };
  }

  if (COMMENTATOR_VOICE_PATTERN.test(lower)) {
    return { valid: false, reason: 'commentator_voice' };
  }

  return { valid: true };
}
