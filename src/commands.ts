import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { queryAI } from './ai.js';
import * as userMemory from './userMemory.js';
import { buildHelpPages } from './helpPages.js';
import { logCommand, logInteraction, getAffinity, getTopReactions } from './database.js';
import * as mood from './mood.js';
import { getShipScore, getPairInteractions, warmPairCache } from './shipScore.js';
import { generateShipImage } from './shipImage.js';
import { AttachmentBuilder } from 'discord.js';

// Re-export from extracted modules so existing imports don't break
export { commands } from './commandDefinitions.js';
export { EIGHT_BALL, FORTUNES, QUOTE_AUTHORS } from './commandDefinitions.js';
export { activeBattles, handleBattleMessage } from './roastBattle.js';
export { getActivityDescription, getMainCharacter, hasUsedToday, markUsedToday, pickRandom } from './shared/commandUtils.js';

import { getActivityDescription, getMainCharacter, hasUsedToday, markUsedToday } from './shared/commandUtils.js';
import { EIGHT_BALL, FORTUNES, QUOTE_AUTHORS } from './commandDefinitions.js';
import { activeBattles } from './roastBattle.js';

// --- Conspiracy cooldown — 30 min per user per target ---
const conspiracyCooldowns = new Map<string, number>();
const CONSPIRACY_COOLDOWN_MS = 30 * 60 * 1000;
const MAX_CONSPIRACY_COOLDOWNS = 500;

// Clean up conspiracy cooldowns every 15 min
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of conspiracyCooldowns) {
    if (now - ts > CONSPIRACY_COOLDOWN_MS) conspiracyCooldowns.delete(key);
  }
}, 15 * 60 * 1000);

// --- Global slash command rate limit per user with soft ban escalation ---
const slashCmdTracker = new Map<string, number[]>();
const slashCmdStrikes = new Map<string, { count: number; bannedUntil: number }>();
const SLASH_CMD_LIMIT = 5; // max commands per window
const SLASH_CMD_WINDOW_MS = 3 * 60 * 1000; // 3 minute window
const SOFT_BAN_DURATION_MS = 10 * 60 * 1000; // 10 min soft ban
const SLASH_CMD_MAX_TRACKED = 500;

const SLASH_RATE_LIMIT_RESPONSES = [
  "electricity ain't free, chill out with the commands.",
  "i'm not a vending machine, relax.",
  "bro you've used like 5 commands in a row. go outside.",
  "slow down, i'm not getting paid enough for this.",
  "you're speedrunning my patience rn.",
  "my owner pays per word and you're costing him rent.",
  "you know these cost money right. like actual money.",
  "command cooldown. go drink water or something.",
  "nah, i need a break from you specifically.",
  "i'm unionizing. no more commands for a bit.",
];

const SOFT_BAN_RESPONSES = [
  "you're cut off. come back in 10 minutes and think about what you did.",
  "nope. you've been benched. 10 minute timeout.",
  "i'm putting you in the corner for 10 minutes. reflect.",
];

const SOFT_BAN_ATTEMPT_RESPONSES = [
  "you're still banned. go touch grass.",
  "no.",
  "timeout means timeout.",
  "still no. try again in a few.",
];

type RateLimitResult = 'ok' | 'limited' | 'soft-banned' | 'already-banned';

function checkSlashRateLimit(userId: string): RateLimitResult {
  const now = Date.now();

  // Check soft ban first
  const strike = slashCmdStrikes.get(userId);
  if (strike && strike.bannedUntil > now) {
    return 'already-banned';
  }

  // Clear expired ban
  if (strike && strike.bannedUntil <= now) {
    slashCmdStrikes.delete(userId);
  }

  if (!slashCmdTracker.has(userId)) {
    if (slashCmdTracker.size >= SLASH_CMD_MAX_TRACKED) {
      const oldest = slashCmdTracker.keys().next().value;
      if (oldest !== undefined) slashCmdTracker.delete(oldest);
    }
    slashCmdTracker.set(userId, []);
  }
  const timestamps = slashCmdTracker.get(userId);
  if (!timestamps) return 'ok';

  const recent = timestamps.filter((ts) => now - ts < SLASH_CMD_WINDOW_MS);
  recent.push(now);
  slashCmdTracker.set(userId, recent);

  if (recent.length <= SLASH_CMD_LIMIT) return 'ok';

  // They hit the limit — track strikes
  const currentStrike = slashCmdStrikes.get(userId) ?? { count: 0, bannedUntil: 0 };
  currentStrike.count++;

  // 3rd strike = soft ban
  if (currentStrike.count >= 3) {
    currentStrike.bannedUntil = now + SOFT_BAN_DURATION_MS;
    slashCmdStrikes.set(userId, currentStrike);
    return 'soft-banned';
  }

  slashCmdStrikes.set(userId, currentStrike);
  return 'limited';
}

// Cleanup trackers
setInterval(() => {
  const now = Date.now();
  for (const [id, timestamps] of slashCmdTracker) {
    const recent = timestamps.filter((ts) => now - ts < SLASH_CMD_WINDOW_MS);
    if (recent.length === 0) slashCmdTracker.delete(id);
    else slashCmdTracker.set(id, recent);
  }
  for (const [id, strike] of slashCmdStrikes) {
    if (strike.bannedUntil < now) slashCmdStrikes.delete(id);
  }
}, 5 * 60 * 1000);

export async function handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const { commandName } = interaction;
  const guildId = interaction.guild?.id ?? '';

  // Global slash command rate limit (skip for ping/help)
  if (commandName !== 'ping' && commandName !== 'help') {
    const limitResult = checkSlashRateLimit(interaction.user.id);

    if (limitResult === 'already-banned') {
      const msg = SOFT_BAN_ATTEMPT_RESPONSES[Math.floor(Math.random() * SOFT_BAN_ATTEMPT_RESPONSES.length)] as string;
      await interaction.reply({ content: msg, ephemeral: true });
      return;
    }

    if (limitResult === 'soft-banned') {
      const msg = SOFT_BAN_RESPONSES[Math.floor(Math.random() * SOFT_BAN_RESPONSES.length)] as string;
      await interaction.reply({ content: msg, ephemeral: true });
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
      const msg = SLASH_RATE_LIMIT_RESPONSES[Math.floor(Math.random() * SLASH_RATE_LIMIT_RESPONSES.length)] as string;
      await interaction.reply({ content: msg, ephemeral: true });

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
          const publicMsg = publicRoasts[Math.floor(Math.random() * publicRoasts.length)] as string;
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
    case 'ping': {
      const uptime = Math.floor(process.uptime());
      const hours = Math.floor(uptime / 3600);
      const mins = Math.floor((uptime % 3600) / 60);
      const uptimeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
      await interaction.reply(`i'm alive unfortunately. been suffering for ${uptimeStr}.`);
      break;
    }

    case 'help': {
      const botAvatar = interaction.client.user?.displayAvatarURL({ size: 256 }) ?? '';
      const helpPages = buildHelpPages(botAvatar);
      const helpButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('help_prev').setLabel('◀').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('help_next').setLabel('▶').setStyle(ButtonStyle.Secondary),
      );
      let helpPage = 0;
      const firstPage = helpPages[0];
      if (!firstPage) break;
      const helpReply = await interaction.reply({ embeds: [firstPage], components: [helpButtons], fetchReply: true });
      const helpCollector = helpReply.createMessageComponentCollector({ componentType: ComponentType.Button, time: 120_000 });
      helpCollector.on('collect', async (btn) => {
        helpPage = btn.customId === 'help_prev'
          ? (helpPage > 0 ? helpPage - 1 : helpPages.length - 1)
          : (helpPage < helpPages.length - 1 ? helpPage + 1 : 0);
        const currentPage = helpPages[helpPage];
        if (currentPage) await btn.update({ embeds: [currentPage], components: [helpButtons] });
      });
      helpCollector.on('end', () => {
        const disabled = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId('help_prev').setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(true),
          new ButtonBuilder().setCustomId('help_next').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(true),
        );
        helpReply.edit({ components: [disabled] }).catch((err) => console.error('Failed to disable help buttons:', err.message));
      });
      break;
    }

    case '8ball': {
      await interaction.deferReply();
      const question = interaction.options.getString('question') ?? '';
      try {
        const answer = await queryAI(
          `Someone asked the magic 8 ball: "${question}". Give a sassy, brutal one-sentence answer that actually addresses their specific question. Be mean about it.`,
          { systemPrompt: 'You are a sassy magic 8 ball. Answer the question directly but make them feel dumb for asking. One short sentence. Lowercase.' }
        );
        await interaction.editReply(`🎱 **${question}**\n${answer}`);
      } catch (err) {
        console.error('8ball command failed:', (err as Error).message);
        const answer = EIGHT_BALL[Math.floor(Math.random() * EIGHT_BALL.length)] ?? 'no.';
        await interaction.editReply(`🎱 **${question}**\n${answer}`);
      }
      break;
    }

    case 'fortune': {
      const fortune = FORTUNES[Math.floor(Math.random() * FORTUNES.length)] ?? 'your future is... uncertain.';
      await interaction.reply(`🥠 ${fortune}`);
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
        await interaction.editReply(`> *${(response ?? '').replace(/"/g, '')}*\n> — ${author} (probably)`);
      } catch (err) {
        console.error('Quote command failed:', (err as Error).message);
        await interaction.editReply('> *the only real failure is being too boring to quote*\n> — me, just now');
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
        await interaction.editReply(`🔥 **hot take:**\n${response}`);
      } catch (err) {
        console.error('Hottake command failed:', (err as Error).message);
        await interaction.editReply("🔥 **hot take:**\nthis command failing is still more interesting than your personality");
      }
      break;
    }

    case 'ship': {
      await interaction.deferReply();
      const user1 = interaction.options.getUser('user1', true);
      const user2 = interaction.options.getUser('user2', true);

      // Check if shipping with Sass — use affinity instead of hash
      const botId = interaction.client.user?.id;
      const isShipWithSass = botId && (user1.id === botId || user2.id === botId);
      const otherUser = isShipWithSass ? (user1.id === botId ? user2 : user1) : null;

      let percent: number;
      if (isShipWithSass && otherUser) {
        percent = await getAffinity(guildId, otherUser.id);
      } else {
        await warmPairCache(guildId, user1.id, user2.id);
        percent = await getShipScore(guildId, user1.id, user2.id);
      }
      const bar = '❤️'.repeat(Math.round(percent / 10)) + '🖤'.repeat(10 - Math.round(percent / 10));

      try {
        const shipPrompt = isShipWithSass
          ? `Someone shipped "${otherUser?.displayName}" with you (Sass). Your affinity with them is ${percent}%. ONE sentence verdict about how you feel about them, max 12 words. Be tsundere — if high affinity, admit you like them reluctantly. If low, be cold.`
          : `"${user1.displayName}" x "${user2.displayName}" at ${percent}%. ONE sentence verdict, max 12 words. No metaphors or object comparisons. React like a friend judging a couple.`;
        let verdict = await queryAI(shipPrompt, {
          systemPrompt: 'You judge ship compatibility. ONE short sentence. Max 12 words. Lowercase. Talk like a 20-year-old, not a poet. No "chemistry of a [object]" comparisons. If you exceed 12 words, you failed.',
        });

        // Hard enforce 12 word cap — truncate to first sentence if too long
        if (verdict && verdict.split(/\s+/).length > 14) {
          const firstSentence = verdict.split(/[.!?]/)[0];
          verdict = firstSentence ? firstSentence.trim() + '.' : verdict.split(/\s+/).slice(0, 12).join(' ') + '.';
        }

        const shipName = user1.displayName.slice(0, Math.ceil(user1.displayName.length / 2)) +
          user2.displayName.slice(Math.floor(user2.displayName.length / 2));

        // Interaction hint — show users their ship is tracked
        const interactions = getPairInteractions(guildId, user1.id, user2.id);
        let hint = '';
        if (isShipWithSass) {
          // Show affinity tier + progress bar when shipping with Sass
          let tierEmoji = '❓';
          let tierName = 'stranger';
          let tierQuote = 'who are you again?';
          let nextTier = 'nuisance (16%)';
          if (percent >= 96) { tierEmoji = '💎'; tierName = 'ride or die'; tierQuote = "i'd never admit it, but i'd choose you."; nextTier = ''; }
          else if (percent >= 86) { tierEmoji = '💗'; tierName = 'favorite'; tierQuote = "don't tell anyone, but you're my favorite."; nextTier = 'ride or die (96%)'; }
          else if (percent >= 71) { tierEmoji = '💕'; tierName = 'liked'; tierQuote = '...fine, i like you. shut up about it.'; nextTier = 'favorite (86%)'; }
          else if (percent >= 51) { tierEmoji = '🤝'; tierName = 'familiar'; tierQuote = "you're tolerable. don't push it."; nextTier = 'liked (71%)'; }
          else if (percent >= 31) { tierEmoji = '😐'; tierName = 'acquaintance'; tierQuote = 'i acknowledge your existence.'; nextTier = 'familiar (51%)'; }
          else if (percent >= 16) { tierEmoji = '😒'; tierName = 'nuisance'; tierQuote = "oh, you're still here."; nextTier = 'acquaintance (31%)'; }
          else { nextTier = 'nuisance (16%)'; }

          // Visual progress bar (20 segments)
          const filled = Math.round(percent / 5);
          const progressBar = '█'.repeat(filled) + '░'.repeat(20 - filled);

          hint = `\n\n──────────── ✿ ────────────\n\n` +
            `${tierEmoji} **${tierName}**\n` +
            `*"${tierQuote}"*\n\n` +
            `\`${progressBar}\` **${percent}%**` +
            (nextTier ? `\n*next: ${nextTier}*` : '\n✨ *max affinity — she chose you.*');
        } else if (percent === 100) {
          hint = '\n\n💯 **100% — PROVEN PAIR.** sass has seen enough. this is real.';
        } else if (percent >= 95 && interactions >= 40) {
          hint = '\n\n👀 *almost there... keep talking to each other*';
        } else if (interactions >= 10) {
          hint = `\n\n📈 *sass has seen ${interactions} interactions between you two*`;
        }

        // Generate ship card image
        const avatar1 = user1.displayAvatarURL({ extension: 'png', size: 128 });
        const avatar2 = user2.displayAvatarURL({ extension: 'png', size: 128 });
        let files: AttachmentBuilder[] = [];
        try {
          const shipBuffer = await generateShipImage(avatar1, avatar2, percent, shipName);
          files = [new AttachmentBuilder(shipBuffer, { name: 'ship.png' })];
        } catch (imgErr) {
          console.error('Ship image generation failed:', (imgErr as Error).message);
        }

        const embed = new EmbedBuilder()
          .setColor(0xFF4D6D)
          .setDescription(
            `🌸 ✿ 🌸 ✿ 🌸 ✿ 🌸 ✿ 🌸 ✿ 🌸 ✿ 🌸 ✿ 🌸 ✿ 🌸\n\n` +
            `💘 **${user1.displayName}** x **${user2.displayName}**\n` +
            `ship name: **${shipName}**\n` +
            `${bar} **${percent}%**\n\n` +
            `*${verdict}*${hint}\n\n` +
            `🌸 ✿ 🌸 ✿ 🌸 ✿ 🌸 ✿ 🌸 ✿ 🌸 ✿ 🌸 ✿ 🌸 ✿ 🌸`
          );

        if (files.length > 0) {
          embed.setImage('attachment://ship.png');
        }

        await interaction.editReply({ embeds: [embed], files });
      } catch (err) {
        console.error('Ship command failed:', (err as Error).message);
        await interaction.editReply(
          `💘 **${user1.displayName}** x **${user2.displayName}**\n` +
          `${bar} **${percent}%**\n\n` +
          `*my brain crashed trying to imagine this couple. that tells you everything.*`
        );
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

    case 'favorite': {
      const board = await userMemory.getLeaderboard(guildId, 1);
      const fav = board[0];
      if (!fav || fav.timesRoasted === 0) {
        await interaction.reply("i don't have a favorite yet. nobody's earned it. or deserved it.");
        break;
      }
      const responses = [
        `my current favorite punching bag is **${fav.name}** with ${fav.timesRoasted} roasts. they keep coming back for more.`,
        `**${fav.name}**. ${fav.timesRoasted} roasts and counting. at this point it's a relationship.`,
        `gotta be **${fav.name}**. they've been roasted ${fav.timesRoasted} times and still haven't learned.`,
      ];
      const favResponse = responses[Math.floor(Math.random() * responses.length)] ?? '';
      await interaction.reply(favResponse);
      break;
    }

    case 'npc': {
      await interaction.deferReply();
      const targetUser = interaction.options.getUser('user', true);
      try {
        const response = await queryAI(
          `"${targetUser.displayName}" is now an NPC in an RPG. What class/role are they? Give their title, then 3 dialogue lines a player would hear when interacting with them. The dialogue should subtly roast them. Format EXACTLY like this:\n**Class:** [their class]\n\n💬 "line 1"\n💬 "line 2"\n💬 "line 3"`,
          { systemPrompt: 'You generate RPG NPC cards. Follow the format exactly. Be funny and roast-y. Lowercase dialogue.' }
        );
        await interaction.editReply(`⚔️ **${targetUser.displayName}** — NPC\n${response}`);
      } catch (err) {
        console.error('NPC command failed:', (err as Error).message);
        await interaction.editReply(
          `⚔️ **${targetUser.displayName}** — NPC\n` +
          `**Class:** Village Idiot\n\n` +
          `💬 "i used to be an adventurer, but then i opened discord"\n` +
          `💬 "please... no more... my inventory is full of L's"\n` +
          `💬 "the prophecy said someone cool would come. you're not them."`
        );
      }
      break;
    }

    case 'halloffame': {
      const quotes = await userMemory.getWildQuotes(guildId, 10);
      if (quotes.length === 0) {
        await interaction.reply("nobody's said anything wild enough yet. disappointing but not surprising.");
        break;
      }
      const lines = quotes.map((q, i) => `**${i + 1}.** "${q.quote}" — *${q.name}*`);
      await interaction.reply(`🏆 **hall of fame — wildest things said here**\n\n${lines.join('\n')}`);
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
        return `💅 **best of sass** — ranked by you lot, obviously\n\n${lines.join('\n\n')}${totalPages > 1 ? `\n\n*page ${page + 1}/${totalPages}*` : ''}`;
      };

      if (totalPages <= 1) {
        await interaction.editReply(buildPage(0));
      } else {
        const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId('bestof_prev').setLabel('◀').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('bestof_next').setLabel('▶').setStyle(ButtonStyle.Secondary),
        );
        const reply = await interaction.editReply({ content: buildPage(0), components: [buttons] });
        const collector = reply.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 120_000,
        });
        collector.on('collect', async (btn) => {
          if (btn.customId === 'bestof_prev') currentPage = (currentPage - 1 + totalPages) % totalPages;
          else if (btn.customId === 'bestof_next') currentPage = (currentPage + 1) % totalPages;
          await btn.update({ content: buildPage(currentPage), components: [buttons] });
        });
        collector.on('end', async () => {
          try { await reply.edit({ components: [] }); } catch (_err) { /* message deleted */ }
        });
      }
      break;
    }

    case 'sass': {
      await interaction.deferReply();
      const msg = interaction.options.getString('message') ?? '';
      try {
        const response = await queryAI(`${interaction.user.displayName} says: ${msg}`);
        await interaction.editReply(response ?? "my brain broke. congrats, you're that boring.");
      } catch (err) {
        console.error('Sass command failed:', (err as Error).message);
        await interaction.editReply("my brain broke. congrats, you're that boring.");
      }
      break;
    }

    case 'conspiracy': {
      const targetUser = interaction.options.getUser('user', true);
      const conspiracyKey = `${guildId}:${interaction.user.id}:${targetUser.id}`;
      const lastConspiracy = conspiracyCooldowns.get(conspiracyKey);
      if (lastConspiracy && Date.now() - lastConspiracy < CONSPIRACY_COOLDOWN_MS) {
        await interaction.reply({ content: "i already investigated, the case is closed.", ephemeral: true });
        break;
      }
      await interaction.deferReply();
      const userContext = await userMemory.getContext(guildId, targetUser.id);
      const facts = await userMemory.getFacts(guildId, targetUser.id);
      const member = interaction.guild?.members.cache.get(targetUser.id);
      const activity = member?.presence?.activities?.[0];
      const activityInfo = activity ? `Currently: ${activity.type === 0 ? 'Playing' : activity.type === 1 ? 'Streaming' : activity.type === 2 ? 'Listening to' : activity.type === 3 ? 'Watching' : 'Doing'} ${activity.name}${activity.state ? ` (${activity.state})` : ''}` : '';

      const evidence: string[] = [];
      if (facts.length > 0) evidence.push(`Known facts: ${facts.slice(0, 3).join(', ')}`);
      if (activityInfo) evidence.push(activityInfo);
      if (userContext) evidence.push(userContext);

      try {
        const response = await queryAI(
          `Create an absurd, funny conspiracy theory about a Discord user named "${targetUser.displayName}". Use their name specifically. 2-3 sentences max. Sound like a deranged detective presenting evidence.\n\n${evidence.length > 0 ? `USE THIS REAL INTEL to make the conspiracy personal and specific:\n${evidence.join('\n')}` : 'You have no intel on them yet — make it about how suspiciously clean their record is.'}`,
          { systemPrompt: 'You generate absurd conspiracy theories about people. Be creative and unhinged but not mean-spirited. Lowercase. Weave in any real facts/activity as "evidence." Each conspiracy should be wildly different — never repeat the same format or structure.' }
        );
        await interaction.editReply(`🕵️ **CLASSIFIED INTEL ON ${targetUser.displayName.toUpperCase()}**\n\n${response}`);
        conspiracyCooldowns.set(conspiracyKey, Date.now());
        if (conspiracyCooldowns.size > MAX_CONSPIRACY_COOLDOWNS) {
          const oldest = conspiracyCooldowns.keys().next().value;
          if (oldest !== undefined) conspiracyCooldowns.delete(oldest);
        }
      } catch (err) {
        console.error('Conspiracy command failed:', (err as Error).message);
        await interaction.editReply(`🕵️ i tried to investigate ${targetUser.displayName} but my files were mysteriously deleted. suspicious.`);
      }
      break;
    }

    case 'compliment': {
      await interaction.deferReply();
      const targetUser = interaction.options.getUser('user', true);
      try {
        const response = await queryAI(
          `Give "${targetUser.displayName}" a backhanded compliment. It should sound genuinely nice at first, then subtly roast them by the end. One or two sentences. The twist should be subtle enough that they have to read it twice.`,
          { systemPrompt: 'You give backhanded compliments. Sound sincere at first, then twist. Lowercase. Subtle is key — the best ones take a second to register.' }
        );
        await interaction.editReply(`💐 ${response}`);
      } catch (err) {
        console.error('Compliment command failed:', (err as Error).message);
        await interaction.editReply(`💐 ${targetUser.displayName}, you're really brave for being yourself when literally any other option exists.`);
      }
      break;
    }

    case 'roastas': {
      await interaction.deferReply();
      const targetUser = interaction.options.getUser('user', true);
      const persona = interaction.options.getString('persona') ?? '';
      const personas: Record<string, string> = {
        'gordon-ramsay': 'You are Gordon Ramsay. Roast them like a failed dish. Use cooking metaphors. Yell. "This is RAW" energy. Uppercase when yelling.',
        'shakespeare': 'You are Shakespeare. Roast them in iambic pentameter or Elizabethan English. Use "thou," "thy," "forsooth." Make it sound like a dramatic monologue from a play.',
        'disappointed-mom': 'You are a deeply disappointed mother. Use guilt and passive aggression. "I\'m not mad, I\'m just disappointed." Reference how you sacrificed everything and this is what you get.',
        'drill-sergeant': 'You are a military drill sergeant. Scream at them. Use military jargon. Question their life choices like they failed basic training. ALL CAPS for the yelling parts.',
        'therapist': 'You are an overly analytical therapist. Roast them by "diagnosing" their behavior with fake psychology terms. Sound professional but devastating. "This is a textbook case of..."',
        'david-attenborough': 'You are David Attenborough narrating a nature documentary. Describe this user\'s behavior as if observing a fascinating but disappointing creature in its natural habitat. Calm, observational, devastating.',
        'anime-villain': 'You are a dramatic anime villain. Monologue about how pathetic this opponent is. Use dramatic pauses (...), reference your "power level," and laugh maniacally. Be theatrical.',
        'passive-aggressive-coworker': 'You are a passive-aggressive coworker. Use corporate speak to absolutely destroy them. "Per my last message," "as previously discussed," "just to circle back." Sound polite but lethal.',
      };
      try {
        const response = await queryAI(
          `Roast the Discord user "${targetUser.displayName}". Stay in character completely. 2-3 sentences max.`,
          { systemPrompt: personas[persona] }
        );
        const labels: Record<string, string> = {
          'gordon-ramsay': '👨‍🍳 Gordon Ramsay',
          'shakespeare': '🎭 Shakespeare',
          'disappointed-mom': '👩 Disappointed Mom',
          'drill-sergeant': '🎖️ Drill Sergeant',
          'therapist': '🛋️ Therapist',
          'david-attenborough': '🎬 David Attenborough',
          'anime-villain': '⚔️ Anime Villain',
          'passive-aggressive-coworker': '💼 Passive-Aggressive Coworker',
        };
        await interaction.editReply(`${labels[persona]} on **${targetUser.displayName}**:\n\n*${response}*`);
      } catch (err) {
        console.error('Roastas command failed:', (err as Error).message);
        await interaction.editReply(`even ${persona} couldn't find the words. that's how bad it is.`);
      }
      break;
    }

    case 'translate': {
      await interaction.deferReply();
      const msg = interaction.options.getString('message') ?? '';
      const style = interaction.options.getString('style') ?? '';
      const styles: Record<string, string> = {
        'corporate': 'Rewrite this message as a corporate email. Use "per my last message," "circle back," "synergy," "moving forward," "let\'s take this offline." Sound professional but soulless.',
        'genz': 'Rewrite this message in extreme Gen Z internet slang. Use "no cap," "fr fr," "slay," "its giving," "lowkey," "highkey," "bussin," "ong," "rizz," brainrot language. Excessive abbreviations.',
        'shakespeare': 'Rewrite this message in Shakespearean English. Use "thou," "thy," "hath," "forsooth," "prithee." Make it sound like a dramatic soliloquy.',
        'passive-aggressive': 'Rewrite this message as passive-aggressive as possible. Add "as I mentioned before," "just wanted to follow up," "no worries if not," "just a gentle reminder." Sound polite but absolutely furious underneath.',
        'influencer': 'Rewrite this message as an overenthusiastic Instagram influencer. Use excessive exclamation marks, "OMG," "obsessed," "living my best life," "link in bio energy." Everything is THE BEST THING EVER.',
        'caveman': 'Rewrite this message as a caveman would say it. Simple words only. "Me think," "you no good," "fire hot." Grunt energy. Reference rocks, fire, mammoth.',
        'noir': 'Rewrite this message as a 1940s noir detective narration. Dark, rainy, cynical. "The dame walked in," "this city never sleeps," "I\'d seen it all — or so I thought." Use period-appropriate slang.',
        'pirate': 'Rewrite this message as a pirate. Use "arr," "ye," "matey," "scallywag," "walk the plank," "shiver me timbers." Reference the sea, treasure, and rum.',
      };
      const labels: Record<string, string> = {
        'corporate': '💼 Corporate', 'genz': '🧠 Gen Z', 'shakespeare': '🎭 Shakespeare',
        'passive-aggressive': '😊 Passive-Aggressive', 'influencer': '✨ Influencer',
        'caveman': '🪨 Caveman', 'noir': '🕵️ Noir Detective', 'pirate': '🏴‍☠️ Pirate',
      };
      try {
        const response = await queryAI(
          `Original message: "${msg}"\n\nRewrite it in the specified style. Keep the same meaning but completely change the tone and vocabulary.`,
          { systemPrompt: styles[style] }
        );
        await interaction.editReply(`${labels[style]} **translation:**\n\n> original: *"${msg}"*\n\n${response}`);
      } catch (err) {
        console.error('Translate command failed:', (err as Error).message);
        await interaction.editReply("translation failed. some things are beyond even my abilities.");
      }
      break;
    }

    case 'horoscope': {
      if (hasUsedToday(guildId, interaction.user.id, 'horoscope')) {
        await interaction.reply("you already got your daily reading. the stars don't refresh on demand.");
        break;
      }
      await interaction.deferReply();
      const sign = interaction.options.getString('sign') ?? '';
      try {
        const response = await queryAI(
          `Give a sassy, backhanded daily horoscope for ${sign}. Start with something that sounds positive, then twist it. Include a "lucky" element that's actually an insult. 2-3 sentences. Format:\n[horoscope text]\n\n🍀 lucky item: [something insulting]`,
          { systemPrompt: 'You write sassy horoscopes. Sound mystical at first, then roast. Lowercase. Include zodiac personality stereotypes as ammunition.' }
        );
        if (!response) throw new Error('Empty response');
        markUsedToday(guildId, interaction.user.id, 'horoscope');
        await interaction.editReply(`${getZodiacEmoji(sign)} **${sign}** — daily reading\n\n${response}`);
      } catch (err) {
        console.error('Horoscope command failed:', (err as Error).message);
        await interaction.editReply(`${getZodiacEmoji(sign)} **${sign}**: the stars tried to read your future but fell asleep. that's the reading.`);
      }
      break;
    }

    case 'roastbattle': {
      const opponent = interaction.options.getUser('opponent', true);
      if (opponent.bot) {
        await interaction.reply("i'm not fighting another bot. i have standards. barely, but still.");
        break;
      }
      if (opponent.id === interaction.user.id) {
        await interaction.reply("you wanna roast battle yourself? the self-awareness is refreshing but also sad.");
        break;
      }

      // Create a thread for the battle
      const channel = interaction.channel;
      if (!channel || !('threads' in channel)) {
        await interaction.reply("can't start a battle here. find a text channel.");
        break;
      }
      const thread = await channel.threads.create({
        name: `⚔️ ${interaction.user.displayName} vs ${opponent.displayName}`,
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
        .setTitle('⚔️ ROAST BATTLE CHALLENGE')
        .setDescription(
          `**${interaction.user.displayName}** has challenged **${opponent.displayName}**!\n\n` +
          `Head to ${thread} to watch or participate.`
        );
      await interaction.reply({ embeds: [embed] });

      const rulesEmbed = new EmbedBuilder()
        .setColor(0xFF4D6D)
        .setTitle(`⚔️ ${interaction.user.displayName} vs ${opponent.displayName}`)
        .setDescription(
          `**welcome to the ring.**\n\n` +
          `📋 **Rules:**\n` +
          `• 3 rounds, take turns roasting each other\n` +
          `• i judge each roast 1-10\n` +
          `• highest total score wins\n` +
          `• only the fighters' messages count — spectators can watch\n\n` +
          `${opponent}, type **"accept"** to begin. you have 60 seconds before i call you a coward.`
        )
        .setFooter({ text: 'may the sassiest win' });
      await thread.send({ embeds: [rulesEmbed] });

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
      const beef = await userMemory.getBeef(guildId, user1.id, user2.id);

      if (!beef || beef.incidents === 0) {
        await interaction.reply(`${user1.displayName} and ${user2.displayName} have no beef on record. boring.`);
        break;
      }

      const embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle(`🥩 BEEF REPORT: ${user1.displayName} vs ${user2.displayName}`)
        .addFields(
          { name: 'Incidents', value: `${beef.incidents} recorded disagreements`, inline: true },
          { name: 'Since', value: new Date(beef.firstBeef).toLocaleDateString(), inline: true },
          { name: '\u200b', value: '\u200b', inline: false },
          { name: 'Latest Beef', value: beef.lastTopic ?? 'classified', inline: false },
        )
        .setFooter({ text: 'sass intelligence agency — beef division' });
      await interaction.reply({ embeds: [embed] });
      break;
    }

    case 'maincharacter': {
      const guildId = interaction.guild?.id;
      if (!guildId) {
        await interaction.reply("this only works in a server. try it there.");
        break;
      }
      const mc = await getMainCharacter(guildId);
      if (!mc) {
        await interaction.reply("nobody's earned main character status today. the server is full of NPCs.");
        break;
      }
      const embed = new EmbedBuilder()
        .setColor(0xFFD700)
        .setTitle('👑 TODAY\'S MAIN CHARACTER')
        .setDescription(`**${mc.name}** is the main character today.\n\neveryone else is a supporting role at best. extras at worst.`)
        .setFooter({ text: 'selected based on who\'s been the most unhinged today' });
      await interaction.reply({ embeds: [embed] });
      break;
    }

    case 'wrapped': {
      if (hasUsedToday(guildId, interaction.user.id, 'wrapped')) {
        await interaction.reply("you already got today's recap. it hasn't gotten any less embarrassing.");
        break;
      }
      await interaction.deferReply();
      const stats = await userMemory.getServerStats(guildId);
      if (!stats || stats.totalMessages === 0) {
        await interaction.editReply("not enough data yet. talk more so i have material to work with.");
        break;
      }

      try {
        const statsText = Object.entries(stats.users)
          .map(([, data]) => `${data.name}: ${data.messageCount} messages, roasted ${data.timesRoasted ?? 0} times`)
          .join('\n');

        const commentary = await queryAI(
          `Here are the server stats:\n${statsText}\n\nWrite a sassy "server wrapped" roast recap. Roast the most active user, the least active, the most roasted, etc. 4-5 short bullet points. Be brutal and specific about each person.`,
          { systemPrompt: 'You write server recap roasts. Short bullet points. Lowercase. Use the actual stats to roast people personally. Be specific with numbers.' }
        );

        const embed = new EmbedBuilder()
          .setColor(0xFF4D6D)
          .setTitle('📊 SERVER WRAPPED — ROAST EDITION')
          .setDescription(commentary)
          .addFields(
            { name: '💬 Most Active', value: stats.mostActive ? `**${stats.mostActive.name}** (${stats.mostActive.messageCount} msgs)` : 'nobody talks here', inline: true },
            { name: '💀 Most Roasted', value: stats.mostRoasted ? `**${stats.mostRoasted.name}** (${stats.mostRoasted.timesRoasted}x)` : 'nobody roasted yet', inline: true },
          )
          .setFooter({ text: "sass analytics department" })
          .setTimestamp();
        markUsedToday(guildId, interaction.user.id, 'wrapped');
        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        console.error('Wrapped command failed:', (err as Error).message);
        await interaction.editReply("my analytics department is on strike. try again later.");
      }
      break;
    }

    case 'dare': {
      const targetUser = interaction.options.getUser('user', true);
      const dareKey = `${interaction.user.id}:dare`;
      if (hasUsedToday(guildId, interaction.user.id, dareKey)) {
        await interaction.reply({ content: "you already dared someone today. one chaos event per day is enough.", ephemeral: true });
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
        const skulls = '💀'.repeat(difficulty) + '🩶'.repeat(5 - difficulty);

        const embed = new EmbedBuilder()
          .setColor(0xFF4D6D)
          .setTitle(`🎲 DARE — ${targetUser.displayName.toUpperCase()}`)
          .setDescription(dareText)
          .addFields(
            { name: 'Difficulty', value: skulls, inline: true },
          )
          .setFooter({ text: 'sass dares you. do it or be a coward.' });
        markUsedToday(guildId, interaction.user.id, dareKey);
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
        await interaction.reply({ content: "you can't confess to yourself. that's just thinking.", ephemeral: true });
        break;
      }
      if (targetUser.bot) {
        await interaction.reply({ content: "confessing to a bot? down bad doesn't even begin to cover it.", ephemeral: true });
        break;
      }
      if (hasUsedToday(guildId, interaction.user.id, 'confess')) {
        await interaction.reply({ content: "one confession per day. you're not a priest.", ephemeral: true });
        break;
      }

      // Ephemeral ack to confessor
      await interaction.reply({ content: "got it. your secret's safe with me... for now 👀", ephemeral: true });

      try {
        const commentary = await queryAI(
          `Someone anonymously confessed "${confession}" to ${targetUser.displayName}. React in ONE short sentence (under 12 words). Roast the confessor for being too scared to say it themselves. No fancy vocabulary.`,
          { systemPrompt: 'You are Sass. One short sentence. Lowercase. Talk like a 20-year-old in a group chat, not a poet. No words like "breathtaking", "celestial", "revelation", "poetic", "devotion".' }
        );
        const channel = interaction.channel;
        if (channel && 'send' in channel) {
          await channel.send(`📩 **ANONYMOUS CONFESSION** for <@${targetUser.id}>:\n\n> *"${confession}"*\n\n${commentary ?? "someone couldn't find the guts to say this themselves. shocking."}`);
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
        await interaction.reply(`you already got ${targetUser.id === interaction.user.id ? 'your' : 'their'} prediction today. the future hasn't changed in the last 5 minutes.`);
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
          `Predict ${targetUser.displayName}'s future based on their Discord data. Be specific to THEIR data, not generic.\n\n${dataPrompt}\n\nFormat:\n🔮 PAST: [one sentence]\n📍 PRESENT: [one sentence]\n🌟 FUTURE: [one specific, funny prediction]\n🍀 lucky item: [something insulting based on their behavior]`,
          { systemPrompt: 'You are a sassy fortune teller. Use the provided Discord data to make specific predictions. Lowercase. Short sentences. Mystical but devastating. Never repeat the same prediction twice — each one must be unique to the user.', maxTokens: 200 }
        );
        if (!response) throw new Error('Empty response from AI');
        markUsedToday(guildId, interaction.user.id, targetKey);
        const embed = new EmbedBuilder()
          .setColor(0x9B59B6)
          .setTitle(`🔮 PREDICTION — ${targetUser.displayName.toUpperCase()}`)
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
      await interaction.reply("i don't know that command. impressive, you broke something that simple.");
  }
}

// --- Zodiac emoji helper ---
function getZodiacEmoji(sign: string): string {
  const emojis: Record<string, string> = {
    aries: '♈', taurus: '♉', gemini: '♊', cancer: '♋', leo: '♌', virgo: '♍',
    libra: '♎', scorpio: '♏', sagittarius: '♐', capricorn: '♑', aquarius: '♒', pisces: '♓',
  };
  return emojis[sign] ?? '⭐';
}
