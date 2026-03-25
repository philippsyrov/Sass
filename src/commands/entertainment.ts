import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { queryAI } from '../ai.js';
import * as userMemory from '../userMemory.js';
import { logInteraction, getTopReactions } from '../database/index.js';
import * as mood from '../mood.js';
import { hasUsedToday, markUsedToday } from '../shared/commandUtils.js';
import { activeBattles } from '../roastBattle.js';

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

    case 'dare': {
      const targetUser = interaction.options.getUser('user', true);
      if (hasUsedToday(guildId, interaction.user.id, 'dare')) {
        await interaction.reply({ content: "you already dared someone today. one chaos event per day is enough.", ephemeral: true }).catch((err) => console.error('Dare cooldown reply failed:', (err as Error).message));
        break;
      }
      await interaction.deferReply();
      const userContext = await userMemory.getContext(guildId, targetUser.id);
      try {
        const response = await queryAI(
          `Generate a dare for the Discord user "${targetUser.displayName}". The dare should be something they can do in the Discord server (send a message, change their nickname, post something, etc). Make it funny and slightly unhinged but not harmful. Also rate the difficulty 1-5.\n\n${userContext ? `What you know about them: ${userContext}` : 'You don\'t know much about them yet.'}\n\nRespond in EXACTLY this format:\nDARE: [the dare]\nDIFFICULTY: [1-5]`,
          { systemPrompt: 'You generate funny Discord dares. Creative, unhinged, but not harmful or against TOS. Lowercase. The dare should be specific and doable in Discord.' }
        );
        const dareMatch = response?.match(/DARE:\s*(.+)/i);
        const diffMatch = response?.match(/DIFFICULTY:\s*(\d)/);
        const dareText = dareMatch?.[1]?.trim() ?? 'i dare you to explain why you needed a bot to dare you';
        const difficulty = Math.min(5, Math.max(1, parseInt(diffMatch?.[1] ?? '3', 10)));
        const skulls = '\u{1F480}'.repeat(difficulty) + '\u{1FA76}'.repeat(5 - difficulty);

        const embed = new EmbedBuilder()
          .setColor(0xFF4D6D)
          .setTitle(`\u{1F3B2} DARE \u2014 ${targetUser.displayName.toUpperCase()}`)
          .setDescription(dareText)
          .addFields(
            { name: 'Difficulty', value: skulls, inline: true },
          )
          .setFooter({ text: 'sass dares you. do it or be a coward.' });
        markUsedToday(guildId, interaction.user.id, 'dare');
        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        console.error('Dare command failed:', (err as Error).message);
        await interaction.editReply(`i dare ${targetUser.displayName} to do literally anything interesting for once.`);
      }
      break;
    }

    case 'confess': {
      const targetUser = interaction.options.getUser('user', true);
      const confession = interaction.options.getString('confession') ?? '';

      if (targetUser.id === interaction.user.id) {
        await interaction.reply({ content: "you can't confess to yourself. that's just thinking.", ephemeral: true }).catch((err) => console.error('Confess self reply failed:', (err as Error).message));
        break;
      }
      if (targetUser.bot) {
        await interaction.reply({ content: "confessing to a bot? down bad doesn't even begin to cover it.", ephemeral: true }).catch((err) => console.error('Confess bot reply failed:', (err as Error).message));
        break;
      }
      if (hasUsedToday(guildId, interaction.user.id, 'confess')) {
        await interaction.reply({ content: "one confession per day. you're not a priest.", ephemeral: true }).catch((err) => console.error('Confess cooldown reply failed:', (err as Error).message));
        break;
      }

      // Ephemeral ack to confessor
      await interaction.reply({ content: "got it. your secret's safe with me... for now \u{1F440}", ephemeral: true }).catch((err) => console.error('Confess ack reply failed:', (err as Error).message));

      try {
        const commentary = await queryAI(
          `Someone anonymously confessed "${confession}" to ${targetUser.displayName}. React in ONE short sentence (under 12 words). Roast the confessor for being too scared to say it themselves. No fancy vocabulary.`,
          { systemPrompt: 'You are Sass. One short sentence. Lowercase. Talk like a 20-year-old in a group chat, not a poet. No words like "breathtaking", "celestial", "revelation", "poetic", "devotion".' }
        );
        const channel = interaction.channel;
        if (channel && 'send' in channel) {
          await channel.send(`\u{1F4E9} **ANONYMOUS CONFESSION** for <@${targetUser.id}>:\n\n> *"${confession}"*\n\n${commentary ?? "someone couldn't find the guts to say this themselves. shocking."}`).catch((err) => console.error('Confess message send failed:', (err as Error).message));
          markUsedToday(guildId, interaction.user.id, 'confess');
          logInteraction({
            serverId: interaction.guild?.id ?? '',
            serverName: interaction.guild?.name ?? '',
            channelId: channel.id,
            channelName: 'name' in channel ? (channel as { name: string }).name : '',
            userId: interaction.user.id,
            username: interaction.user.displayName ?? interaction.user.username,
            triggerType: 'confess',
            commandName: 'confess',
            userMessage: confession,
            sassResponse: commentary ?? '',
            mood: (await mood.getStatus(guildId)).mood,
            moodIntensity: (await mood.getStatus(guildId)).intensity,
          }).catch((err) => console.error('DB log failed:', err.message));
        }
      } catch (err) {
        console.error('Confess failed:', (err as Error).message);
        // Don't expose error to channel since we already replied ephemerally
      }
      break;
    }

    case 'predict': {
      const targetUser = interaction.options.getUser('user') ?? interaction.user;
      const targetKey = `${targetUser.id}:predict`;
      if (hasUsedToday(guildId, interaction.user.id, targetKey)) {
        await interaction.reply(`you already got ${targetUser.id === interaction.user.id ? 'your' : 'their'} prediction today. the future hasn't changed in the last 5 minutes.`).catch((err) => console.error('Predict cooldown reply failed:', (err as Error).message));
        break;
      }
      await interaction.deferReply();

      const userData = await userMemory.getContext(guildId, targetUser.id);
      const facts = await userMemory.getFacts(guildId, targetUser.id);
      const userStats = await userMemory.getUserStats(guildId, targetUser.id);
      const messageCount = userStats?.messageCount ?? 0;
      const timesRoasted = userStats?.timesRoasted ?? 0;

      const dataPrompt = [
        `User: ${targetUser.displayName}`,
        messageCount > 0 ? `Messages sent: ${messageCount}` : null,
        timesRoasted > 0 ? `Times roasted: ${timesRoasted}` : null,
        facts.length > 0 ? `Known facts: ${facts.join('; ')}` : null,
        userData ? `Context: ${userData}` : null,
      ].filter(Boolean).join('\n');

      try {
        const response = await queryAI(
          `Predict ${targetUser.displayName}'s future based on their Discord data. Be specific to THEIR data, not generic.\n\n${dataPrompt}\n\nFormat:\n\u{1F52E} PAST: [one sentence]\n\u{1F4CD} PRESENT: [one sentence]\n\u{1F31F} FUTURE: [one specific, funny prediction]\n\u{1F340} lucky item: [something insulting based on their behavior]`,
          { systemPrompt: 'You are a sassy fortune teller. Use the provided Discord data to make specific predictions. Lowercase. Short sentences. Mystical but devastating. Never repeat the same prediction twice \u2014 each one must be unique to the user.', maxTokens: 200 }
        );
        if (!response) throw new Error('Empty response from AI');
        markUsedToday(guildId, interaction.user.id, targetKey);
        const embed = new EmbedBuilder()
          .setColor(0x9B59B6)
          .setTitle(`\u{1F52E} PREDICTION \u2014 ${targetUser.displayName.toUpperCase()}`)
          .setDescription(response)
          .setFooter({ text: 'sass sees all. sass knows all. sass judges all.' })
          .setTimestamp();
        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        console.error('Predict command failed:', (err as Error).message);
        await interaction.editReply(`the crystal ball showed me ${targetUser.displayName}'s future and honestly? it cracked. that's the prediction.`);
      }
      break;
    }

    default:
      break;
  }
}
