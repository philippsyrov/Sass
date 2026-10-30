import { clearUserPairCache } from '../shipScore.js';
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { queryAI } from '../ai/index.js';
import * as userMemory from '../userMemory.js';
import { getTopReactions, deleteUserData } from '../database/index.js';
import { clearUserRuntimeState } from '../cooldown.js';
import { hasUsedToday, markUsedToday } from '../shared/commandUtils.js';
import { activeBattles } from '../roastBattle.js';
import { messageBuffer } from '../messageBuffer.js';
import { searchMemories } from '../vectorMemory.js';

// --- Zodiac emoji helper ---
function getZodiacEmoji(sign: string): string {
  const emojis: Record<string, string> = {
    aries: '\u2648', taurus: '\u2649', gemini: '\u264A', cancer: '\u264B', leo: '\u264C', virgo: '\u264D',
    libra: '\u264E', scorpio: '\u264F', sagittarius: '\u2650', capricorn: '\u2651', aquarius: '\u2652', pisces: '\u2653',
  };
  return emojis[sign] ?? '\u2B50';
}

export async function handleEntertainmentCommand(
  interaction: ChatInputCommandInteraction,
  commandName: string,
  guildId: string,
): Promise<void> {
  switch (commandName) {
    case 'horoscope': {
      if (hasUsedToday(guildId, interaction.user.id, 'horoscope')) {
        await interaction.reply("you already got your daily reading. the stars don't refresh on demand.").catch((err) => console.error('Horoscope cooldown reply failed:', (err as Error).message));
        break;
      }
      await interaction.deferReply();
      const sign = interaction.options.getString('sign') ?? '';
      try {
        const response = await queryAI(
          `Give a sassy, backhanded daily horoscope for ${sign}. Start with something that sounds positive, then twist it. Include a "lucky" element that's actually an insult. 2-3 sentences. Format:\n[horoscope text]\n\n\u{1F340} lucky item: [something insulting]`,
          { systemPrompt: 'You write sassy horoscopes. Sound mystical at first, then roast. Lowercase. Include zodiac personality stereotypes as ammunition.' }
        );
        if (!response) throw new Error('Empty response');
        markUsedToday(guildId, interaction.user.id, 'horoscope');
        await interaction.editReply(`${getZodiacEmoji(sign)} **${sign}** \u2014 daily reading\n\n${response}`);
        messageBuffer.injectBotMessage(interaction.channelId, `[Sass /horoscope result for ${sign}: ${response?.slice(0, 80)}...]`);
      } catch (err) {
        console.error('Horoscope command failed:', (err as Error).message);
        await interaction.editReply(`${getZodiacEmoji(sign)} **${sign}**: the stars tried to read your future but fell asleep. that's the reading.`);
      }
      break;
    }

    case 'roastbattle': {
      const opponent = interaction.options.getUser('opponent', true);
      if (opponent.bot) {
        await interaction.reply("i'm not fighting another bot. i have standards. barely, but still.").catch((err) => console.error('Battle bot reply failed:', (err as Error).message));
        break;
      }
      if (opponent.id === interaction.user.id) {
        await interaction.reply("you wanna roast battle yourself? the self-awareness is refreshing but also sad.").catch((err) => console.error('Battle self reply failed:', (err as Error).message));
        break;
      }

      // Create a thread for the battle
      const channel = interaction.channel;
      if (!channel || !('threads' in channel)) {
        await interaction.reply("can't start a battle here. find a text channel.").catch((err) => console.error('Battle channel reply failed:', (err as Error).message));
        break;
      }
      const thread = await channel.threads.create({
        name: `\u2694\uFE0F ${interaction.user.displayName} vs ${opponent.displayName}`,
        autoArchiveDuration: 60,
        reason: 'Roast battle',
      });

      const battleId = thread.id;
      activeBattles.set(battleId, {
        challenger: interaction.user,
        opponent,
        threadId: thread.id,
        round: 0,
        maxRounds: 3,
        scores: { [interaction.user.id]: [], [opponent.id]: [] },
        phase: 'waiting',
        currentTurn: null,
        timeout: null,
        turnTimeout: null,
        startedAt: Date.now(),
      });

      const embed = new EmbedBuilder()
        .setColor(0xFF4D6D)
        .setTitle('\u2694\uFE0F ROAST BATTLE CHALLENGE')
        .setDescription(
          `**${interaction.user.displayName}** has challenged **${opponent.displayName}**!\n\n` +
          `Head to ${thread} to watch or participate.`
        );
      await interaction.reply({ embeds: [embed] }).catch((err) => console.error('Battle challenge reply failed:', (err as Error).message));

      const rulesEmbed = new EmbedBuilder()
        .setColor(0xFF4D6D)
        .setTitle(`\u2694\uFE0F ${interaction.user.displayName} vs ${opponent.displayName}`)
        .setDescription(
          `**welcome to the ring.**\n\n` +
          `\u{1F4CB} **Rules:**\n` +
          `\u2022 3 rounds, take turns roasting each other\n` +
          `\u2022 i judge each roast 1-10\n` +
          `\u2022 highest total score wins\n` +
          `\u2022 only the fighters' messages count \u2014 spectators can watch\n\n` +
          `${opponent}, type **"accept"** to begin. you have 60 seconds before i call you a coward.`
        )
        .setFooter({ text: 'may the sassiest win' });
      await thread.send({ embeds: [rulesEmbed] }).catch((err) => console.error('Battle rules send failed:', (err as Error).message));

      // Timeout after 60s
      const timeout = setTimeout(() => {
        const battle = activeBattles.get(battleId);
        if (battle && battle.phase === 'waiting') {
          activeBattles.delete(battleId);
          thread.send(`${opponent.displayName} didn't show up. certified coward. archiving this embarrassment.`).catch((err) => console.error('Failed to send timeout message:', err.message));
          setTimeout(() => thread.setArchived(true).catch((err) => console.error('Failed to archive thread:', err.message)), 5000);
        }
      }, 60000);
      const battle = activeBattles.get(battleId);
      if (battle) battle.timeout = timeout;
      break;
    }

    case 'beef': {
      const user1 = interaction.options.getUser('user1', true);
      const user2 = interaction.options.getUser('user2', true);
      await interaction.deferReply();
      const beef = await userMemory.getBeef(guildId, user1.id, user2.id);

      if (!beef || beef.incidents === 0) {
        await interaction.editReply(`${user1.displayName} and ${user2.displayName} have no beef on record. boring.`);
        break;
      }

      const embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle(`\u{1F969} BEEF REPORT: ${user1.displayName} vs ${user2.displayName}`)
        .addFields(
          { name: 'Incidents', value: `${beef.incidents} recorded disagreements`, inline: true },
          { name: 'Since', value: new Date(beef.firstBeef).toLocaleDateString(), inline: true },
          { name: '\u200b', value: '\u200b', inline: false },
          { name: 'Latest Beef', value: beef.lastTopic ?? 'classified', inline: false },
        )
        .setFooter({ text: 'sass intelligence agency \u2014 beef division' });
      await interaction.editReply({ embeds: [embed] });
      break;
    }

    case 'halloffame': {
      await interaction.deferReply();
      const quotes = await userMemory.getWildQuotes(guildId, 10);
      if (quotes.length === 0) {
        await interaction.editReply("nobody's said anything wild enough yet. disappointing but not surprising.");
        break;
      }
      const lines = quotes.map((q, i) => `**${i + 1}.** "${q.quote}" \u2014 *${q.name}*`);
      await interaction.editReply(`\u{1F3C6} **hall of fame \u2014 wildest things said here**\n\n${lines.join('\n')}`);
      break;
    }

    case 'bestof': {
      await interaction.deferReply();
      const topResponses = await getTopReactions(guildId, 10);
      if (topResponses.length === 0) {
        await interaction.editReply("nobody's reacted to anything yet. you lot are ungrateful.");
        break;
      }

      // Paginate — 5 per page
      const pageSize = 5;
      const totalPages = Math.ceil(topResponses.length / pageSize);
      let currentPage = 0;

      const buildPage = (page: number): string => {
        const start = page * pageSize;
        const items = topResponses.slice(start, start + pageSize);
        const lines = items.map((r, i) => {
          const rank = start + i + 1;
          const userMsg = r.userMessage ? `**${r.username}:** "${r.userMessage}"\n   ` : '';
          return `**${rank}.** ${userMsg}**Sass:** "${r.sassResponse}"`;
        });
        return `\u{1F485} **best of sass** \u2014 ranked by you lot, obviously\n\n${lines.join('\n\n')}${totalPages > 1 ? `\n\n*page ${page + 1}/${totalPages}*` : ''}`;
      };

      if (totalPages <= 1) {
        await interaction.editReply(buildPage(0));
      } else {
        const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId('bestof_prev').setLabel('\u25C0').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('bestof_next').setLabel('\u25B6').setStyle(ButtonStyle.Secondary),
        );
        const reply = await interaction.editReply({ content: buildPage(0), components: [buttons] });
        const collector = reply.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 120_000,
        });
        collector.on('collect', async (btn) => {
          if (btn.customId === 'bestof_prev') currentPage = (currentPage - 1 + totalPages) % totalPages;
          else if (btn.customId === 'bestof_next') currentPage = (currentPage + 1) % totalPages;
          await btn.update({ content: buildPage(currentPage), components: [buttons] }).catch((err) => console.error('Bestof page update failed:', (err as Error).message));
        });
        collector.on('end', async () => {
          try { await reply.edit({ components: [] }); } catch { /* message deleted */ }
        });
      }
      break;
    }

    case 'forgetme': {
      // Confirmation step using buttons
      const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('forgetme_confirm').setLabel('Yes, delete everything').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('forgetme_cancel').setLabel('Never mind').setStyle(ButtonStyle.Secondary),
      );
      const warning = await interaction.reply({
        content: '⚠️ **are you sure?** this will permanently delete:\n' +
          '- your affinity score (back to 50%)\n' +
          '- all remembered facts about you\n' +
          '- all vector memories\n' +
          '- all beef records\n' +
          '- all pair interactions\n' +
          '- all wild quotes\n' +
          '- your interaction & command logs in this server\n\n' +
          '**this cannot be undone.**',
        components: [confirmRow],
        ephemeral: true,
        fetchReply: true,
      }).catch((err) => { console.error('Forgetme reply failed:', (err as Error).message); return null; });
      if (!warning) break;

      const collector = warning.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 30_000,
      });

      collector.on('collect', async (btn) => {
        if (btn.customId === 'forgetme_cancel') {
          await btn.update({ content: 'smart choice. your data lives another day.', components: [] }).catch((err) => console.error('Forgetme cancel failed:', (err as Error).message));
          return;
        }
        if (btn.customId === 'forgetme_confirm') {
          userMemory.clearPendingSeen(guildId, interaction.user.id);
          clearUserPairCache(guildId, interaction.user.id);
          clearUserRuntimeState(guildId, interaction.user.id);
          const result = await deleteUserData(guildId, interaction.user.id);
          if (result.deleted) {
            await btn.update({
              content: `done. wiped everything. ${result.tables.length > 0 ? `cleared: ${result.tables.join(', ')}` : 'nothing to delete — you were already a ghost.'}`,
              components: [],
            }).catch((err) => console.error('Forgetme confirm failed:', (err as Error).message));
          } else {
            await btn.update({ content: "something went wrong deleting your data. try again later.", components: [] }).catch((err) => console.error('Forgetme error failed:', (err as Error).message));
          }
        }
      });

      collector.on('end', async (collected) => {
        if (collected.size === 0) {
          try { await interaction.editReply({ content: 'timed out. your data is safe... for now.', components: [] }); } catch { /* expired */ }
        }
      });
      break;
    }

    case 'conspiracy': {
      await interaction.deferReply();
      const topic = interaction.options.getString('topic');
      const targetUser = interaction.options.getUser('user');
      const targetMember = targetUser ? interaction.guild?.members.cache.get(targetUser.id) : null;
      const callerMember = interaction.guild?.members.cache.get(interaction.user.id);
      const userName = targetMember?.displayName ?? targetUser?.displayName ?? callerMember?.displayName ?? interaction.user.username;
      const targetId = targetUser?.id || interaction.user.id;

      try {
        // Pull semantic connections from vector memory
        const searchQuery = topic ?? `${userName} secrets suspicious`;
        const memories = await searchMemories(searchQuery, { guildId, userId: topic ? null : targetId, limit: 8 });

        // Get active users for name material (only when topic is provided)
        const guild = interaction.guild;
        const members = topic
          ? (guild?.members.cache
              .filter((m) => !m.user.bot)
              .map((m) => m.displayName)
              .slice(0, 15) ?? [])
          : [];

        const memoryContext = memories.length > 0
          ? `Known facts from memory:\n${memories.map((m) => {
              const member = guild?.members.cache.get(m.userId);
              const name = member?.displayName ?? 'someone';
              return `- ${name}: ${m.content}`;
            }).join('\n')}`
          : '';

        // User-focused (no topic) vs server-wide (with topic)
        const prompt = topic
          ? [
              `Generate an unhinged conspiracy theory connecting people in this Discord server.`,
              `Seed topic: "${topic}"`,
              members.length > 0 ? `Server members you can use: ${members.join(', ')}` : null,
              memoryContext,
              `Rules:`,
              `- Use REAL member names from the list above (plain text only, NEVER @mention or tag anyone)`,
              `- Connect at least 3 people in the theory`,
              `- Reference any relevant facts from memory if available`,
              `- Make it absurd but specific — not generic`,
              `- 3-5 sentences max`,
              `- End with a dramatic "coincidence? i think not." or similar`,
            ].filter(Boolean).join('\n')
          : [
              `Generate an unhinged conspiracy theory about ${userName} based on what you know about them.`,
              memoryContext,
              `Rules:`,
              `- Focus on ${userName} specifically — what are they REALLY up to?`,
              `- Use their known facts/memories as "evidence"`,
              `- Make it absurd but specific to them — not generic`,
              `- 3-5 sentences max`,
              `- End with a dramatic "coincidence? i think not." or similar`,
            ].filter(Boolean).join('\n');

        const response = await queryAI(prompt, {
          systemPrompt: 'You are Sass, a conspiracy theorist bot. Generate unhinged but funny conspiracy theories. Use real names (plain text only — NEVER use @mentions, <@ids>, or Discord tags). Lowercase. Be specific and creative. Reference facts when available.',
          maxTokens: 250,
        });

        if (!response) throw new Error('Empty response');

        const embed = new EmbedBuilder()
          .setColor(0x2F3136)
          .setTitle(`🕵️ CONSPIRACY — ${topic?.toUpperCase() ?? userName.toUpperCase()}`)
          .setDescription(response)
          .setFooter({ text: 'sass intelligence agency — classified document' })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        messageBuffer.injectBotMessage(interaction.channelId, `[Sass /conspiracy result: ${response.slice(0, 80)}...]`);
      } catch (err) {
        console.error('Conspiracy command failed:', (err as Error).message);
        await interaction.editReply("i tried to connect the dots but the dots filed a restraining order.");
      }
      break;
    }

    default:
      break;
  }
}
