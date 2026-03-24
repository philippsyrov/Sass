import { Client, GatewayIntentBits, Partials, type Guild, type TextChannel } from 'discord.js';
import dotenv from 'dotenv';
import { handleMention } from './handlers/mention.js';
import { handleAutoSass } from './handlers/autoSass.js';
import { handleCommand, handleBattleMessage } from './commands.js';
import { messageBuffer } from './messageBuffer.js';
import * as userMemory from './userMemory.js';
import { initDatabase, closeDatabase, logReaction, updateAffinity } from './database.js';
import { queryAI } from './ai.js';
import { isOnSlashCooldown, setSlashCooldown, isOnShipCooldown, setShipCooldown } from './cooldown.js';
import { recordPairInteraction } from './shipScore.js';

dotenv.config();

// Track which users already got affinity for reacting to a specific message (prevent spam-reacting)
const reactionAffinityTracker = new Map<string, Set<string>>();
const REACTION_AFFINITY_CLEANUP_MS = 30 * 60 * 1000; // 30 min
const MAX_REACTION_AFFINITY_ENTRIES = 500;

// Time-based cooldown for reaction affinity — same 10-min cooldown as mentions
// Prevents bulk-reacting to old messages to farm affinity
const reactionAffinityCooldowns = new Map<string, number>();
const REACTION_AFFINITY_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes
const MAX_REACTION_COOLDOWNS = 500;

// Periodic cleanup for all index.ts Maps (every 30 min)
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
}, REACTION_AFFINITY_CLEANUP_MS);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildPresences,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

client.once('ready', async () => {
  if (!client.user) return;
  console.log(`Sass is online as ${client.user.tag}`);
  console.log(`AI Provider: ${process.env.AI_PROVIDER || 'ollama'}`);
  console.log(`Auto-sass chance: ${(parseFloat(process.env.AUTO_SASS_CHANCE ?? '0.4') || 0.4) * 100}%`);
  console.log(`Creator ID: ${process.env.CREATOR_ID || 'not set'}`);

  // Initialize database (fails silently if no DATABASE_URL)
  await initDatabase();
});

// Send a message to the first available text channel in a guild
async function sendToFirstChannel(guild: Guild, text: string): Promise<void> {
  const me = guild.members.me;
  if (!me) return;
  const channel = guild.channels.cache.find(
    (ch) => ch.isTextBased() && !ch.isVoiceBased() && ch.permissionsFor(me)?.has('SendMessages')
  ) as TextChannel | undefined;
  if (channel) await channel.send(text).catch((err) => console.error('Guild join send failed:', (err as Error).message));
}

// Guild join — announce arrival
client.on('guildCreate', (guild: Guild) => {
  const intros = [
    "i'm here. you're welcome.",
    "alright who invited me. doesn't matter, i'm staying.",
    "new server new victims",
    "hey. i'm sass. i'm going to be a problem.",
    "somebody called for chaos? no? too bad.",
  ];
  void sendToFirstChannel(guild, intros[Math.floor(Math.random() * intros.length)] as string);
});

// Slash commands
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // Per-user slash command cooldown — 5s between commands
  const userId = interaction.user.id;
  if (userId !== process.env.CREATOR_ID && isOnSlashCooldown(userId)) {
    const cooldownResponses = [
      "slow down, i can only judge you so fast.",
      "bro chill, i'm still recovering from your last one.",
      "you're speedrunning my patience rn.",
      "one at a time, i'm not a vending machine.",
      "give me a sec, even i need to breathe.",
    ];
    await interaction.reply({
      content: cooldownResponses[Math.floor(Math.random() * cooldownResponses.length)] as string,
      ephemeral: true,
    }).catch((err) => console.error('Cooldown reply failed:', (err as Error).message));
    return;
  }
  setSlashCooldown(userId);

  // Extra cooldown for /ship — 15s to prevent spam (AI call each time)
  const commandName = interaction.commandName;
  if (commandName === 'ship' && userId !== process.env.CREATOR_ID && isOnShipCooldown(userId)) {
    await interaction.reply({
      content: "you just shipped someone. give the matchmaking gods a moment.",
      ephemeral: true,
    }).catch((err) => console.error('Cooldown reply failed:', (err as Error).message));
    return;
  }
  if (commandName === 'ship') setShipCooldown(userId);

  try {
    await handleCommand(interaction);
  } catch (err) {
    console.error('Command failed:', (err as Error).message);
    const reply = { content: "something broke. probably your fault.", ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply).catch((e) => console.error('Follow-up failed:', (e as Error).message));
    } else {
      await interaction.reply(reply).catch((e) => console.error('Reply failed:', (e as Error).message));
    }
  }
});

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

client.on('messageCreate', async (message) => {
  // Track ALL messages in buffer (including Sass's own) for conversation context
  messageBuffer.add(message);

  // Don't process bot messages further
  if (message.author.bot) return;

  const guildId = message.guild?.id ?? '';

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

  // 1. Direct mention or reply to Sass — always respond
  if (!client.user) return;
  // Explicit @Sass in message text — always respond
  const isMentionInText = message.content.includes(`<@${client.user.id}>`)
    || message.content.includes(`<@!${client.user.id}>`);
  if (isMentionInText) {
    if (isUserOnCooldown(message.author.id)) return;
    if (isSpamming(message.author.id, message.content)) return;
    await handleMention(message, client);
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
            await handleAutoSass(message, client, { heardName: true });
            return;
          }
        }
      }
    } catch (err) { console.error('Fetch replied message failed:', (err as Error).message); }
  }

  // 2. Someone said "sass" without @ — she heard her name
  //    Don't force a response. Skip the dice roll and cooldown so auto-sass
  //    always evaluates the context, but the AI still decides via SKIP if
  //    it's not worth responding to. She reads the room, not a coin flip.
  const lowerContent = message.content.toLowerCase().trim();
  if (/\bsass\b/i.test(lowerContent) && !lowerContent.includes('sassy')) {
    // If the message is basically just her name (1-2 words), don't send to AI — just acknowledge
    const nameWordCount = lowerContent.split(/\s+/).length;
    if (nameWordCount <= 2) {
      const acks = ['what', 'you rang?', 'hm?', '?', 'what do you want'];
      const ack = acks[Math.floor(Math.random() * acks.length)] as string;
      await message.reply(ack).catch((err) => console.error('Reply failed:', (err as Error).message));
      return;
    }
    await handleAutoSass(message, client, { heardName: true });
    return;
  }

  // 3. Auto-sass — occasionally pop in uninvited
  await handleAutoSass(message, client);
});

// Reaction tracking — log ALL reactions on Sass's messages as quality signals
const NEGATIVE_EMOJI = new Set(['👎', '😐', '🤡', '❌']);

client.on('messageReactionAdd', async (reaction, user) => {
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
        queryAI(`Is this message wild, unhinged, or hilarious enough for a "hall of fame" of crazy things said in a Discord server? Message: "${content}". Reply with ONLY "yes" or "no".`, { temperature: 0.3 })
          .then(async (answer) => {
            if (answer?.toLowerCase().includes('yes')) {
              await userMemory.addWildQuote(reactionGuildId, messageAuthor.id, authorName, content);
            }
          })
          .catch((err) => console.error('Wild quote AI check failed:', (err as Error).message));
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

// Graceful shutdown — clean up connections
async function shutdown(signal: string): Promise<void> {
  console.log(`\n${signal} received — shutting down gracefully...`);
  await userMemory.shutdownUserMemory();
  await client.destroy();
  await closeDatabase();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

void client.login(process.env.DISCORD_TOKEN);
