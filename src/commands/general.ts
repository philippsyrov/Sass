import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { queryAI } from '../ai/index.js';
import { buildHelpPages } from '../helpPages.js';
import { getActivityDescription } from '../shared/commandUtils.js';
import { FORTUNES, QUOTE_AUTHORS } from '../commandDefinitions.js';
import { messageBuffer } from '../messageBuffer.js';

export async function handleGeneralCommand(
  interaction: ChatInputCommandInteraction,
  commandName: string,
): Promise<void> {
  switch (commandName) {
    case 'help': {
      const botAvatar = interaction.client.user?.displayAvatarURL({ size: 256 }) ?? '';
      const helpPages = buildHelpPages(botAvatar);
      const helpButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('help_prev').setLabel('\u25C0').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('help_next').setLabel('\u25B6').setStyle(ButtonStyle.Secondary),
      );
      let helpPage = 0;
      const firstPage = helpPages[0];
      if (!firstPage) break;
      const helpReply = await interaction.reply({ embeds: [firstPage], components: [helpButtons], fetchReply: true }).catch((err) => { console.error('Help reply failed:', (err as Error).message); return null; });
      if (!helpReply) break;
      const helpCollector = helpReply.createMessageComponentCollector({ componentType: ComponentType.Button, time: 120_000 });
      helpCollector.on('collect', async (btn) => {
        helpPage = btn.customId === 'help_prev'
          ? (helpPage > 0 ? helpPage - 1 : helpPages.length - 1)
          : (helpPage < helpPages.length - 1 ? helpPage + 1 : 0);
        const currentPage = helpPages[helpPage];
        if (currentPage) await btn.update({ embeds: [currentPage], components: [helpButtons] }).catch((err) => console.error('Help page update failed:', (err as Error).message));
      });
      helpCollector.on('end', () => {
        const disabled = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId('help_prev').setLabel('\u25C0').setStyle(ButtonStyle.Secondary).setDisabled(true),
          new ButtonBuilder().setCustomId('help_next').setLabel('\u25B6').setStyle(ButtonStyle.Secondary).setDisabled(true),
        );
        helpReply.edit({ components: [disabled] }).catch((err) => console.error('Failed to disable help buttons:', err.message));
      });
      break;
    }

    case 'fortune': {
      const fortune = FORTUNES[Math.floor(Math.random() * FORTUNES.length)] ?? 'your future is... uncertain.';
      await interaction.reply(`\u{1F960} ${fortune}`).catch((err) => console.error('Fortune reply failed:', (err as Error).message));
      break;
    }

    case 'quote': {
      await interaction.deferReply();
      try {
        const author = QUOTE_AUTHORS[Math.floor(Math.random() * QUOTE_AUTHORS.length)] ?? 'Sun Tzu';
        const response = await queryAI(
          `Generate a fake inspirational quote attributed to ${author}. Make it sound profound at first but actually be either absurd, passive-aggressive, or lowkey insulting. One sentence only. Just the quote, no attribution.`,
          { systemPrompt: 'You generate fake quotes. One sentence. No quotation marks. Lowercase.' }
        );
        await interaction.editReply(`> *${(response ?? '').replace(/"/g, '')}*\n> \u2014 ${author} (probably)`);
      } catch (err) {
        console.error('Quote command failed:', (err as Error).message);
        await interaction.editReply('> *the only real failure is being too boring to quote*\n> \u2014 me, just now');
      }
      break;
    }

    case 'hottake': {
      await interaction.deferReply();
      const topic = interaction.options.getString('topic');
      try {
        const prompt = topic
          ? `Spicy hot take about "${topic}". ONE sentence, max 15 words. Be bold and unhinged.`
          : 'Random spicy hot take about anything. ONE sentence, max 15 words. Be bold and unhinged.';
        const response = await queryAI(prompt, {
          systemPrompt: 'You generate hot takes. ONE sentence max. Under 15 words. Controversial but not bigoted. Lowercase. No essays.',
        });
        await interaction.editReply(`\u{1F525} **hot take:**\n${response}`);
        messageBuffer.injectBotMessage(interaction.channelId, `[Sass /hottake result: ${response}]`);
      } catch (err) {
        console.error('Hottake command failed:', (err as Error).message);
        await interaction.editReply("\u{1F525} **hot take:**\nthis command failing is still more interesting than your personality");
      }
      break;
    }

    case 'status': {
      await interaction.deferReply();
      const targetUser = interaction.options.getUser('user', true);
      try {
        const member = await interaction.guild?.members.fetch(targetUser.id);
        const presence = member?.presence ?? null;
        const onlineStatus = presence?.status ?? 'offline';

        if (!presence || onlineStatus === 'offline') {
          await interaction.editReply(`${targetUser.displayName} is offline. probably for the best.`);
          break;
        }

        const activityInfo = getActivityDescription(presence);
        if (!activityInfo) {
          await interaction.editReply(`${targetUser.displayName} doesn't have a status. the void speaks louder.`);
          break;
        }

        const response = await queryAI(
          `Roast "${targetUser.displayName}" for this Discord activity: ${activityInfo}. ONE sentence, max 15 words. Be specific about the game/app. No metaphors, no essays.`,
          { systemPrompt: 'You roast Discord statuses. ONE short sentence. Lowercase. Max 15 words. Talk like a 20-year-old texting, not writing a blog post. No generic comparisons or fancy vocabulary.' }
        );
        await interaction.editReply(`**${targetUser.displayName}**: *${activityInfo}*\n\n${response}`);
      } catch (err) {
        console.error('Status command failed:', (err as Error).message);
        await interaction.editReply("couldn't read their status. they're probably hiding from me. smart.");
      }
      break;
    }

    default:
      break;
  }
}
