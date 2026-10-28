import type { Client, Guild, TextChannel } from 'discord.js';
import { initDatabase, closeDatabase } from '../database/index.js';
import * as userMemory from '../userMemory.js';
import { distillAllGuilds } from '../vectorMemory.js';
import { pickRandom } from '../shared/commandUtils.js';
import { AUTO_SASS_CHANCE } from '../handlers/autoSass.js';

// Send a message to the first available text channel in a guild
async function sendToFirstChannel(guild: Guild, text: string): Promise<void> {
  const me = guild.members.me;
  if (!me) return;
  const channel = guild.channels.cache.find(
    (ch) => ch.isTextBased() && !ch.isVoiceBased() && ch.permissionsFor(me)?.has('SendMessages')
  ) as TextChannel | undefined;
  if (channel) await channel.send(text).catch((err) => console.error('Guild join send failed:', (err as Error).message));
}

export function setupStartup(client: Client): void {
  client.once('ready', async () => {
    if (!client.user) return;
    console.log(`Sass is online as ${client.user.tag}`);
    console.log(`AI Provider: ${process.env.AI_PROVIDER || 'ollama'}`);
    console.log(`Auto-sass chance: ${AUTO_SASS_CHANCE * 100}%`);
    console.log(`Creator mode: ${process.env.CREATOR_ID ? 'configured' : 'not set'}`);

    // Initialize database (fails silently if no DATABASE_URL)
    await initDatabase();

    // Memory distillation: 5-min startup delay, then every 6 hours
    const DISTILL_DELAY_MS = 5 * 60 * 1000;
    const DISTILL_INTERVAL_MS = 6 * 60 * 60 * 1000;

    setTimeout(() => {
      distillAllGuilds().catch((err) => console.error('Startup distillation failed:', (err as Error).message));
      setInterval(() => {
        distillAllGuilds().catch((err) => console.error('Periodic distillation failed:', (err as Error).message));
      }, DISTILL_INTERVAL_MS);
    }, DISTILL_DELAY_MS);
  });

  // Guild join — announce arrival
  client.on('guildCreate', (guild: Guild) => {
    const intros = [
      "i'm here. you're welcome.",
      "alright who invited me. doesn't matter, i'm staying.",
      "new server new victims",
      "hey. i'm sass. i'm going to be a problem.",
      "somebody called for chaos? no? too bad.",
    ];
    void sendToFirstChannel(guild, pickRandom(intros));
  });
}

export function setupShutdown(client: Client): void {
  async function shutdown(signal: string): Promise<void> {
    console.log(`\n${signal} received — shutting down gracefully...`);
    await userMemory.shutdownUserMemory();
    await client.destroy();
    await closeDatabase();
    process.exit(0);
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}
