import { type ChatInputCommandInteraction } from 'discord.js';
import { logCommand } from '../database/index.js';
import { handleGeneralCommand } from './general.js';
import { handleSocialCommand } from './social.js';
import { handleEntertainmentCommand } from './entertainment.js';
import {
  checkSlashRateLimit,
  SLASH_RATE_LIMIT_RESPONSES,
  SOFT_BAN_RESPONSES,
  SOFT_BAN_ATTEMPT_RESPONSES,
} from './rateLimiting.js';
import { pickRandom } from '../shared/commandUtils.js';

// Re-export from extracted modules so existing imports don't break
export { commands } from '../commandDefinitions.js';
export { FORTUNES, QUOTE_AUTHORS } from '../commandDefinitions.js';
export { activeBattles, handleBattleMessage } from '../roastBattle.js';
export { getActivityDescription, hasUsedToday, markUsedToday, pickRandom } from '../shared/commandUtils.js';

export async function handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const { commandName } = interaction;
  const guildId = interaction.guild?.id ?? '';

  if (!interaction.guild) {
    await interaction.reply({ content: "i only work in servers, not DMs \u{1F485}", ephemeral: true }).catch((err) => console.error('DM reply failed:', (err as Error).message));
    return;
  }

  // Global slash command rate limit (skip for ping/help)
  if (commandName !== 'ping' && commandName !== 'help') {
    const limitResult = checkSlashRateLimit(interaction.user.id);

    if (limitResult === 'already-banned') {
      const msg = pickRandom(SOFT_BAN_ATTEMPT_RESPONSES);
      await interaction.reply({ content: msg, ephemeral: true }).catch((err) => console.error('Soft ban attempt reply failed:', (err as Error).message));
      return;
    }

    if (limitResult === 'soft-banned') {
      const msg = pickRandom(SOFT_BAN_RESPONSES);
      await interaction.reply({ content: msg, ephemeral: true }).catch((err) => console.error('Soft ban reply failed:', (err as Error).message));
      // Always publicly shame on soft ban
      const channel = interaction.channel;
      if (channel && 'send' in channel) {
        const delay = 1000 + Math.random() * 2000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        await channel.send(`<@${interaction.user.id}> just got put in timeout for 10 minutes. let that be a lesson.`).catch((err) => console.error('Soft ban announcement failed:', (err as Error).message));
      }
      return;
    }

    if (limitResult === 'limited') {
      const msg = pickRandom(SLASH_RATE_LIMIT_RESPONSES);
      await interaction.reply({ content: msg, ephemeral: true }).catch((err) => console.error('Rate limit reply failed:', (err as Error).message));

      // 30% chance to publicly call them out
      if (Math.random() < 0.30) {
        const channel = interaction.channel;
        if (channel && 'send' in channel) {
          const publicRoasts = [
            `<@${interaction.user.id}> imagine being rate limited by a bot`,
            `<@${interaction.user.id}> is really testing my patience today`,
            `<@${interaction.user.id}> got cut off and honestly it's deserved`,
            `<@${interaction.user.id}> just got told to go outside by a bot. let that sink in.`,
            `<@${interaction.user.id}> was spamming slash commands like their life depended on it`,
            `<@${interaction.user.id}> the commands are not going anywhere. neither is your life apparently.`,
            `<@${interaction.user.id}> is using commands like they're running out of stock`,
          ];
          const publicMsg = pickRandom(publicRoasts);
          const delay = 1000 + Math.random() * 2000;
          await new Promise((resolve) => setTimeout(resolve, delay));
          await channel.send(publicMsg).catch((err) => console.error('Public rate limit roast failed:', (err as Error).message));
        }
      }
      return;
    }
  }

  // Log every slash command usage
  logCommand({
    serverId: interaction.guild?.id,
    userId: interaction.user.id,
    commandName,
    commandType: 'slash',
  }).catch((err) => console.error('Failed to log command:', err.message));

  switch (commandName) {
    case 'help':
    case 'fortune':
    case 'quote':
    case 'hottake':
    case 'status':
      return handleGeneralCommand(interaction, commandName);

    case 'ship':
    case 'favorite':
    case 'compliment':
    case 'profile':
    case 'leaderboard':
      return handleSocialCommand(interaction, commandName, guildId);

    case 'horoscope':
    case 'roastbattle':
    case 'beef':
    case 'halloffame':
    case 'bestof':
    case 'forgetme':
    case 'conspiracy':
      return handleEntertainmentCommand(interaction, commandName, guildId);

    default:
      await interaction.reply("i don't know that command. impressive, you broke something that simple.").catch((err) => console.error('Unknown command reply failed:', (err as Error).message));
  }
}
