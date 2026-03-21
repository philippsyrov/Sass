import { REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
import { commands } from './commands.js';

dotenv.config();

if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) {
  console.error('Missing DISCORD_TOKEN or CLIENT_ID in environment variables');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

const commandData = commands.map((cmd) => cmd.toJSON());

console.log(`Registering ${commandData.length} slash commands...`);

try {
  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commandData },
  );
  console.log('Slash commands registered globally!');
} catch (error) {
  console.error('Failed to register commands:', error);
}
