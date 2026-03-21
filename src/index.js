import { Client, GatewayIntentBits, Partials } from 'discord.js';
import dotenv from 'dotenv';
import { handleMention } from './handlers/mention.js';
import { handleAutoSass } from './handlers/autoSass.js';
import { handleCommand, handleBattleMessage } from './commands.js';
import { messageBuffer } from './messageBuffer.js';
import { userMemory } from './userMemory.js';
import { initDatabase } from './database.js';

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
  console.log(`Sass is online as ${client.user.tag}`);
  console.log(`AI Provider: ${process.env.AI_PROVIDER || 'ollama'}`);
  console.log(`Auto-sass chance: ${(process.env.AUTO_SASS_CHANCE || 0.4) * 100}%`);
  console.log(`Creator ID: ${process.env.CREATOR_ID || 'not set'}`);

  // Initialize database (fails silently if no DATABASE_URL)
  await initDatabase();
});

// Send a message to the first available text channel in a guild
async function sendToFirstChannel(guild, text) {
  const channel = guild.channels.cache.find(
    (ch) => ch.isTextBased() && !ch.isVoiceBased() && ch.permissionsFor(guild.members.me)?.has('SendMessages')
  );
  if (channel) await channel.send(text);
}

// Guild join — announce arrival
client.on('guildCreate', (guild) => {
  const intros = [
    "i'm here. you're welcome.",
    "alright who invited me. doesn't matter, i'm staying.",
    "new server new victims",
    "hey. i'm sass. i'm going to be a problem.",
    "somebody called for chaos? no? too bad.",
  ];
  sendToFirstChannel(guild, intros[Math.floor(Math.random() * intros.length)]);
});

// Slash commands
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    await handleCommand(interaction);
  } catch (err) {
    console.error('Command failed:', err.message);
    const reply = { content: "something broke. probably your fault.", ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply).catch(() => {});
    } else {
      await interaction.reply(reply).catch(() => {});
    }
  }
});

// Dedup guard — prevent processing the same message twice
// Using a Map with timestamps for automatic cleanup
const processedMessages = new Map();

function isDuplicate(messageId) {
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
  const isReplyToSass = message.reference && message.mentions.has(client.user);
  const isMentionInText = message.content.includes(`<@${client.user.id}>`)
    || message.content.includes(`<@!${client.user.id}>`);
  if (isMentionInText || isReplyToSass) {
    await handleMention(message, client);
    return;
  }

  // 2. Name mention — someone said "sass" without @mentioning
  //    Treat like a mention so she responds directly (creator mode if it's the creator)
  const lowerContent = message.content.toLowerCase();
  if (/\bsass\b/i.test(lowerContent) && !lowerContent.includes('sassy')) {
    await handleMention(message, client);
    return;
  }

  // 3. Auto-sass — occasionally pop in uninvited
  await handleAutoSass(message, client);
});

client.login(process.env.DISCORD_TOKEN);
