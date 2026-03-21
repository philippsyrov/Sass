/**
 * Per-user cooldown to prevent Sass from spam-replying.
 * Also tracks per-channel cooldown for auto-sass.
 * Periodic cleanup prevents unbounded Map growth.
 */
const MENTION_COOLDOWN_MS = 3000;   // 3s between replies to same user
const AUTO_SASS_COOLDOWN_MS = 60000; // 60s between auto-sass in same channel
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // clean up every 5 min

const userCooldowns = new Map<string, number>();
const channelCooldowns = new Map<string, number>();

export function isOnMentionCooldown(userId: string): boolean {
  const last = userCooldowns.get(userId) || 0;
  return Date.now() - last < MENTION_COOLDOWN_MS;
}

export function setMentionCooldown(userId: string): void {
  userCooldowns.set(userId, Date.now());
}

export function isOnAutoSassCooldown(channelId: string): boolean {
  const last = channelCooldowns.get(channelId) || 0;
  return Date.now() - last < AUTO_SASS_COOLDOWN_MS;
}

export function setAutoSassCooldown(channelId: string): void {
  channelCooldowns.set(channelId, Date.now());
}

// Periodic cleanup of expired cooldowns to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [id, ts] of userCooldowns) {
    if (now - ts > MENTION_COOLDOWN_MS) userCooldowns.delete(id);
  }
  for (const [id, ts] of channelCooldowns) {
    if (now - ts > AUTO_SASS_COOLDOWN_MS) channelCooldowns.delete(id);
  }
}, CLEANUP_INTERVAL_MS);
