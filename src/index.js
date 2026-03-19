import { Client, GatewayIntentBits, Partials } from 'discord.js';
import dotenv from 'dotenv';
import { handleMention } from './handlers/mention.js';
import { handleAutoSass } from './handlers/autoSass.js';
import { messageBuffer } from './messageBuffer.js';
import { userMemory } from './userMemory.js';

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

client.once('ready', () => {
  console.log(`Sass is online as ${client.user.tag}`);
  console.log(`AI Provider: ${process.env.AI_PROVIDER || 'ollama'}`);
  console.log(`Auto-sass chance: ${(process.env.AUTO_SASS_CHANCE || 0.4) * 100}%`);
  console.log(`Creator ID: ${process.env.CREATOR_ID || 'not set'}`);
});

client.on('messageCreate', async (message) => {
  // Track ALL messages in buffer (including Sass's own) for conversation context
  messageBuffer.add(message);

  // Don't process bot messages further
  if (message.author.bot) return;

  // Track user
  const displayName = message.author.displayName || message.author.username;
  userMemory.seen(message.author.id, displayName);

  // 1. Direct mention or reply to Sass — always respond
  const isReplyToSass = message.reference && message.mentions.has(client.user);
  const isMentionInText = message.content.includes(`<@${client.user.id}>`)
    || message.content.includes(`<@!${client.user.id}>`);
  if (isMentionInText || isReplyToSass) {
    await handleMention(message, client);
    return;
  }

  // 2. Auto-sass — occasionally pop in uninvited
  await handleAutoSass(message, client);
});

client.login(process.env.DISCORD_TOKEN);
