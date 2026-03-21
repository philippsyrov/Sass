import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type ChatInputCommandInteraction,
  type Presence,
  type Message,
  type ThreadChannel,
} from 'discord.js';
import { queryAI } from './ai.js';
import { userMemory } from './userMemory.js';
import { buildHelpPages } from './helpPages.js';
import { logCommand, logInteraction } from './database.js';
import { mood } from './mood.js';
import type { BattleState, MainCharacter } from './types.js';

// --- Daily rate limiting ---
const dailyUsage = new Map<string, string>(); // key: "userId:command", value: date string
const MAX_DAILY_TRACKED = 5000;

function hasUsedToday(userId: string, command: string): boolean {
  const key = `${userId}:${command}`;
  const today = new Date().toDateString();
  return dailyUsage.get(key) === today;
}

function markUsedToday(userId: string, command: string): void {
  const key = `${userId}:${command}`;
  dailyUsage.set(key, new Date().toDateString());
  if (dailyUsage.size > MAX_DAILY_TRACKED) {
    const oldest = dailyUsage.keys().next().value;
    if (oldest) dailyUsage.delete(oldest);
  }
}

// Clean up stale daily entries every hour
setInterval(() => {
  const today = new Date().toDateString();
  for (const [key, date] of dailyUsage) {
    if (date !== today) dailyUsage.delete(key);
  }
}, 60 * 60 * 1000);

// --- Activity description helper ---
export function getActivityDescription(presence: Presence | null): string | null {
  if (!presence?.activities || presence.activities.length === 0) return null;

  const parts: string[] = [];
  for (const activity of presence.activities) {
    // ActivityType: 0=Playing, 1=Streaming, 2=Listening, 3=Watching, 4=Custom, 5=Competing
    switch (activity.type) {
      case 0: { // Playing
        let desc = `playing ${activity.name}`;
        if (activity.details) desc += ` — ${activity.details}`;
        if (activity.state) desc += ` (${activity.state})`;
        if (activity.timestamps?.start) {
          const elapsed = Math.floor((Date.now() - activity.timestamps.start.getTime()) / 60000);
          if (elapsed >= 60) desc += ` for ${Math.floor(elapsed / 60)}h ${elapsed % 60}m`;
          else if (elapsed > 0) desc += ` for ${elapsed}m`;
        }
        parts.push(desc);
        break;
      }
      case 1: parts.push(`streaming ${activity.name}${activity.url ? ` on ${activity.url}` : ''}`); break;
      case 2: parts.push(`listening to ${activity.details ?? activity.name}${activity.state ? ` by ${activity.state}` : ''}`); break;
      case 3: parts.push(`watching ${activity.name}`); break;
      case 4: if (activity.state) parts.push(`custom status: "${activity.state}"`); break;
      case 5: parts.push(`competing in ${activity.name}`); break;
    }
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

// --- Main Character tracking ---
const mainCharacters = new Map<string, MainCharacter>(); // guildId -> { name, date }

export function getMainCharacter(guildId: string): MainCharacter | null {
  const mc = mainCharacters.get(guildId);
  const today = new Date().toDateString();
  if (mc && mc.date === today) return mc;

  // Pick new main character — most active user today (from memory)
  const stats = userMemory.getServerStats();
  if (!stats?.mostActive) return null;
  const newMc: MainCharacter = { name: stats.mostActive.name, date: today };
  mainCharacters.set(guildId, newMc);
  return newMc;
}

// --- Command definitions ---

export const commands = [
  new SlashCommandBuilder()
    .setName('8ball')
    .setDescription('Ask the magic 8 ball a question (with sass)')
    .addStringOption((opt) => opt.setName('question').setDescription('Your question').setRequired(true)),

  new SlashCommandBuilder()
    .setName('ship')
    .setDescription('Test compatibility between two users')
    .addUserOption((opt) => opt.setName('user1').setDescription('First person').setRequired(true))
    .addUserOption((opt) => opt.setName('user2').setDescription('Second person').setRequired(true)),

  new SlashCommandBuilder()
    .setName('hottake')
    .setDescription('Generate a controversial hot take')
    .addStringOption((opt) => opt.setName('topic').setDescription('Optional topic').setRequired(false)),

  new SlashCommandBuilder()
    .setName('fortune')
    .setDescription('Get a fortune cookie message (but unhinged)'),

  new SlashCommandBuilder()
    .setName('quote')
    .setDescription('Get a fake inspirational quote'),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription("Roast someone's Discord status")
    .addUserOption((opt) => opt.setName('user').setDescription('Who to roast').setRequired(true)),

  new SlashCommandBuilder()
    .setName('favorite')
    .setDescription('Check who is the current favorite user'),

  new SlashCommandBuilder()
    .setName('npc')
    .setDescription('Generate NPC dialogue for a user')
    .addUserOption((opt) => opt.setName('user').setDescription('Who to NPC-ify').setRequired(true)),

  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check if the bot is alive and responding'),

  new SlashCommandBuilder()
    .setName('sass')
    .setDescription('Get a sassy response from the bot')
    .addStringOption((opt) => opt.setName('message').setDescription('What to say to Sass').setRequired(true)),

  new SlashCommandBuilder()
    .setName('halloffame')
    .setDescription('The wildest things people have said in this server'),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show help information about SassyBot'),

  new SlashCommandBuilder()
    .setName('conspiracy')
    .setDescription('Generate an absurd conspiracy theory about someone')
    .addUserOption((opt) => opt.setName('user').setDescription('The suspect').setRequired(true)),

  new SlashCommandBuilder()
    .setName('compliment')
    .setDescription('Give someone a backhanded compliment')
    .addUserOption((opt) => opt.setName('user').setDescription('The lucky recipient').setRequired(true)),

  new SlashCommandBuilder()
    .setName('roastas')
    .setDescription('Roast someone as a specific persona')
    .addUserOption((opt) => opt.setName('user').setDescription('Who to roast').setRequired(true))
    .addStringOption((opt) => opt.setName('persona').setDescription('Who to roast as').setRequired(true)
      .addChoices(
        { name: 'Gordon Ramsay', value: 'gordon-ramsay' },
        { name: 'Shakespeare', value: 'shakespeare' },
        { name: 'Disappointed Mom', value: 'disappointed-mom' },
        { name: 'Drill Sergeant', value: 'drill-sergeant' },
        { name: 'Therapist', value: 'therapist' },
        { name: 'David Attenborough', value: 'david-attenborough' },
        { name: 'Anime Villain', value: 'anime-villain' },
        { name: 'Passive-Aggressive Coworker', value: 'passive-aggressive-coworker' },
      )),

  new SlashCommandBuilder()
    .setName('translate')
    .setDescription('Translate a message into a different vibe')
    .addStringOption((opt) => opt.setName('message').setDescription('The message to translate').setRequired(true))
    .addStringOption((opt) => opt.setName('style').setDescription('Translation style').setRequired(true)
      .addChoices(
        { name: 'Corporate Email', value: 'corporate' },
        { name: 'Gen Z Brainrot', value: 'genz' },
        { name: 'Shakespeare', value: 'shakespeare' },
        { name: 'Passive-Aggressive', value: 'passive-aggressive' },
        { name: 'Overenthusiastic Influencer', value: 'influencer' },
        { name: 'Caveman', value: 'caveman' },
        { name: 'Noir Detective', value: 'noir' },
        { name: 'Pirate', value: 'pirate' },
      )),

  new SlashCommandBuilder()
    .setName('horoscope')
    .setDescription('Get your sassy daily horoscope')
    .addStringOption((opt) => opt.setName('sign').setDescription('Your zodiac sign').setRequired(true)
      .addChoices(
        { name: 'Aries', value: 'aries' }, { name: 'Taurus', value: 'taurus' },
        { name: 'Gemini', value: 'gemini' }, { name: 'Cancer', value: 'cancer' },
        { name: 'Leo', value: 'leo' }, { name: 'Virgo', value: 'virgo' },
        { name: 'Libra', value: 'libra' }, { name: 'Scorpio', value: 'scorpio' },
        { name: 'Sagittarius', value: 'sagittarius' }, { name: 'Capricorn', value: 'capricorn' },
        { name: 'Aquarius', value: 'aquarius' }, { name: 'Pisces', value: 'pisces' },
      )),

  new SlashCommandBuilder()
    .setName('roastbattle')
    .setDescription('Challenge someone to a roast battle')
    .addUserOption((opt) => opt.setName('opponent').setDescription('Who to battle').setRequired(true)),

  new SlashCommandBuilder()
    .setName('beef')
    .setDescription('Check the beef between two users')
    .addUserOption((opt) => opt.setName('user1').setDescription('First person').setRequired(true))
    .addUserOption((opt) => opt.setName('user2').setDescription('Second person').setRequired(true)),

  new SlashCommandBuilder()
    .setName('maincharacter')
    .setDescription('See who the main character of the day is'),

  new SlashCommandBuilder()
    .setName('wrapped')
    .setDescription('Get the server roast recap'),

  new SlashCommandBuilder()
    .setName('dare')
    .setDescription('Dare someone to do something unhinged')
    .addUserOption((opt) => opt.setName('user').setDescription('Who to dare').setRequired(true)),

  new SlashCommandBuilder()
    .setName('tierlist')
    .setDescription('Generate a tier list for any topic')
    .addStringOption((opt) => opt.setName('topic').setDescription('What to rank').setRequired(true))
    .addStringOption((opt) => opt.setName('items').setDescription('Comma-separated items (optional, AI generates if empty)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('confess')
    .setDescription('Send an anonymous confession to someone')
    .addUserOption((opt) => opt.setName('user').setDescription('Who to confess to').setRequired(true))
    .addStringOption((opt) => opt.setName('confession').setDescription('Your anonymous confession').setRequired(true)),

  new SlashCommandBuilder()
    .setName('predict')
    .setDescription('Predict someone\'s future based on their Discord behavior')
    .addUserOption((opt) => opt.setName('user').setDescription('Whose future to predict (defaults to you)').setRequired(false)),
];

// --- 8ball responses ---
const EIGHT_BALL: string[] = [
  "absolutely not lmao",
  "yeah... no",
  "the stars say you're delusional",
  "ask again when you're less annoying",
  "signs point to you being a clown",
  "unfortunately for everyone involved, yes",
  "i'd say yes but i don't wanna give you hope",
  "100% — and that's the problem",
  "my sources say you should sit down",
  "outlook: bleak, just like your chances",
  "hard yes but you didn't hear it from me",
  "the universe says maybe. i say no.",
  "yes, and you should be worried about that",
  "genuinely cannot believe you had to ask",
  "no. next question.",
  "bold of you to think fate cares about you",
];

// --- Fortune cookies ---
const FORTUNES: string[] = [
  "your future holds... disappointment. but you're used to that.",
  "a great opportunity approaches. you will absolutely fumble it.",
  "someone is thinking about you right now. it's not flattering.",
  "today is a good day to reconsider all your life choices.",
  "love is around the corner. it saw you and kept walking.",
  "you will find success. just not in this lifetime.",
  "a stranger will change your life. probably by cutting you off in traffic.",
  "the stars align for you today. too bad you can't read a star chart.",
  "wealth is coming your way. it's a penny on the ground.",
  "trust your instincts. actually, maybe don't.",
];

// --- Quote authors ---
const QUOTE_AUTHORS: string[] = [
  'Sun Tzu', 'Gandhi', 'Einstein', 'Aristotle', 'Confucius',
  'Socrates', 'Shakespeare', 'Plato', 'Lao Tzu', 'Marcus Aurelius',
  'Nikola Tesla', 'Napoleon', 'Cleopatra', 'Genghis Khan',
];

// --- Command handlers ---

// Global slash command rate limit per user
const slashCmdTracker = new Map<string, number[]>();
const SLASH_CMD_LIMIT = 5; // max commands per window
const SLASH_CMD_WINDOW_MS = 3 * 60 * 1000; // 3 minute window
const SLASH_CMD_MAX_TRACKED = 500;

const SLASH_RATE_LIMIT_RESPONSES = [
  "electricity ain't free, chill out with the commands.",
  "i'm not a vending machine, relax.",
  "bro you've used like 5 commands in a row. go outside.",
  "slow down, i'm not getting paid enough for this.",
  "you're speedrunning my patience rn.",
];

function isSlashRateLimited(userId: string): boolean {
  const now = Date.now();
  if (!slashCmdTracker.has(userId)) {
    if (slashCmdTracker.size >= SLASH_CMD_MAX_TRACKED) {
      const oldest = slashCmdTracker.keys().next().value;
      if (oldest !== undefined) slashCmdTracker.delete(oldest);
    }
    slashCmdTracker.set(userId, []);
  }
  const timestamps = slashCmdTracker.get(userId);
  if (!timestamps) return false;

  // Clean old entries
  const recent = timestamps.filter((ts) => now - ts < SLASH_CMD_WINDOW_MS);
  recent.push(now);
  slashCmdTracker.set(userId, recent);

  return recent.length > SLASH_CMD_LIMIT;
}

// Cleanup slash command tracker
setInterval(() => {
  const now = Date.now();
  for (const [id, timestamps] of slashCmdTracker) {
    const recent = timestamps.filter((ts) => now - ts < SLASH_CMD_WINDOW_MS);
    if (recent.length === 0) slashCmdTracker.delete(id);
    else slashCmdTracker.set(id, recent);
  }
}, 5 * 60 * 1000);

export async function handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const { commandName } = interaction;

  // Global slash command rate limit (skip for ping/help)
  if (commandName !== 'ping' && commandName !== 'help') {
    if (isSlashRateLimited(interaction.user.id)) {
      const msg = SLASH_RATE_LIMIT_RESPONSES[Math.floor(Math.random() * SLASH_RATE_LIMIT_RESPONSES.length)] as string;
      await interaction.reply({ content: msg, ephemeral: true });

      // 30% chance to also publicly call them out
      if (Math.random() < 0.30) {
        const channel = interaction.channel;
        if (channel && 'send' in channel) {
          const publicRoasts = [
            `imagine being rate limited by a bot`,
            `someone's really testing my patience today`,
            `<@${interaction.user.id}> got cut off and honestly it's deserved`,
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
      } catch {
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
      } catch {
        await interaction.editReply('> *the only real failure is being too boring to quote*\n> — me, just now');
      }
      break;
    }

    case 'hottake': {
      await interaction.deferReply();
      const topic = interaction.options.getString('topic');
      try {
        const prompt = topic
          ? `Generate a controversial, spicy hot take about "${topic}". Be bold, funny, and a little unhinged. One or two sentences max.`
          : 'Generate a random controversial, spicy hot take about anything. Be bold, funny, and a little unhinged. One or two sentences max.';
        const response = await queryAI(prompt, {
          systemPrompt: 'You generate hot takes. Be controversial but not bigoted. Funny and bold. Lowercase.',
        });
        await interaction.editReply(`🔥 **hot take:**\n${response}`);
      } catch {
        await interaction.editReply("🔥 **hot take:**\nthis command failing is still more interesting than your personality");
      }
      break;
    }

    case 'ship': {
      await interaction.deferReply();
      const user1 = interaction.options.getUser('user1', true);
      const user2 = interaction.options.getUser('user2', true);
      const percent = Math.floor(Math.random() * 101);
      const bar = '❤️'.repeat(Math.round(percent / 10)) + '🖤'.repeat(10 - Math.round(percent / 10));

      try {
        const prompt = `Rate the compatibility between "${user1.displayName}" and "${user2.displayName}" at ${percent}%. Give a one-sentence brutal, funny verdict. Be creative — if it's low, roast them. If it's high, make it backhanded.`;
        const verdict = await queryAI(prompt, {
          systemPrompt: 'You are Sass, a sassy Discord bot. One sentence only. Lowercase. Brutal and funny.',
        });

        const shipName = user1.displayName.slice(0, Math.ceil(user1.displayName.length / 2)) +
          user2.displayName.slice(Math.floor(user2.displayName.length / 2));

        await interaction.editReply(
          `💘 **${user1.displayName}** x **${user2.displayName}**\n` +
          `ship name: **${shipName}**\n` +
          `${bar} **${percent}%**\n\n` +
          `*${verdict}*`
        );
      } catch {
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
          `Roast this person's Discord activity. Their name is "${targetUser.displayName}" and they are: ${activityInfo}. Be specific about the activity. One or two brutal sentences.`,
          { systemPrompt: 'You are Sass, a sassy Discord bot. Roast their activity/status. Lowercase. Brutal and funny. Reference the specific game/app/activity.' }
        );
        await interaction.editReply(`**${targetUser.displayName}**: *${activityInfo}*\n\n${response}`);
      } catch {
        await interaction.editReply("couldn't read their status. they're probably hiding from me. smart.");
      }
      break;
    }

    case 'favorite': {
      const board = userMemory.getLeaderboard(1);
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
      } catch {
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
      const quotes = userMemory.getWildQuotes(10);
      if (quotes.length === 0) {
        await interaction.reply("nobody's said anything wild enough yet. disappointing but not surprising.");
        break;
      }
      const lines = quotes.map((q, i) => `**${i + 1}.** "${q.quote}" — *${q.name}*`);
      await interaction.reply(`🏆 **hall of fame — wildest things said here**\n\n${lines.join('\n')}`);
      break;
    }

    case 'sass': {
      await interaction.deferReply();
      const msg = interaction.options.getString('message') ?? '';
      try {
        const response = await queryAI(`${interaction.user.displayName} says: ${msg}`);
        await interaction.editReply(response ?? "my brain broke. congrats, you're that boring.");
      } catch {
        await interaction.editReply("my brain broke. congrats, you're that boring.");
      }
      break;
    }

    case 'conspiracy': {
      await interaction.deferReply();
      const targetUser = interaction.options.getUser('user', true);
      try {
        const response = await queryAI(
          `Create an absurd, funny conspiracy theory about a Discord user named "${targetUser.displayName}". Use their name specifically. Make references to Discord (channels, servers, being online at weird hours). 2-3 sentences. It should sound like a deranged detective presenting evidence.`,
          { systemPrompt: 'You generate absurd conspiracy theories about people. Be creative and unhinged but not mean-spirited. Lowercase. Include fake "evidence" like timestamps and suspicious behavior.' }
        );
        await interaction.editReply(`🕵️ **CLASSIFIED INTEL ON ${targetUser.displayName.toUpperCase()}**\n\n${response}`);
      } catch {
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
      } catch {
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
      } catch {
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
      } catch {
        await interaction.editReply("translation failed. some things are beyond even my abilities.");
      }
      break;
    }

    case 'horoscope': {
      if (hasUsedToday(interaction.user.id, 'horoscope')) {
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
        markUsedToday(interaction.user.id, 'horoscope');
        await interaction.editReply(`${getZodiacEmoji(sign)} **${sign}** — daily reading\n\n${response}`);
      } catch {
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
      const beef = userMemory.getBeef(user1.id, user2.id);

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
      const mc = getMainCharacter(guildId);
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
      if (hasUsedToday(interaction.user.id, 'wrapped')) {
        await interaction.reply("you already got today's recap. it hasn't gotten any less embarrassing.");
        break;
      }
      await interaction.deferReply();
      const stats = userMemory.getServerStats();
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
        markUsedToday(interaction.user.id, 'wrapped');
        await interaction.editReply({ embeds: [embed] });
      } catch {
        await interaction.editReply("my analytics department is on strike. try again later.");
      }
      break;
    }

    case 'dare': {
      await interaction.deferReply();
      const targetUser = interaction.options.getUser('user', true);
      const userContext = userMemory.getContext(targetUser.id);
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
        await interaction.editReply({ embeds: [embed] });
      } catch {
        await interaction.editReply(`i dare ${targetUser.displayName} to do literally anything interesting for once.`);
      }
      break;
    }

    case 'tierlist': {
      await interaction.deferReply();
      const topic = interaction.options.getString('topic') ?? '';
      const itemsRaw = interaction.options.getString('items');
      const itemsPrompt = itemsRaw
        ? `Rank EXACTLY these items: ${itemsRaw}`
        : `Generate 6-8 items for this topic and rank them`;
      try {
        const response = await queryAI(
          `Create a tier list for: "${topic}"\n\n${itemsPrompt}\n\nAssign each item to a tier (S, A, B, C, D, or F) and give a brutal one-liner explanation for each placement. Format EXACTLY like this:\n\nS: [item] — [why]\nA: [item] — [why]\nB: [item] — [why]\nC: [item] — [why]\nD: [item] — [why]\nF: [item] — [why]\n\nNot every tier needs entries. Be opinionated and brutal.`,
          { systemPrompt: 'You create tier lists. Be opinionated, funny, and brutal. Lowercase. Your rankings are objectively correct and anyone who disagrees is wrong.' }
        );
        if (!response) throw new Error('Empty response');
        const embed = new EmbedBuilder()
          .setColor(0xFF4D6D)
          .setTitle(`📊 TIER LIST — ${topic.toUpperCase()}`)
          .setDescription(response)
          .setFooter({ text: 'my rankings are objectively correct. don\'t @ me.' });
        await interaction.editReply({ embeds: [embed] });
      } catch {
        await interaction.editReply(`i tried to rank "${topic}" but everything was F tier. including this question.`);
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
      if (hasUsedToday(interaction.user.id, 'confess')) {
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
          markUsedToday(interaction.user.id, 'confess');
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
            mood: mood.getStatus().mood,
            moodIntensity: mood.getStatus().intensity,
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
      if (hasUsedToday(interaction.user.id, targetKey)) {
        await interaction.reply(`you already got ${targetUser.id === interaction.user.id ? 'your' : 'their'} prediction today. the future hasn't changed in the last 5 minutes.`);
        break;
      }
      await interaction.deferReply();

      const userData = userMemory.getContext(targetUser.id);
      const facts = userMemory.getFacts(targetUser.id);
      const user = (userMemory as unknown as { users: Record<string, { messageCount?: number; timesRoasted?: number }> }).users[targetUser.id];
      const messageCount = user?.messageCount ?? 0;
      const timesRoasted = user?.timesRoasted ?? 0;

      const dataPrompt = [
        `User: ${targetUser.displayName}`,
        messageCount > 0 ? `Messages sent: ${messageCount}` : null,
        timesRoasted > 0 ? `Times roasted: ${timesRoasted}` : null,
        facts.length > 0 ? `Known facts: ${facts.join('; ')}` : null,
        userData ? `Context: ${userData}` : null,
      ].filter(Boolean).join('\n');

      try {
        const response = await queryAI(
          `You are a fortune teller who's been stalking someone's Discord. Based on this data, predict their future.\n\n${dataPrompt}\n\nFormat your response EXACTLY like this:\n🔮 PAST: [one sentence about what you know about their history]\n📍 PRESENT: [one sentence about their current vibe]\n🌟 FUTURE: [one sentence prediction, be specific and funny]\n\n🍀 lucky item: [something insulting based on their behavior]`,
          { systemPrompt: 'You are a sassy fortune teller who uses Discord behavior data to make predictions. Be specific to the user data provided. Lowercase. Mystical but devastating.' }
        );
        if (!response) throw new Error('Empty response');
        markUsedToday(interaction.user.id, targetKey);
        const embed = new EmbedBuilder()
          .setColor(0x9B59B6)
          .setTitle(`🔮 PREDICTION — ${targetUser.displayName.toUpperCase()}`)
          .setDescription(response)
          .setFooter({ text: 'sass sees all. sass knows all. sass judges all.' })
          .setTimestamp();
        await interaction.editReply({ embeds: [embed] });
      } catch {
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

// --- Roast Battle State ---
export const activeBattles = new Map<string, BattleState>();
const BATTLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 min max per battle

// Clean up abandoned battles every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, battle] of activeBattles) {
    if (now - (battle.startedAt ?? 0) > BATTLE_TIMEOUT_MS) {
      activeBattles.delete(id);
    }
  }
}, 5 * 60 * 1000);

export async function handleBattleMessage(message: Message): Promise<boolean> {
  // Only handle messages in threads that are active battles
  const battle = activeBattles.get(message.channel.id);
  if (!battle) return false;
  const threadChannel = message.channel as ThreadChannel;

  // Ignore messages from non-participants
  if (message.author.id !== battle.challenger.id && message.author.id !== battle.opponent.id) return false;

  // Check if someone is accepting a battle
  if (message.content.toLowerCase() === 'accept' && battle.phase === 'waiting' && message.author.id === battle.opponent.id) {
    if (battle.timeout) clearTimeout(battle.timeout);
    battle.phase = 'active';
    battle.round = 1;
    battle.currentTurn = battle.challenger.id;

    const roundEmbed = new EmbedBuilder()
      .setColor(0xFF4D6D)
      .setTitle('⚔️ ROUND 1/3')
      .setDescription(`**${battle.challenger.displayName}**, you challenged — you go first.\n\ndrop your best roast.`);
    await threadChannel.send({ embeds: [roundEmbed] });
    return true;
  }

  // Check if this is a roast in an active battle
  if (battle.phase === 'active' && message.author.id === battle.currentTurn) {
    const battleId = message.channel.id;
    try {
      const scoreResponse = await queryAI(
        `You are judging a roast battle. Score this roast from 1-10 and give a one-sentence reaction.\n\nRoast: "${message.content}"\n\nRespond in EXACTLY this format:\nSCORE:N\nREACTION:your reaction`,
        { systemPrompt: 'You judge roast battles. Be fair but entertaining. Score genuinely — a weak roast gets a 3-4, a decent one 5-7, a banger 8-10. One sentence reaction.' }
      );

      const scoreLine = scoreResponse?.match(/SCORE:(\d+)/);
      const reactionLine = scoreResponse?.match(/REACTION:(.+)/);
      const score = scoreLine?.[1] ? Math.min(10, Math.max(1, parseInt(scoreLine[1], 10))) : 5;
      const reaction = reactionLine?.[1] ? reactionLine[1].trim() : "interesting.";

      const authorScores = battle.scores[message.author.id];
      if (authorScores) authorScores.push(score);

      const scoreBar = '🔥'.repeat(score) + '💨'.repeat(10 - score);
      await message.reply(`${scoreBar} **${score}/10**\n*${reaction}*`);

      // Switch turns or advance round
      const otherId = message.author.id === battle.challenger.id ? battle.opponent.id : battle.challenger.id;
      const otherName = message.author.id === battle.challenger.id ? battle.opponent.displayName : battle.challenger.displayName;

      const otherScores = battle.scores[otherId];
      if (otherScores && otherScores.length < battle.round) {
        battle.currentTurn = otherId;
        await threadChannel.send(`**${otherName}**, your turn. fire back.`);
      } else {
        battle.round++;
        if (battle.round > battle.maxRounds) {
          const challengerScores = battle.scores[battle.challenger.id] ?? [];
          const opponentScores = battle.scores[battle.opponent.id] ?? [];
          const score1 = challengerScores.reduce((a, b) => a + b, 0);
          const score2 = opponentScores.reduce((a, b) => a + b, 0);
          const winner = score1 > score2 ? battle.challenger : score2 > score1 ? battle.opponent : null;
          const loser = winner ? (winner.id === battle.challenger.id ? battle.opponent : battle.challenger) : null;

          const embed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle('⚔️ ROAST BATTLE — FINAL RESULTS')
            .addFields(
              { name: battle.challenger.displayName, value: `${challengerScores.join(' + ')} = **${score1}**`, inline: true },
              { name: 'vs', value: '⚔️', inline: true },
              { name: battle.opponent.displayName, value: `${opponentScores.join(' + ')} = **${score2}**`, inline: true },
              { name: '\u200b', value: '\u200b', inline: false },
              { name: '🏆 Winner', value: winner ? `**${winner.displayName}** absolutely cooked.` : "it's a tie. you're both equally mid.", inline: false },
            )
            .setFooter({ text: loser ? `${loser.displayName} needs to sit down for a while` : 'nobody won. everybody lost.' });

          await threadChannel.send({ embeds: [embed] });
          activeBattles.delete(battleId);
          // Archive thread after 10 seconds
          setTimeout(() => threadChannel.setArchived(true).catch((err) => console.error('Failed to archive battle thread:', err.message)), 10000);
        } else {
          const roundEmbed = new EmbedBuilder()
            .setColor(0xFF4D6D)
            .setTitle(`⚔️ ROUND ${battle.round}/${battle.maxRounds}`)
            .setDescription(`**${battle.challenger.displayName}**, you're up.`);
          battle.currentTurn = battle.challenger.id;
          await threadChannel.send({ embeds: [roundEmbed] });
        }
      }
    } catch {
      await message.reply("my judging brain broke. i'll give that a 5 out of mercy.");
      const authorScores = battle.scores[message.author.id];
      if (authorScores) authorScores.push(5);
    }
    return true;
  }

  return false;
}
