/**
 * Rolling message buffer per channel.
 * Keeps the last N messages so Sass can read recent context
 * without fetching full channel history.
 */
const MAX_MESSAGES_PER_CHANNEL = 10;
const MAX_TRACKED_CHANNELS = 1000;

class MessageBuffer {
  constructor() {
    // Map<channelId, Array<{author, content, timestamp}>>
    this.channels = new Map();
  }

  add(message) {
    const channelId = message.channel.id;

    if (!this.channels.has(channelId)) {
      // Evict oldest channels if at capacity
      if (this.channels.size >= MAX_TRACKED_CHANNELS) {
        const oldest = this.channels.keys().next().value;
        this.channels.delete(oldest);
      }
      this.channels.set(channelId, []);
    }

    const buffer = this.channels.get(channelId);
    buffer.push({
      authorId: message.author.id,
      author: message.author.displayName || message.author.username,
      content: message.content,
      timestamp: message.createdTimestamp,
      isBot: message.author.bot || false,
    });

    // Keep only the last N messages
    if (buffer.length > MAX_MESSAGES_PER_CHANNEL) {
      buffer.shift();
    }
  }

  /**
   * Get the last `count` messages from a channel.
   * Returns them formatted as a conversation string for the AI.
   */
  getRecent(channelId, count = 3) {
    const buffer = this.channels.get(channelId) || [];
    return buffer.slice(-count).map(
      (msg) => `${msg.author}: ${msg.content}`
    ).join('\n');
  }

  getRecentRaw(channelId, count = 3) {
    const buffer = this.channels.get(channelId) || [];
    return buffer.slice(-count);
  }
}

export const messageBuffer = new MessageBuffer();
