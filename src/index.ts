import './env.js';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { setupMessageHandler } from './events/messageCreate.js';
import { setupReactionHandler } from './events/reactionAdd.js';
import { setupInteractionHandler } from './events/interactionCreate.js';
import { setupStartup, setupShutdown } from './events/startup.js';

const token = process.env.DISCORD_TOKEN?.trim();
if (!token || /^your_.*_here$/.test(token)) {
  console.error('Missing DISCORD_TOKEN in .env. Copy .env.example to .env and paste your bot token (see README, Quick start).');
  process.exit(1);
}

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

setupStartup(client);
setupMessageHandler(client);
setupReactionHandler(client);
setupInteractionHandler(client);
setupShutdown(client);

client.login(token).catch((err: Error & { code?: string }) => {
  if (err.code === 'TokenInvalid') {
    console.error('Discord rejected DISCORD_TOKEN. Copy a fresh token from Developer Portal → your app → Bot → Reset Token.');
  } else if (/disallowed intents/i.test(err.message)) {
    console.error('Discord refused the gateway intents. In Developer Portal → your app → Bot, turn on Presence Intent and Message Content Intent.');
  } else {
    console.error('Login failed:', err.message);
  }
  process.exit(1);
});
