import { withUserDataContext } from '../database/userDataGuard.js';
import type { Client, TextChannel } from 'discord.js';
import { handleMention } from '../handlers/mention/index.js';
import { handleAutoSass } from '../handlers/autoSass.js';
import { handleBattleMessage } from '../commands/index.js';
import { messageBuffer } from '../messageBuffer.js';
import * as userMemory from '../userMemory.js';
import { recordPairInteraction } from '../shipScore.js';
import type { SassEvent } from '../types.js';
import { pickRandom } from '../shared/commandUtils.js';
import { mentionsSass } from '../shared/sassMention.js';

// Dedup guard — prevent processing the same message twice
// Using a Map with timestamps for automatic cleanup
const processedMessages = new Map<string, number>();
const recentUserReplies = new Map<string, number>();
const recentUserMessages = new Map<string, { content: string; count: number; timestamp: number }>();
const USER_REPLY_COOLDOWN_MS = 3000; // 3 second cooldown per user
const SPAM_WINDOW_MS = 60_000; // 1 minute window for spam detection
const SPAM_THRESHOLD = 2; // ignore after 2 similar messages in the window
const MAX_RECENT_TRACKED = 500; // cap for recentUserReplies + recentUserMessages

function isDuplicate(messageId: string): boolean {
  if (processedMessages.has(messageId)) return true;
  processedMessages.set(messageId, Date.now());
  // Clean up entries older than 60 seconds
  if (processedMessages.size > 200) {
    const cutoff = Date.now() - 60_000;
    for (const [id, ts] of processedMessages) {
      if (ts < cutoff) processedMessages.delete(id);
    }
  }
  return false;
}

function isUserOnCooldown(userId: string): boolean {
  const lastReply = recentUserReplies.get(userId);
  if (lastReply && Date.now() - lastReply < USER_REPLY_COOLDOWN_MS) return true;
  recentUserReplies.set(userId, Date.now());
  // Cleanup
  if (recentUserReplies.size > 200) {
    const cutoff = Date.now() - USER_REPLY_COOLDOWN_MS;
    for (const [id, ts] of recentUserReplies) {
      if (ts < cutoff) recentUserReplies.delete(id);
    }
  }
  return false;
}

function isSpamming(userId: string, content: string): boolean {
  const normalized = content.toLowerCase().trim().replace(/[?!.]+$/, '');
  if (normalized.length < 3) return false; // don't track tiny messages
  const key = userId;
  const existing = recentUserMessages.get(key);
  const now = Date.now();

  if (existing && now - existing.timestamp < SPAM_WINDOW_MS) {
    // Check similarity — same message or very similar
    const existingNorm = existing.content.toLowerCase().trim().replace(/[?!.]+$/, '');
    if (normalized === existingNorm || normalized.includes(existingNorm) || existingNorm.includes(normalized)) {
      existing.count++;
      existing.timestamp = now;
      if (existing.count >= SPAM_THRESHOLD) return true;
      return false;
    }
  }

  // New message topic — reset
  recentUserMessages.set(key, { content: normalized, count: 1, timestamp: now });
  // Cleanup
  if (recentUserMessages.size > 200) {
    const cutoff = now - SPAM_WINDOW_MS;
    for (const [id, data] of recentUserMessages) {
      if (data.timestamp < cutoff) recentUserMessages.delete(id);
    }
  }
  return false;
}

// Periodic cleanup for message-related Maps (every 30 min)
const MESSAGE_CLEANUP_MS = 30 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  // recentUserReplies — time-based + size cap (prevents unbounded growth)
  for (const [id, ts] of recentUserReplies) {
    if (now - ts > USER_REPLY_COOLDOWN_MS * 2) recentUserReplies.delete(id);
  }
  while (recentUserReplies.size > MAX_RECENT_TRACKED) {
    const oldest = recentUserReplies.keys().next().value;
    if (oldest !== undefined) recentUserReplies.delete(oldest); else break;
  }
  // recentUserMessages — time-based + size cap (prevents unbounded growth)
  for (const [id, data] of recentUserMessages) {
    if (now - data.timestamp > SPAM_WINDOW_MS * 2) recentUserMessages.delete(id);
  }
  while (recentUserMessages.size > MAX_RECENT_TRACKED) {
    const oldest = recentUserMessages.keys().next().value;
    if (oldest !== undefined) recentUserMessages.delete(oldest); else break;
  }
}, MESSAGE_CLEANUP_MS);

export function setupMessageHandler(client: Client): void {
  client.on('messageCreate', async (message) => {
    // Track ALL messages in buffer (including Sass's own) for conversation context
    messageBuffer.add(message);

    // Don't process bot messages further
    if (message.author.bot) return;

    const guildId = message.guild?.id ?? '';
    await withUserDataContext(guildId, message.author.id, async () => {

      // Track pair interactions — if this message is a reply to another user
      if (message.reference?.messageId) {
        try {
          const repliedTo = await message.channel.messages.fetch(message.reference.messageId);
          if (repliedTo?.author && !repliedTo.author.bot && repliedTo.author.id !== message.author.id) {
            recordPairInteraction(guildId, message.author.id, repliedTo.author.id);
          }
        } catch (err) { console.error('Fetch message failed:', (err as Error).message); }
      }

      // Beef detection — only real fights with direct targeting (@mention or reply + hostile language)
      const lowerText = message.content.toLowerCase();
      const fightPatterns = /\b(stfu|fight me|shut up|fuck you|fuck off|kys|you suck|loser|idiot|stupid|pathetic|brain ?dead|die mad|get rekt|go away|nobody likes|i hate you|you'?re cooked|you fell off|trash take)\b/i;
      if (fightPatterns.test(lowerText)) {
        // Check @mentioned users
        const mentionedUsers = message.mentions.users.filter((u) => !u.bot && u.id !== message.author.id);
        for (const [, mentionedUser] of mentionedUsers) {
          const topic = message.content.slice(0, 50);
          userMemory.addBeef(guildId, message.author.id, mentionedUser.id, topic)
            .catch((err) => console.error('Add beef failed:', (err as Error).message));
        }
        // Check if replying to someone
        if (message.reference?.messageId) {
          try {
            const repliedTo = await message.channel.messages.fetch(message.reference.messageId);
            if (repliedTo?.author && !repliedTo.author.bot && repliedTo.author.id !== message.author.id) {
              const topic = message.content.slice(0, 50);
              userMemory.addBeef(guildId, message.author.id, repliedTo.author.id, topic)
                .catch((err) => console.error('Add beef failed:', (err as Error).message));
            }
          } catch (err) { console.error('Fetch message failed:', (err as Error).message); }
        }
      }

      // Skip if we already processed this message (Discord can send duplicates)
      if (isDuplicate(message.id)) return;

      // Track user
      const displayName = message.author.displayName || message.author.username;
      userMemory.seen(guildId, message.author.id, displayName);

      // 0. Check if this is part of a roast battle
      const isBattle = await handleBattleMessage(message);
      if (isBattle) return;

      if (!client.user) return;
      if (!message.guild) return;

      // Build SassEvent once — clean parcel of data for all handlers
      const sassEvent: SassEvent = {
        guildId,
        channelId: message.channel.id,
        userId: message.author.id,
        displayName,
        content: message.content,
        message,
        channel: message.channel as TextChannel,
      };

      // 1. Direct mention or reply to Sass — always respond
      // Include an explicitly tagged role containing Sass, while keeping reply
      // metadata and everyone/here broadcasts out of this direct-mention path.
      const isMentionInText = mentionsSass(message.content, client.user.id, message.guild.members.me?.roles.cache, guildId);
      if (isMentionInText) {
        if (isUserOnCooldown(message.author.id)) return;
        if (isSpamming(message.author.id, message.content)) return;
        await handleMention(message, client, sassEvent);
        return;
      }

      // 1b. Reply to a Sass message — treat as conversation, let AI decide
      if (message.reference?.messageId) {
        try {
          const repliedTo = await message.channel.messages.fetch(message.reference.messageId);
          if (repliedTo?.author?.id === client.user.id) {
            // Skip short reactions — "lol", "💀", "lmao" don't need a response
            const wordCount = message.content.trim().split(/\s+/).length;
            if (wordCount < 3) {
              // Still let it flow to auto-sass for possible pickup
            } else {
              // 70% chance she responds to replies to her messages
              if (Math.random() < 0.7) {
                if (isUserOnCooldown(message.author.id)) return;
                if (isSpamming(message.author.id, message.content)) return;
                await handleAutoSass(message, client, { heardName: true }, sassEvent);
                return;
              }
            }
          }
        } catch (err) { console.error('Fetch replied message failed:', (err as Error).message); }
      }

      // 2. Someone said "sass" without @ — she heard her name
      const lowerContent = message.content.toLowerCase().trim();
      if (/\bsass\b/i.test(lowerContent) && !lowerContent.includes('sassy')) {
        // If the message is basically just her name (1-2 words), don't send to AI — just acknowledge
        const nameWordCount = lowerContent.split(/\s+/).length;
        if (nameWordCount <= 2) {
          const acks = ['what', 'you rang?', 'hm?', '?', 'what do you want'];
          const ack = pickRandom(acks);
          await message.reply(ack).catch((err) => console.error('Reply failed:', (err as Error).message));
          return;
        }
        await handleAutoSass(message, client, { heardName: true }, sassEvent);
        return;
      }

      // 3. Auto-sass — occasionally pop in uninvited
      await handleAutoSass(message, client, {}, sassEvent);
    });
  });
}
