import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { queryAI } from './ai.js';
import { userMemory } from './userMemory.js';

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
];

// --- 8ball responses ---
const EIGHT_BALL = [
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
const FORTUNES = [
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
const QUOTE_AUTHORS = [
  'Sun Tzu', 'Gandhi', 'Einstein', 'Aristotle', 'Confucius',
  'Socrates', 'Shakespeare', 'Plato', 'Lao Tzu', 'Marcus Aurelius',
  'Nikola Tesla', 'Napoleon', 'Cleopatra', 'Genghis Khan',
];

// --- Command handlers ---

export async function handleCommand(interaction) {
  const { commandName } = interaction;

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
      const botAvatar = interaction.client.user.displayAvatarURL({ size: 256 });
      const embed = new EmbedBuilder()
        .setColor(0xFF4D6D)
        .setAuthor({ name: 'Sass', iconURL: botAvatar })
        .setThumbnail(botAvatar)
        .setDescription("here's everything i can do. use it wisely (you won't).")
        .addFields(
          { name: '💬 Chat', value: '`@Sass <anything>` — talk to me\n`/sass <message>` — same but fancier', inline: true },
          { name: '🧠 Memory', value: '`@Sass remember <fact>` — weaponize yourself\n`@Sass remember @user <fact>` — snitch', inline: true },
          { name: '\u200b', value: '\u200b', inline: false },
          { name: '📊 Stats', value: '`@Sass leaderboard` — wall of shame\n`@Sass profile [@user]` — diagnosis\n`/favorite` — punching bag\n`/halloffame` — wildest quotes', inline: true },
          { name: '🎲 Fun', value: '`/8ball` · `/ship` · `/hottake`\n`/fortune` · `/quote` · `/npc`\n`/status @user` — roast their status', inline: true },
          { name: '\u200b', value: '\u200b', inline: false },
          { name: '⚠️ Fine Print', value: 'i jump into convos uninvited. tell me to stop and i\'ll ghost you until you beg.', inline: false },
        )
        .setFooter({ text: "i'm not a helper bot. i'm a problem.", iconURL: botAvatar })
        .setTimestamp();
      await interaction.reply({ embeds: [embed] });
      break;
    }

    case '8ball': {
      await interaction.deferReply();
      const question = interaction.options.getString('question');
      try {
        const answer = await queryAI(
          `Someone asked the magic 8 ball: "${question}". Give a sassy, brutal one-sentence answer that actually addresses their specific question. Be mean about it.`,
          { systemPrompt: 'You are a sassy magic 8 ball. Answer the question directly but make them feel dumb for asking. One short sentence. Lowercase.' }
        );
        await interaction.editReply(`🎱 **${question}**\n${answer}`);
      } catch {
        const answer = EIGHT_BALL[Math.floor(Math.random() * EIGHT_BALL.length)];
        await interaction.editReply(`🎱 **${question}**\n${answer}`);
      }
      break;
    }

    case 'fortune': {
      const fortune = FORTUNES[Math.floor(Math.random() * FORTUNES.length)];
      await interaction.reply(`🥠 ${fortune}`);
      break;
    }

    case 'quote': {
      await interaction.deferReply();
      try {
        const author = QUOTE_AUTHORS[Math.floor(Math.random() * QUOTE_AUTHORS.length)];
        const response = await queryAI(
          `Generate a fake inspirational quote attributed to ${author}. Make it sound profound at first but actually be either absurd, passive-aggressive, or lowkey insulting. One sentence only. Just the quote, no attribution.`,
          { systemPrompt: 'You generate fake quotes. One sentence. No quotation marks. Lowercase.' }
        );
        await interaction.editReply(`> *${response.replace(/"/g, '')}*\n> — ${author} (probably)`);
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
      const user1 = interaction.options.getUser('user1');
      const user2 = interaction.options.getUser('user2');
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
      const targetUser = interaction.options.getUser('user');
      try {
        const member = await interaction.guild.members.fetch(targetUser.id);
        const presence = member.presence;
        const status = presence?.activities?.[0]?.state || presence?.activities?.[0]?.name || null;
        const onlineStatus = presence?.status || 'offline';

        if (!status && onlineStatus === 'offline') {
          await interaction.editReply(`${targetUser.displayName} is offline. probably for the best.`);
          break;
        }

        if (!status) {
          await interaction.editReply(`${targetUser.displayName} doesn't have a status. the void speaks louder.`);
          break;
        }

        const response = await queryAI(
          `Roast this person's Discord status. Their name is "${targetUser.displayName}" and their status says: "${status}". One brutal sentence.`,
          { systemPrompt: 'You are Sass, a sassy Discord bot. Roast their status. One sentence. Lowercase. Brutal.' }
        );
        await interaction.editReply(`**${targetUser.displayName}**'s status: *"${status}"*\n\n${response}`);
      } catch {
        await interaction.editReply("couldn't read their status. they're probably hiding from me. smart.");
      }
      break;
    }

    case 'favorite': {
      const board = userMemory.getLeaderboard(1);
      if (board.length === 0 || board[0].timesRoasted === 0) {
        await interaction.reply("i don't have a favorite yet. nobody's earned it. or deserved it.");
        break;
      }
      const fav = board[0];
      const responses = [
        `my current favorite punching bag is **${fav.name}** with ${fav.timesRoasted} roasts. they keep coming back for more.`,
        `**${fav.name}**. ${fav.timesRoasted} roasts and counting. at this point it's a relationship.`,
        `gotta be **${fav.name}**. they've been roasted ${fav.timesRoasted} times and still haven't learned.`,
      ];
      await interaction.reply(responses[Math.floor(Math.random() * responses.length)]);
      break;
    }

    case 'npc': {
      await interaction.deferReply();
      const targetUser = interaction.options.getUser('user');
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
      const msg = interaction.options.getString('message');
      try {
        const response = await queryAI(`${interaction.user.displayName} says: ${msg}`);
        await interaction.editReply(response);
      } catch {
        await interaction.editReply("my brain broke. congrats, you're that boring.");
      }
      break;
    }

    default:
      await interaction.reply("i don't know that command. impressive, you broke something that simple.");
  }
}
