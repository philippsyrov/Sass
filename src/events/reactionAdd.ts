import { withUserDataContext } from '../database/userDataGuard.js';
import type { Client } from 'discord.js';
import { logReaction, updateAffinity } from '../database/index.js';
import { queryAI } from '../ai/index.js';
import * as userMemory from '../userMemory.js';
import { recordPairInteraction } from '../shipScore.js';

// Track which users already got affinity for reacting to a specific message (prevent spam-reacting)
const reactionAffinityTracker = new Map<string, Set<string>>();
const REACTION_AFFINITY_CLEANUP_MS = 30 * 60 * 1000; // 30 min
const MAX_REACTION_AFFINITY_ENTRIES = 500;

// Time-based cooldown for reaction affinity — same 10-min cooldown as mentions
// Prevents bulk-reacting to old messages to farm affinity
const reactionAffinityCooldowns = new Map<string, number>();
const REACTION_AFFINITY_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes
const MAX_REACTION_COOLDOWNS = 500;

const NEGATIVE_EMOJI = new Set(['👎', '😐', '🤡', '❌']);

// Periodic cleanup for reaction-related Maps (every 30 min)
setInterval(() => {
  const now = Date.now();
  // Reaction affinity tracker — FIFO eviction
  if (reactionAffinityTracker.size > MAX_REACTION_AFFINITY_ENTRIES) {
    const entries = [...reactionAffinityTracker.keys()];
    const toDelete = entries.slice(0, entries.length - MAX_REACTION_AFFINITY_ENTRIES);
    for (const key of toDelete) reactionAffinityTracker.delete(key);
  }
  // Reaction affinity cooldowns — time-based + FIFO
  for (const [key, ts] of reactionAffinityCooldowns) {
    if (now - ts > REACTION_AFFINITY_COOLDOWN_MS) reactionAffinityCooldowns.delete(key);
  }
  while (reactionAffinityCooldowns.size > MAX_REACTION_COOLDOWNS) {
    const oldest = reactionAffinityCooldowns.keys().next().value;
    if (oldest !== undefined) reactionAffinityCooldowns.delete(oldest); else break;
  }
}, REACTION_AFFINITY_CLEANUP_MS);

export function setupReactionHandler(client: Client): void {
  client.on('messageReactionAdd', async (reaction, user) => {
    await withUserDataContext(reaction.message.guild?.id ?? '', user.id, async () => {
      try {
        // Fetch partial reactions/messages
        if (reaction.partial) {
          try { await reaction.fetch(); } catch (err) { console.error('Reaction fetch failed:', (err as Error).message); return; }
        }
        if (reaction.message.partial) {
          try { await reaction.message.fetch(); } catch (err) { console.error('Reaction message fetch failed:', (err as Error).message); return; }
        }

        // Ignore bot reactions
        if (user.bot) return;

        // Track pair interactions — user reacting to another user's message
        const reactionGuildId = reaction.message.guild?.id ?? '';
        const messageAuthor = reaction.message.author;
        if (messageAuthor && !messageAuthor.bot && messageAuthor.id !== user.id) {
          recordPairInteraction(reactionGuildId, user.id, messageAuthor.id);
        }

        // Reaction-based wild quote detection — if a non-bot message gets 3+ reactions, check if it's wild
        if (messageAuthor && !messageAuthor.bot && messageAuthor.id !== client.user?.id) {
          const totalReactions = reaction.message.reactions.cache.reduce((sum, r) => sum + (r.count ?? 0), 0);
          if (totalReactions >= 3 && reaction.message.content && reaction.message.content.length >= 15) {
            const content = reaction.message.content;
            const authorName = messageAuthor.displayName || messageAuthor.username;
            // Lightweight AI check — is this wild enough for hall of fame?
            void withUserDataContext(reactionGuildId, messageAuthor.id, async () => {
            await queryAI(`Is this message wild, unhinged, or hilarious enough for a "hall of fame" of crazy things said in a Discord server? Message: "${content}". Reply with ONLY "yes" or "no".`, { temperature: 0.3 })
              .then(async (answer) => {
                if (answer?.toLowerCase().includes('yes')) {
                  await userMemory.addWildQuote(reactionGuildId, messageAuthor.id, authorName, content);
                }
              })
              .catch((err) => console.error('Wild quote AI check failed:', (err as Error).message));
            });
          }
          return;
        }

        // Only log to DB for reactions on Sass's messages
        if (messageAuthor?.id !== client.user?.id) return;

        const emojiName = reaction.emoji.name || reaction.emoji.toString();
        const emojiId = reaction.emoji.id ?? undefined;
        const isNegative = NEGATIVE_EMOJI.has(emojiName);
        const isPositive = !isNegative;

        // Track ALL reactions — custom emoji are positive by default
        logReaction({
          serverId: reaction.message.guild?.id,
          channelId: reaction.message.channel.id,
          messageId: reaction.message.id,
          sassResponse: reaction.message.content || '',
          reactorId: user.id,
          reactorName: ('displayName' in user ? user.displayName : null) || user.username || 'unknown',
          emoji: emojiName,
          emojiId,
          isPositive,
        }).catch((err) => console.error('Reaction log failed:', (err as Error).message));

        // Update affinity — per-message dedup + 10-min time cooldown (same as mentions)
        // Negative reactions always apply (no cooldown for penalties)
        const msgAffinityKey = `${reactionGuildId}:${reaction.message.id}`;
        if (!reactionAffinityTracker.has(msgAffinityKey)) {
          reactionAffinityTracker.set(msgAffinityKey, new Set());
        }
        const reactedUsers = reactionAffinityTracker.get(msgAffinityKey);
        const alreadyReactedThisMsg = reactedUsers?.has(user.id) ?? false;
        if (reactedUsers && !alreadyReactedThisMsg) {
          reactedUsers.add(user.id);
        }

        if (!alreadyReactedThisMsg) {
          if (!isPositive) {
            // Negative reactions always apply — no cooldown for penalties
            updateAffinity(reactionGuildId, user.id, -2)
              .catch((err) => console.error('Affinity update failed:', (err as Error).message));
          } else {
            // Positive reactions: 10-min cooldown per user (same limit as mentions)
            const cooldownKey = `${reactionGuildId}:${user.id}`;
            const lastReactionGain = reactionAffinityCooldowns.get(cooldownKey) ?? 0;
            if (Date.now() - lastReactionGain > REACTION_AFFINITY_COOLDOWN_MS) {
              reactionAffinityCooldowns.set(cooldownKey, Date.now());
              updateAffinity(reactionGuildId, user.id, 0.5)
                .catch((err) => console.error('Affinity update failed:', (err as Error).message));
            }
          }
        }
      } catch (err) {
        console.error('Reaction handler error:', (err as Error).message);
      }
    });
  });
}
