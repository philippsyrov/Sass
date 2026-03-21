import { Client, GatewayIntentBits, Partials, type Guild, type TextChannel } from 'discord.js';
import dotenv from 'dotenv';
import { handleMention } from './handlers/mention.js';
import { handleAutoSass } from './handlers/autoSass.js';
import { handleCommand, handleBattleMessage } from './commands.js';
import { messageBuffer } from './messageBuffer.js';
import { userMemory } from './userMemory.js';
import { initDatabase, closeDatabase } from './database.js';

dotenv.config();

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
  if (channel) await channel.send(text);
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

  // Skip if we already processed this message (Discord can send duplicates)
  if (isDuplicate(message.id)) return;

  // Track user
  const displayName = message.author.displayName || message.author.username;
  userMemory.seen(message.author.id, displayName);

  // 0. Check if this is part of a roast battle
  const isBattle = await handleBattleMessage(message);
  if (isBattle) return;

  // 1. Direct mention or reply to Sass — always respond
  if (!client.user) return;
  // Explicit @Sass in message text — always respond
  const isMentionInText = message.content.includes(`<@${client.user.id}>`)
    || message.content.includes(`<@!${client.user.id}>`);
  // Reply to a Sass message — only respond 20% of the time, and only if substantive
  const isReplyToSass = !isMentionInText
    && message.reference != null
    && message.mentions.has(client.user)
    && message.content.length > 10;
  const shouldRespondToReply = isReplyToSass && Math.random() < 0.20;
  if (isMentionInText || shouldRespondToReply) {
    if (isUserOnCooldown(message.author.id)) return;
    if (isSpamming(message.author.id, message.content)) return;
    await handleMention(message, client);
    return;
  }

  // 2. Name mention — someone said "sass" without @mentioning
  //    Treat like a mention so she responds directly (creator mode if it's the creator)
  const lowerContent = message.content.toLowerCase();
  if (/\bsass\b/i.test(lowerContent) && !lowerContent.includes('sassy')) {
    if (isUserOnCooldown(message.author.id)) return;
    await handleMention(message, client);
    return;
  }

  // 3. Auto-sass — occasionally pop in uninvited
  await handleAutoSass(message, client);
});

// Graceful shutdown — clean up connections
async function shutdown(signal: string): Promise<void> {
  console.log(`\n${signal} received — shutting down gracefully...`);
  await client.destroy();
  await closeDatabase();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

void client.login(process.env.DISCORD_TOKEN);
