import { queryAI } from '../../ai/index.js';
import { updateAffinity } from '../../database/index.js';
import type { Message, TextChannel } from 'discord.js';

// Remember cooldown — prevent spamming remember commands
export const rememberCooldowns = new Map<string, number>();
const REMEMBER_COOLDOWN_MS = 30 * 1000; // 30 seconds between remembers
const MAX_REMEMBER_COOLDOWNS = 500;

// Spam tracker — detect low-effort repeated pings
const spamTracker = new Map<string, { count: number; lastTimestamp: number }>();
const SPAM_WINDOW_MS = 2 * 60 * 1000; // 2 minutes
const SPAM_THRESHOLD = 3; // 3+ low-effort messages = ignore
const MAX_SPAM_TRACKER = 500;

// Sensitive topic tracker — soft-ban users who spam drama
const sensitiveTracker = new Map<string, { count: number; lastTimestamp: number; softBanUntil: number }>();
const SENSITIVE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const SENSITIVE_BAN_MS = 15 * 60 * 1000; // 15 minute soft-ban
const MAX_SENSITIVE_TRACKER = 500;
const SENSITIVE_KEYWORDS = /\b(kill myself|wanna die|killing myself|i'm dying|im dying|bleeding out|gonna bleed|self.?harm|end it all|jump off|hang myself|slit my|cut myself|overdose|i'm dead|im dead|my arm fell off|pass out|bleeding everywhere)\b/i;

// Affinity gain cooldown — max 1 gain per 10 min per user
export const affinityGainCooldowns = new Map<string, number>();
export const AFFINITY_GAIN_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes
const MAX_AFFINITY_COOLDOWNS = 500;

// Clean up cooldowns every 10 min
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of rememberCooldowns) {
    if (now - ts > REMEMBER_COOLDOWN_MS) rememberCooldowns.delete(key);
  }
  for (const [key, entry] of spamTracker) {
    if (now - entry.lastTimestamp > SPAM_WINDOW_MS) spamTracker.delete(key);
  }
  // FIFO eviction if still over cap after time-based cleanup
  while (spamTracker.size > MAX_SPAM_TRACKER) {
    const oldest = spamTracker.keys().next().value;
    if (oldest !== undefined) spamTracker.delete(oldest); else break;
  }
  for (const [key, entry] of sensitiveTracker) {
    if (now - entry.lastTimestamp > SENSITIVE_BAN_MS * 2) sensitiveTracker.delete(key);
  }
  while (sensitiveTracker.size > MAX_SENSITIVE_TRACKER) {
    const oldest = sensitiveTracker.keys().next().value;
    if (oldest !== undefined) sensitiveTracker.delete(oldest); else break;
  }
  for (const [key, ts] of affinityGainCooldowns) {
    if (now - ts > AFFINITY_GAIN_COOLDOWN_MS) affinityGainCooldowns.delete(key);
  }
  while (affinityGainCooldowns.size > MAX_AFFINITY_COOLDOWNS) {
    const oldest = affinityGainCooldowns.keys().next().value;
    if (oldest !== undefined) affinityGainCooldowns.delete(oldest); else break;
  }
}, 10 * 60 * 1000);

/**
 * Check if the user is spamming low-effort pings (<=5 chars).
 * Returns true if the message should be ignored (spam threshold reached).
 * Resets tracker if the message is a real message (>5 chars).
 */
export function isSpamPing(guildId: string, userId: string, cleanContent: string): boolean {
  const spamKey = `${guildId}:${userId}`;
  if (cleanContent.length <= 5) {
    const now = Date.now();
    const entry = spamTracker.get(spamKey);
    if (entry && now - entry.lastTimestamp < SPAM_WINDOW_MS) {
      entry.count++;
      entry.lastTimestamp = now;
      if (entry.count >= SPAM_THRESHOLD) {
        // Silently ignore — no API call, no response
        updateAffinity(guildId, userId, -3).catch((err) => console.error('Affinity update failed:', (err as Error).message));
        return true;
      }
    } else {
      spamTracker.set(spamKey, { count: 1, lastTimestamp: now });
    }
  } else {
    // Real message — reset spam counter
    spamTracker.delete(spamKey);
  }
  return false;
}

/**
 * Check if the message contains sensitive topics (self-harm, etc.).
 * Returns 'ignore' if the user is soft-banned, 'check-in' if their ban just expired,
 * or null if no sensitive content detected / first occurrence allowed through.
 */
export async function isSensitiveTopic(
  message: Message,
  guildId: string,
  userId: string,
  displayName: string,
  cleanContent: string,
): Promise<'ignore' | 'check-in' | null> {
  if (!SENSITIVE_KEYWORDS.test(cleanContent)) return null;

  const sensitiveKey = `${guildId}:${userId}`;
  const now = Date.now();
  const entry = sensitiveTracker.get(sensitiveKey);

  if (entry?.softBanUntil && now < entry.softBanUntil) {
    // Still soft-banned — ignore completely
    return 'ignore';
  }

  if (entry?.softBanUntil && now >= entry.softBanUntil) {
    // Soft-ban expired — check-in message
    sensitiveTracker.delete(sensitiveKey);
    const channel = message.channel as TextChannel;
    await channel.sendTyping().catch((err) => console.error('sendTyping failed:', (err as Error).message));
    const checkIn = await queryAI(`${displayName} was being dramatic earlier about injuries/death. They just messaged again. Give a short sassy check-in like "you good now?" or "you better? i need proof." Keep it under 10 words, be sassy but not mean.`, { temperature: 1.0 });
    if (checkIn) {
      await message.reply(checkIn).catch((err) => console.error('Reply failed:', (err as Error).message));
    }
    return 'check-in';
  }

  if (entry && now - entry.lastTimestamp < SENSITIVE_WINDOW_MS) {
    entry.count++;
    entry.lastTimestamp = now;
    if (entry.count >= 2) {
      // 2nd+ sensitive message — soft-ban
      entry.softBanUntil = now + SENSITIVE_BAN_MS;
      return 'ignore';
    }
  } else {
    sensitiveTracker.set(sensitiveKey, { count: 1, lastTimestamp: now, softBanUntil: 0 });
  }
  // First sensitive message — let AI handle with dismiss hint (added to escalationContext later)
  return null;
}

/**
 * Check if the user is on remember cooldown.
 */
export function isOnRememberCooldown(guildId: string, userId: string): boolean {
  const rememberKey = `${guildId}:${userId}`;
  const lastRemember = rememberCooldowns.get(rememberKey);
  const now = Date.now();
  return !!(lastRemember && now - lastRemember < REMEMBER_COOLDOWN_MS);
}

/**
 * Set the remember cooldown for a user (with FIFO eviction).
 */
export function setRememberCooldown(guildId: string, userId: string): void {
  const rememberKey = `${guildId}:${userId}`;
  rememberCooldowns.set(rememberKey, Date.now());
  if (rememberCooldowns.size > MAX_REMEMBER_COOLDOWNS) {
    const oldest = rememberCooldowns.keys().next().value;
    if (oldest !== undefined) rememberCooldowns.delete(oldest);
  }
}

/**
 * Get the sensitive hint for the AI context (if user sent 1 sensitive message).
 */
export function getSensitiveHint(guildId: string, userId: string, displayName: string): string {
  const sensitiveEntry = sensitiveTracker.get(`${guildId}:${userId}`);
  return sensitiveEntry?.count === 1 ? `NOTE: ${displayName} is being dramatic about injuries/death for attention. Dismiss with sass. Do not engage seriously or play along. "i'm not paid enough for this" energy.` : '';
}
