/**
 * Per-user cooldown to prevent Sass from spam-replying.
 * Also tracks per-channel cooldown for auto-sass.
 */
const MENTION_COOLDOWN_MS = 3000;   // 3s between replies to same user
const AUTO_SASS_COOLDOWN_MS = 60000; // 60s between auto-sass in same channel

const userCooldowns = new Map();
const channelCooldowns = new Map();

export function isOnMentionCooldown(userId) {
  const last = userCooldowns.get(userId) || 0;
  return Date.now() - last < MENTION_COOLDOWN_MS;
}

export function setMentionCooldown(userId) {
  userCooldowns.set(userId, Date.now());
}

export function isOnAutoSassCooldown(channelId) {
  const last = channelCooldowns.get(channelId) || 0;
  return Date.now() - last < AUTO_SASS_COOLDOWN_MS;
}

export function setAutoSassCooldown(channelId) {
  channelCooldowns.set(channelId, Date.now());
}
