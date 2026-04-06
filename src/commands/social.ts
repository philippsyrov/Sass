import {
  EmbedBuilder,
  AttachmentBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { queryAI, analyzeProfile } from '../ai/index.js';
import * as userMemory from '../userMemory.js';
import { logCommand, getAffinity } from '../database/index.js';
import { getShipScore, warmPairCache } from '../shipScore.js';
import { generateShipImage, type ShipCardOptions } from '../shipImage.js';
import { messageBuffer } from '../messageBuffer.js';
import { getUserMemories } from '../vectorMemory.js';

export async function handleSocialCommand(
  interaction: ChatInputCommandInteraction,
  commandName: string,
  guildId: string,
): Promise<void> {
  switch (commandName) {
    case 'ship': {
      await interaction.deferReply();
      const user1 = interaction.options.getUser('user1', true);
      const user2 = interaction.options.getUser('user2', true);

      if (user1.id === user2.id) {
        await interaction.editReply('you can\'t ship someone with themselves. that\'s just called being alone.');
        break;
      }

      // Check if shipping with Sass — use affinity instead of hash
      const botId = interaction.client.user?.id;
      const isShipWithSass = botId && (user1.id === botId || user2.id === botId);
      const otherUser = isShipWithSass ? (user1.id === botId ? user2 : user1) : null;

      // Creator-only score override for testing card tiers
      const isCreator = interaction.user.id === process.env.CREATOR_ID;
      const scoreOverride = isCreator ? interaction.options.getInteger('score') : null;

      let percent: number;
      if (scoreOverride !== null && scoreOverride !== undefined) {
        percent = scoreOverride;
      } else if (isShipWithSass && otherUser) {
        percent = Math.round(await getAffinity(guildId, otherUser.id));
      } else {
        await warmPairCache(guildId, user1.id, user2.id);
        percent = await getShipScore(guildId, user1.id, user2.id);
      }
      const avatar1 = user1.displayAvatarURL({ extension: 'png', size: 128 });
      const avatar2 = user2.displayAvatarURL({ extension: 'png', size: 128 });

      try {
        const shipPrompt = isShipWithSass
          ? `Someone shipped "${otherUser?.displayName}" with you (Sass). Your affinity with them is ${percent}%. ONE sentence verdict about how you feel about them, max 12 words. Be tsundere — if high affinity, admit you like them reluctantly. If low, be cold.`
          : `"${user1.displayName}" x "${user2.displayName}" at ${percent}%. ONE sentence verdict, max 12 words. No metaphors or object comparisons. React like a friend judging a couple.`;

        const shipName = user1.displayName.slice(0, Math.ceil(user1.displayName.length / 2)) +
          user2.displayName.slice(Math.floor(user2.displayName.length / 2));

        // Determine tier label for card — same logic used below for embed
        let cardTierLabel: string;
        if (isShipWithSass) {
          if (percent >= 96) cardTierLabel = 'ride or die';
          else if (percent >= 86) cardTierLabel = 'favorite';
          else if (percent >= 71) cardTierLabel = 'liked';
          else if (percent >= 51) cardTierLabel = 'familiar';
          else if (percent >= 31) cardTierLabel = 'acquaintance';
          else if (percent >= 16) cardTierLabel = 'nuisance';
          else cardTierLabel = 'stranger';
        } else {
          if (percent >= 95) cardTierLabel = 'soulmates';
          else if (percent >= 80) cardTierLabel = 'power couple';
          else if (percent >= 60) cardTierLabel = 'close';
          else if (percent >= 40) cardTierLabel = 'friends';
          else if (percent >= 25) cardTierLabel = 'acquaintances';
          else if (percent >= 15) cardTierLabel = 'awkward';
          else cardTierLabel = 'enemies';
        }

        // Get AI verdict first, then generate image with verdict baked in
        const verdictRaw = await queryAI(shipPrompt, {
          systemPrompt: 'You judge ship compatibility. ONE short sentence. Max 12 words. Lowercase. Talk like a 20-year-old, not a poet. No "chemistry of a [object]" comparisons. If you exceed 12 words, you failed.',
        });
        let verdict = verdictRaw;

        // Hard enforce 12 word cap — truncate to first sentence if too long
        if (verdict && verdict.split(/\s+/).length > 14) {
          const firstSentence = verdict.split(/[.!?]/)[0];
          verdict = firstSentence ? firstSentence.trim() + '.' : verdict.split(/\s+/).slice(0, 12).join(' ') + '.';
        }

        // Generate ship card with all info baked into the image
        const cardOpts: ShipCardOptions = {
          avatarUrl1: avatar1,
          avatarUrl2: avatar2,
          percent,
          displayName1: user1.displayName,
          displayName2: user2.displayName,
          shipName,
          tierLabel: cardTierLabel,
          verdict: verdict ?? undefined,
        };
        const shipBuffer = await generateShipImage(cardOpts)
          .catch((imgErr) => { console.error('Ship image generation failed:', (imgErr as Error).message); return null; });

        const files = shipBuffer ? [new AttachmentBuilder(shipBuffer, { name: 'ship.png' })] : [];

        if (files.length > 0) {
          const embed = new EmbedBuilder()
            .setColor(percent >= 50 ? 0xFF4D6D : 0x4A6FA5)
            .setImage('attachment://ship.png');
          await interaction.editReply({ embeds: [embed], files });
        } else {
          // Fallback: text-only if image generation fails
          await interaction.editReply(
            `\u{1F498} **${user1.displayName}** x **${user2.displayName}** — ${percent}% ${cardTierLabel}\n*${verdict}*`
          );
        }

        // Inject into message buffer so Sass can see slash command results
        const channelId = interaction.channelId;
        const tierLabel = isShipWithSass
          ? (percent >= 96 ? 'ride or die' : percent >= 86 ? 'favorite' : percent >= 71 ? 'liked' : percent >= 51 ? 'familiar' : 'acquaintance')
          : (percent >= 80 ? 'power couple' : percent >= 60 ? 'close' : percent >= 40 ? 'friends' : 'acquaintances');
        messageBuffer.injectBotMessage(channelId, `[Sass /ship result: ${user1.displayName} x ${user2.displayName} = ${percent}%, tier: ${tierLabel}]`);
      } catch (err) {
        console.error('Ship command failed:', (err as Error).message);
        await interaction.editReply(
          `\u{1F498} **${user1.displayName}** x **${user2.displayName}** — ${percent}%\n` +
          `*my brain crashed trying to imagine this couple. that tells you everything.*`
        );
      }
      break;
    }

    case 'favorite': {
      await interaction.deferReply();
      const board = await userMemory.getLeaderboard(guildId, 1);
      const fav = board[0];
      if (!fav || fav.timesRoasted === 0) {
        await interaction.editReply("i don't have a favorite yet. nobody's earned it. or deserved it.");
        break;
      }
      const responses = [
        `my current favorite punching bag is **${fav.name}** with ${fav.timesRoasted} roasts. they keep coming back for more.`,
        `**${fav.name}**. ${fav.timesRoasted} roasts and counting. at this point it's a relationship.`,
        `gotta be **${fav.name}**. they've been roasted ${fav.timesRoasted} times and still haven't learned.`,
      ];
      const favResponse = responses[Math.floor(Math.random() * responses.length)] ?? '';
      await interaction.editReply(favResponse);
      break;
    }

    case 'compliment': {
      await interaction.deferReply();
      const targetUser = interaction.options.getUser('user', true);
      try {
        const response = await queryAI(
          `Give "${targetUser.displayName}" a backhanded compliment. It should sound genuinely nice at first, then subtly roast them by the end. One or two sentences. The twist should be subtle enough that they have to read it twice.`,
          { systemPrompt: 'You give backhanded compliments. Sound sincere at first, then twist. Lowercase. Subtle is key \u2014 the best ones take a second to register.' }
        );
        await interaction.editReply(`\u{1F490} ${response}`);
      } catch (err) {
        console.error('Compliment command failed:', (err as Error).message);
        await interaction.editReply(`\u{1F490} ${targetUser.displayName}, you're really brave for being yourself when literally any other option exists.`);
      }
      break;
    }

    case 'profile': {
      await interaction.deferReply();
      const targetUser = interaction.options.getUser('user') ?? interaction.user;
      const targetId = targetUser.id;
      const targetName = targetUser.displayName || targetUser.username;

      try {
        const channel = interaction.channel;
        if (!channel || !('messages' in channel)) {
          await interaction.editReply("i can't read messages here. try a normal text channel.");
          break;
        }
        const fetched = await channel.messages.fetch({ limit: 100 });
        const userMsgs = fetched
          .filter((m) => m.author.id === targetId && !m.author.bot)
          .map((m) => m.content)
          .filter((c) => c.length > 0)
          .reverse()
          .slice(0, 30);

        if (userMsgs.length < 3) {
          // Supplement with vector memory + stored facts
          const [memories, facts] = await Promise.all([
            getUserMemories(guildId, targetId),
            userMemory.getFacts(guildId, targetId),
          ]);

          const supplementLines: string[] = [...userMsgs];
          for (const mem of memories) {
            supplementLines.push(`[memory] ${mem.content}`);
          }
          for (const fact of facts) {
            supplementLines.push(`[fact] ${fact}`);
          }

          if (supplementLines.length < 3) {
            await interaction.editReply(`${targetName} barely talks. can't profile a ghost.`);
            break;
          }

          // Use supplemented data instead
          userMsgs.push(...supplementLines.slice(userMsgs.length));
        }

        const raw = await analyzeProfile(targetName, userMsgs.join('\n'));
        if (!raw) {
          await interaction.editReply("my brain crashed trying to analyze this person. that says a lot honestly.");
          break;
        }

        const lines = raw.trim().split('\n');
        const scores: Record<string, number> = {};
        let archetype = 'Unknown';
        let roast = '';
        for (const line of lines) {
          const [key, ...rest] = line.split(':');
          if (!key) continue;
          const val = rest.join(':').trim();
          if (['chaos', 'thirst', 'aggro', 'clown', 'brain'].includes(key.trim())) {
            scores[key.trim()] = Math.min(10, Math.max(0, parseInt(val, 10) || 0));
          } else if (key.trim() === 'archetype') {
            archetype = val;
          } else if (key.trim() === 'roast') {
            roast = val;
          }
        }

        const barFn = (score: number): string => '\u2588'.repeat(score) + '\u2591'.repeat(10 - score);
        const profile = [
          `**${targetName}'s behavioral diagnosis**`,
          `> archetype: **${archetype}**`,
          '',
          `\`chaos \` ${barFn(scores['chaos'] || 0)} **${scores['chaos'] || 0}**/10`,
          `\`thirst\` ${barFn(scores['thirst'] || 0)} **${scores['thirst'] || 0}**/10`,
          `\`aggro \` ${barFn(scores['aggro'] || 0)} **${scores['aggro'] || 0}**/10`,
          `\`clown \` ${barFn(scores['clown'] || 0)} **${scores['clown'] || 0}**/10`,
          `\`brain \` ${barFn(scores['brain'] || 0)} **${scores['brain'] || 0}**/10`,
          '',
          `*${roast}*`,
        ];
        await interaction.editReply(profile.join('\n'));
        messageBuffer.injectBotMessage(interaction.channelId, `[Sass /profile result: ${targetName} — archetype: ${archetype}, roast: ${roast}]`);
        logCommand({ serverId: guildId, userId: interaction.user.id, commandName: 'profile', commandType: 'slash' }).catch((err) => console.error('Log command failed:', (err as Error).message));
      } catch (err) {
        console.error('Profile command failed:', (err as Error).message);
        await interaction.editReply("my brain crashed trying to analyze this person. that says a lot honestly.");
      }
      break;
    }

    case 'leaderboard': {
      await interaction.deferReply();
      const board = await userMemory.getLeaderboard(guildId, 5);
      if (board.length === 0 || board.every((u) => u.timesRoasted === 0)) {
        await interaction.editReply("nobody's been roasted enough to make a list yet. give it time.");
        break;
      }
      const medals = ['\u{1F451}', '\u{1F480}', '\u{1FAA6}', '\u{1F4A9}', '\u{1F921}'];
      const lines = board
        .filter((u) => u.timesRoasted > 0)
        .map((u, i) => `${medals[i] || '\u2022'} **${u.name}** \u2014 roasted ${u.timesRoasted} time${u.timesRoasted === 1 ? '' : 's'}`);
      await interaction.editReply(`**sass's wall of shame**\n${lines.join('\n')}`);
      logCommand({ serverId: guildId, userId: interaction.user.id, commandName: 'leaderboard', commandType: 'slash' }).catch((err) => console.error('Log command failed:', (err as Error).message));
      break;
    }

    default:
      break;
  }
}
