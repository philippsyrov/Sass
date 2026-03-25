import { Client, GatewayIntentBits, Partials } from 'discord.js';
import dotenv from 'dotenv';
import { setupMessageHandler } from './events/messageCreate.js';
import { setupReactionHandler } from './events/reactionAdd.js';
import { setupInteractionHandler } from './events/interactionCreate.js';
import { setupStartup, setupShutdown } from './events/startup.js';

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

setupStartup(client);
setupMessageHandler(client);
setupReactionHandler(client);
setupInteractionHandler(client);
setupShutdown(client);

void client.login(process.env.DISCORD_TOKEN);
