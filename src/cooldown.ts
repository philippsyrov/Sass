/**
 * Per-user cooldown to prevent Sass from spam-replying.
 * Also tracks per-channel cooldown for auto-sass.
 * Escalation ladder tracks persistent taggers.
 * Periodic cleanup prevents unbounded Map growth.
 */
const MENTION_COOLDOWN_MS = 3000;   // 3s between replies to same user
const AUTO_SASS_COOLDOWN_MS = 60000; // 60s between auto-sass in same channel
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // clean up every 5 min

// Escalation window — track tags within this window
const ESCALATION_WINDOW_MS = 5 * 60 * 1000; // 5 min window
const MAX_TRACKED_ESCALATIONS = 500;

export type EscalationLevel = 'normal' | 'annoyed' | 'cold' | 'petty';

interface EscalationEntry {
  tags: number[];  // timestamps of recent tags
  level: EscalationLevel;
}

const userCooldowns = new Map<string, number>();
const channelCooldowns = new Map<string, number>();
const escalationTracker = new Map<string, EscalationEntry>();

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

/**
 * Track a mention from a user and return their escalation level.
 * Levels based on tags in the last 5 minutes:
 * - normal: 0-4 tags
 * - annoyed: 5-9 tags (sass gets more annoyed)
 * - cold: 10-19 tags (starts ignoring/being dismissive)
 * - petty: 20+ tags (callbacks to how much they've been tagging)
 */
export function trackMentionEscalation(userId: string): EscalationLevel {
  const now = Date.now();

  if (!escalationTracker.has(userId)) {
    // Evict oldest if at capacity
    if (escalationTracker.size >= MAX_TRACKED_ESCALATIONS) {
      const oldest = escalationTracker.keys().next().value;
      if (oldest !== undefined) {
        escalationTracker.delete(oldest);
      }
    }
    escalationTracker.set(userId, { tags: [], level: 'normal' });
  }

  const entry = escalationTracker.get(userId);
  if (!entry) return 'normal';

  // Clean old tags outside the window
  entry.tags = entry.tags.filter((ts) => now - ts < ESCALATION_WINDOW_MS);
  entry.tags.push(now);

  const count = entry.tags.length;

  if (count >= 20) {
    entry.level = 'petty';
  } else if (count >= 10) {
    entry.level = 'cold';
  } else if (count >= 5) {
    entry.level = 'annoyed';
  } else {
    entry.level = 'normal';
  }

  return entry.level;
}

/**
 * Get the tag count for a user in the current escalation window.
 */
export function getEscalationCount(userId: string): number {
  const entry = escalationTracker.get(userId);
  if (!entry) return 0;
  const now = Date.now();
  return entry.tags.filter((ts) => now - ts < ESCALATION_WINDOW_MS).length;
}

// Periodic cleanup of expired cooldowns and escalation data
setInterval(() => {
  const now = Date.now();
  for (const [id, ts] of userCooldowns) {
    if (now - ts > MENTION_COOLDOWN_MS) userCooldowns.delete(id);
  }
  for (const [id, ts] of channelCooldowns) {
    if (now - ts > AUTO_SASS_COOLDOWN_MS) channelCooldowns.delete(id);
  }
  for (const [id, entry] of escalationTracker) {
    entry.tags = entry.tags.filter((ts) => now - ts < ESCALATION_WINDOW_MS);
    if (entry.tags.length === 0) escalationTracker.delete(id);
  }
}, CLEANUP_INTERVAL_MS);
