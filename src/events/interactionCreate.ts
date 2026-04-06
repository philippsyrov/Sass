import type { Client } from 'discord.js';
import { handleCommand } from '../commands/index.js';
import { isOnSlashCooldown, setSlashCooldown, isOnShipCooldown, setShipCooldown } from '../cooldown.js';
import { pickRandom } from '../shared/commandUtils.js';

export function setupInteractionHandler(client: Client): void {
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
        content: pickRandom(cooldownResponses),
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
}
