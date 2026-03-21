/**
 * responseMemory.ts — Track Sass's recent responses per channel.
 *
 * Prevents crutch phrases and repetition by giving the AI visibility
 * into what Sass already said recently. In-memory only (resets on deploy).
 */

const MAX_RESPONSES_PER_CHANNEL = 5;
const MAX_TRACKED_CHANNELS = 500;
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 min

const channelResponses = new Map<string, string[]>();

/**
 * Record a response Sass sent in a channel.
 */
export function recordResponse(channelId: string, response: string): void {
  if (!channelResponses.has(channelId)) {
    // Evict oldest channel if at capacity
    if (channelResponses.size >= MAX_TRACKED_CHANNELS) {
      const oldest = channelResponses.keys().next().value;
      if (oldest !== undefined) {
        channelResponses.delete(oldest);
      }
    }
    channelResponses.set(channelId, []);
  }

  const responses = channelResponses.get(channelId);
  if (!responses) return;
  responses.push(response);
  if (responses.length > MAX_RESPONSES_PER_CHANNEL) {
    responses.shift();
  }
}

/**
 * Get Sass's recent responses in a channel as context for the AI.
 * Returns a formatted string or empty string if no history.
 */
export function getRecentResponses(channelId: string): string {
  const responses = channelResponses.get(channelId);
  if (!responses || responses.length === 0) return '';

  return 'YOUR RECENT RESPONSES IN THIS CHANNEL (DO NOT repeat these or use similar phrasing):\n' +
    responses.map((r) => `- "${r}"`).join('\n');
}

// Periodic cleanup of channels with stale data
setInterval(() => {
  if (channelResponses.size > MAX_TRACKED_CHANNELS / 2) {
    let toDelete = channelResponses.size - Math.floor(MAX_TRACKED_CHANNELS / 2);
    for (const key of channelResponses.keys()) {
      if (toDelete <= 0) break;
      channelResponses.delete(key);
      toDelete--;
    }
  }
}, CLEANUP_INTERVAL_MS);
