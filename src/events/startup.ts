import type { Client, Guild, TextChannel } from 'discord.js';
import { initDatabase } from '../database/index.js';
import { startDistillationScheduler } from '../memory/distillScheduler.js';
import { pickRandom } from '../shared/commandUtils.js';
import { AUTO_SASS_CHANCE } from '../handlers/autoSass.js';
import { loadSassEmoji } from '../emoji.js';
import { inviteInstructions } from '../shared/discordInvite.js';

// Send a message to the first available text channel in a guild
async function sendToFirstChannel(guild: Guild, text: string): Promise<void> {
  const me = guild.members.me;
  if (!me) return;
  const channel = guild.channels.cache.find(
    (ch) => ch.isTextBased() && !ch.isVoiceBased() && ch.permissionsFor(me)?.has(['ViewChannel', 'SendMessages'])
  ) as TextChannel | undefined;
  if (channel) await channel.send(text).catch((err) => console.error('Guild join send failed:', (err as Error).message));
}

export function setupStartup(client: Client): void {
  client.once('clientReady', async () => {
    if (!client.user) return;
    console.log(`Sass is online as ${client.user.tag}`);
    console.log(`AI Provider: ${process.env.AI_PROVIDER || 'ollama'}`);
    console.log(`Auto-sass chance: ${Number((AUTO_SASS_CHANCE * 100).toFixed(2))}%`);
    console.log(`Creator mode: ${process.env.CREATOR_ID ? 'configured' : 'not set'}`);

    // Look up the app's custom emoji by name (missing ones fall back to Unicode)
    await loadSassEmoji(client);

    // Initialize database (fails silently if no DATABASE_URL)
    await initDatabase();

    console.log(inviteInstructions(client.user.id));

    startDistillationScheduler();
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

export { setupShutdown } from './shutdown.js';
