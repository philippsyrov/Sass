// --- Global slash command rate limit per user with soft ban escalation ---

const slashCmdTracker = new Map<string, number[]>();
const slashCmdStrikes = new Map<string, { count: number; bannedUntil: number }>();
const SLASH_CMD_LIMIT = 5; // max commands per window
const SLASH_CMD_WINDOW_MS = 3 * 60 * 1000; // 3 minute window
const SOFT_BAN_DURATION_MS = 10 * 60 * 1000; // 10 min soft ban
const SLASH_CMD_MAX_TRACKED = 500;

export const SLASH_RATE_LIMIT_RESPONSES = [
  "electricity ain't free, chill out with the commands.",
  "i'm not a vending machine, relax.",
  "bro you've used like 5 commands in a row. go outside.",
  "slow down, i'm not getting paid enough for this.",
  "you're speedrunning my patience rn.",
  "my owner pays per word and you're costing him rent.",
  "you know these cost money right. like actual money.",
  "command cooldown. go drink water or something.",
  "nah, i need a break from you specifically.",
  "i'm unionizing. no more commands for a bit.",
];

export const SOFT_BAN_RESPONSES = [
  "you're cut off. come back in 10 minutes and think about what you did.",
  "nope. you've been benched. 10 minute timeout.",
  "i'm putting you in the corner for 10 minutes. reflect.",
];

export const SOFT_BAN_ATTEMPT_RESPONSES = [
  "you're still banned. go touch grass.",
  "no.",
  "timeout means timeout.",
  "still no. try again in a few.",
];

export type RateLimitResult = 'ok' | 'limited' | 'soft-banned' | 'already-banned';

export function checkSlashRateLimit(userId: string): RateLimitResult {
  const now = Date.now();

  // Check soft ban first
  const strike = slashCmdStrikes.get(userId);
  if (strike && strike.bannedUntil > now) {
    return 'already-banned';
  }

  // Clear expired ban
  if (strike && strike.bannedUntil <= now) {
    slashCmdStrikes.delete(userId);
  }

  if (!slashCmdTracker.has(userId)) {
    if (slashCmdTracker.size >= SLASH_CMD_MAX_TRACKED) {
      const oldest = slashCmdTracker.keys().next().value;
      if (oldest !== undefined) slashCmdTracker.delete(oldest);
    }
    slashCmdTracker.set(userId, []);
  }
  const timestamps = slashCmdTracker.get(userId);
  if (!timestamps) return 'ok';

  const recent = timestamps.filter((ts) => now - ts < SLASH_CMD_WINDOW_MS);
  recent.push(now);
  slashCmdTracker.set(userId, recent);

  if (recent.length <= SLASH_CMD_LIMIT) return 'ok';

  // They hit the limit — track strikes
  const currentStrike = slashCmdStrikes.get(userId) ?? { count: 0, bannedUntil: 0 };
  currentStrike.count++;

  // 3rd strike = soft ban
  if (currentStrike.count >= 3) {
    currentStrike.bannedUntil = now + SOFT_BAN_DURATION_MS;
    slashCmdStrikes.set(userId, currentStrike);
    return 'soft-banned';
  }

  slashCmdStrikes.set(userId, currentStrike);
  return 'limited';
}

// Cleanup trackers + FIFO eviction at size cap
setInterval(() => {
  const now = Date.now();
  for (const [id, timestamps] of slashCmdTracker) {
    const recent = timestamps.filter((ts) => now - ts < SLASH_CMD_WINDOW_MS);
    if (recent.length === 0) slashCmdTracker.delete(id);
    else slashCmdTracker.set(id, recent);
  }
  while (slashCmdTracker.size > SLASH_CMD_MAX_TRACKED) {
    const oldest = slashCmdTracker.keys().next().value;
    if (oldest !== undefined) slashCmdTracker.delete(oldest); else break;
  }
  for (const [id, strike] of slashCmdStrikes) {
    if (strike.bannedUntil < now) slashCmdStrikes.delete(id);
  }
  while (slashCmdStrikes.size > SLASH_CMD_MAX_TRACKED) {
    const oldest = slashCmdStrikes.keys().next().value;
    if (oldest !== undefined) slashCmdStrikes.delete(oldest); else break;
  }
}, 5 * 60 * 1000);
