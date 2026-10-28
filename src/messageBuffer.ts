import type { Message, BufferEntry, ChannelSummary } from './types.js';
import { summarizeMessages } from './ai/index.js';
import { resolveMentions, speakerLabel } from './shared/speaker.js';

/**
 * Rolling message buffer per channel.
 * Keeps the last N messages so Sass can read recent context
 * without fetching full channel history.
 *
 * Context compaction: when the buffer overflows by 10+ messages,
 * the dropped messages are summarized into a compact context line
 * so Sass retains awareness of earlier conversation topics.
 */
const MAX_MESSAGES_PER_CHANNEL = 30;
const MAX_TRACKED_CHANNELS = 1000;
const COMPACTION_BATCH_SIZE = 10;
const MAX_SUMMARY_LENGTH = 300;
const SUMMARY_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const MAX_COMPACTION_FAILURES = 3; // stop trying after 3 consecutive failures (circuit breaker)

class MessageBuffer {
  channels: Map<string, BufferEntry[]>;
  private summaries: Map<string, ChannelSummary>;
  private pendingCompaction: Set<string>;
  private compactionFailures: Map<string, number>; // per-channel circuit breaker

  constructor() {
    this.channels = new Map();
    this.summaries = new Map();
    this.pendingCompaction = new Set();
    this.compactionFailures = new Map();
  }

  add(message: Message): void {
    const channelId = message.channel.id;

    if (!this.channels.has(channelId)) {
      // Evict oldest channels if at capacity
      if (this.channels.size >= MAX_TRACKED_CHANNELS) {
        const oldest = this.channels.keys().next().value;
        if (oldest !== undefined) {
          this.channels.delete(oldest);
          this.summaries.delete(oldest);
          this.compactionFailures.delete(oldest);
        }
      }
      this.channels.set(channelId, []);
    }

    const buffer = this.channels.get(channelId);
    if (!buffer) return;
    const selfId = message.client?.user?.id;
    buffer.push({
      authorId: message.author.id,
      author: message.author.displayName || message.author.username,
      content: resolveMentions(message.content, selfId, message.mentions?.users?.values() ?? []),
      timestamp: message.createdTimestamp,
      isBot: message.author.bot || false,
      messageId: message.id,
      isSelf: selfId !== undefined && message.author.id === selfId,
    });

    // Compact and trim when buffer overflows
    if (buffer.length > MAX_MESSAGES_PER_CHANNEL) {
      const overflow = buffer.length - MAX_MESSAGES_PER_CHANNEL;

      // If enough messages are being dropped, no compaction in progress,
      // and circuit breaker hasn't tripped for this channel — capture and summarize async
      if (overflow >= COMPACTION_BATCH_SIZE && !this.pendingCompaction.has(channelId) && (this.compactionFailures.get(channelId) ?? 0) < MAX_COMPACTION_FAILURES) {
        const dropped = buffer.slice(0, overflow);
        this.compactChannel(channelId, dropped).catch((err) =>
          console.error('Buffer compaction failed:', (err as Error).message)
        );
      }

      buffer.splice(0, overflow);
    }
  }

  /**
   * Get the last `count` messages from a channel.
   * Returns them formatted as a conversation string for the AI.
   */
  getRecent(channelId: string, count = 3): string {
    const buffer = this.channels.get(channelId) || [];
    return buffer.slice(-count).map(
      (msg) => `${speakerLabel(msg)}: ${msg.content}`
    ).join('\n');
  }

  getRecentRaw(channelId: string, count = 3): BufferEntry[] {
    const buffer = this.channels.get(channelId) || [];
    return buffer.slice(-count);
  }

  /**
   * Get the compacted summary of earlier messages for this channel.
   * Returns null if no summary exists or if it's expired.
   */
  getSummary(channelId: string): string | null {
    const summary = this.summaries.get(channelId);
    if (!summary) return null;

    // Expire stale summaries — old context is worse than none
    if (Date.now() - summary.timestamp > SUMMARY_EXPIRY_MS) {
      this.summaries.delete(channelId);
      return null;
    }

    return `[Earlier context (${summary.messageCount} messages): ${summary.text}]`;
  }

  /**
   * Inject a system/bot message into the buffer so Sass can see slash command results.
   * Used after slash commands output embeds that Sass can't otherwise see.
   */
  injectBotMessage(channelId: string, summary: string): void {
    if (!this.channels.has(channelId)) {
      if (this.channels.size >= MAX_TRACKED_CHANNELS) {
        const oldest = this.channels.keys().next().value;
        if (oldest !== undefined) {
          this.channels.delete(oldest);
          this.summaries.delete(oldest);
          this.compactionFailures.delete(oldest);
        }
      }
      this.channels.set(channelId, []);
    }

    const buffer = this.channels.get(channelId);
    if (!buffer) return;
    buffer.push({
      authorId: 'system',
      author: 'Sass',
      content: summary,
      timestamp: Date.now(),
      isBot: true,
      isSelf: true,
    });

    if (buffer.length > MAX_MESSAGES_PER_CHANNEL) {
      buffer.shift();
    }
  }

  /**
   * Summarize dropped messages and store as compact context.
   * Runs async — the buffer is already trimmed by the time this completes.
   */
  private async compactChannel(channelId: string, dropped: BufferEntry[]): Promise<void> {
    this.pendingCompaction.add(channelId);
    try {
      const newSummary = await summarizeMessages(dropped);
      if (!newSummary) {
        const fails = (this.compactionFailures.get(channelId) ?? 0) + 1;
        this.compactionFailures.set(channelId, fails);
        if (fails >= MAX_COMPACTION_FAILURES) {
          console.warn(`[COMPACTION] Circuit breaker tripped for channel ${channelId} after ${fails} failures`);
        }
        return;
      }

      // Success — reset failure counter for this channel
      this.compactionFailures.delete(channelId);

      const existing = this.summaries.get(channelId);
      let combinedText: string;
      let totalCount: number;

      if (existing) {
        combinedText = `${existing.text} | ${newSummary}`;
        totalCount = existing.messageCount + dropped.length;
      } else {
        combinedText = newSummary;
        totalCount = dropped.length;
      }

      // Cap summary length — truncate from front (older context less relevant)
      if (combinedText.length > MAX_SUMMARY_LENGTH) {
        combinedText = '...' + combinedText.slice(combinedText.length - MAX_SUMMARY_LENGTH + 3);
      }

      // Evict oldest summary if at capacity
      if (!this.summaries.has(channelId) && this.summaries.size >= MAX_TRACKED_CHANNELS) {
        const oldest = this.summaries.keys().next().value;
        if (oldest !== undefined) {
          this.summaries.delete(oldest);
        }
      }

      this.summaries.set(channelId, {
        text: combinedText,
        messageCount: totalCount,
        timestamp: Date.now(),
      });
    } finally {
      this.pendingCompaction.delete(channelId);
    }
  }
}

export const messageBuffer = new MessageBuffer();
