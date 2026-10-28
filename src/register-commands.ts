import { REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
import { commands } from './commands/index.js';

dotenv.config({ quiet: true });

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
  // Imported command modules start cleanup timers that would keep this one-shot script alive.
  process.exit(0);
} catch (error) {
  const err = error as Error & { status?: number };
  console.error(`Failed to register commands${err.status ? ` (HTTP ${err.status})` : ''}: ${err.message}`);
  if (err.status === 401) console.error('Check DISCORD_TOKEN and CLIENT_ID in .env.');
  process.exit(1);
}
