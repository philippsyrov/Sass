import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { queryAI } from './ai.js';
import { userMemory } from './userMemory.js';

// --- Main Character tracking ---
const mainCharacters = new Map(); // guildId -> { name, userId, date }

export function getMainCharacter(guildId) {
  const mc = mainCharacters.get(guildId);
  const today = new Date().toDateString();
  if (mc && mc.date === today) return mc;

  // Pick new main character — most active user today (from memory)
  const stats = userMemory.getServerStats();
  if (!stats || !stats.mostActive) return null;
  const newMc = { name: stats.mostActive.name, date: today };
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
          { name: '📊 Stats', value: '`@Sass leaderboard` — wall of shame\n`@Sass profile [@user]` — diagnosis\n`/favorite` · `/halloffame` · `/beef`\n`/maincharacter` · `/wrapped`', inline: true },
          { name: '🎲 Fun', value: '`/8ball` · `/ship` · `/hottake`\n`/fortune` · `/quote` · `/npc`\n`/roastas` · `/translate` · `/horoscope`\n`/conspiracy` · `/compliment`\n`/status @user` — roast their status', inline: true },
          { name: '\u200b', value: '\u200b', inline: false },
          { name: '⚔️ Battle', value: '`/roastbattle @user` — PvP roast battle with AI judging', inline: false },
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

    case 'conspiracy': {
      await interaction.deferReply();
      const targetUser = interaction.options.getUser('user');
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
      const targetUser = interaction.options.getUser('user');
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
      const targetUser = interaction.options.getUser('user');
      const persona = interaction.options.getString('persona');
      const personas = {
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
        const labels = {
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
      const msg = interaction.options.getString('message');
      const style = interaction.options.getString('style');
      const styles = {
        'corporate': 'Rewrite this message as a corporate email. Use "per my last message," "circle back," "synergy," "moving forward," "let\'s take this offline." Sound professional but soulless.',
        'genz': 'Rewrite this message in extreme Gen Z internet slang. Use "no cap," "fr fr," "slay," "its giving," "lowkey," "highkey," "bussin," "ong," "rizz," brainrot language. Excessive abbreviations.',
        'shakespeare': 'Rewrite this message in Shakespearean English. Use "thou," "thy," "hath," "forsooth," "prithee." Make it sound like a dramatic soliloquy.',
        'passive-aggressive': 'Rewrite this message as passive-aggressive as possible. Add "as I mentioned before," "just wanted to follow up," "no worries if not," "just a gentle reminder." Sound polite but absolutely furious underneath.',
        'influencer': 'Rewrite this message as an overenthusiastic Instagram influencer. Use excessive exclamation marks, "OMG," "obsessed," "living my best life," "link in bio energy." Everything is THE BEST THING EVER.',
        'caveman': 'Rewrite this message as a caveman would say it. Simple words only. "Me think," "you no good," "fire hot." Grunt energy. Reference rocks, fire, mammoth.',
        'noir': 'Rewrite this message as a 1940s noir detective narration. Dark, rainy, cynical. "The dame walked in," "this city never sleeps," "I\'d seen it all — or so I thought." Use period-appropriate slang.',
        'pirate': 'Rewrite this message as a pirate. Use "arr," "ye," "matey," "scallywag," "walk the plank," "shiver me timbers." Reference the sea, treasure, and rum.',
      };
      const labels = {
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
      await interaction.deferReply();
      const sign = interaction.options.getString('sign');
      try {
        const response = await queryAI(
          `Give a sassy, backhanded daily horoscope for ${sign}. Start with something that sounds positive, then twist it. Include a "lucky" element that's actually an insult. 2-3 sentences. Format:\n[horoscope text]\n\n🍀 lucky item: [something insulting]`,
          { systemPrompt: 'You write sassy horoscopes. Sound mystical at first, then roast. Lowercase. Include zodiac personality stereotypes as ammunition.' }
        );
        await interaction.editReply(`${getZodiacEmoji(sign)} **${sign}** — daily reading\n\n${response}`);
      } catch {
        await interaction.editReply(`${getZodiacEmoji(sign)} **${sign}**: the stars tried to read your future but fell asleep. that's the reading.`);
      }
      break;
    }

    case 'roastbattle': {
      const opponent = interaction.options.getUser('opponent');
      if (opponent.bot) {
        await interaction.reply("i'm not fighting another bot. i have standards. barely, but still.");
        break;
      }
      if (opponent.id === interaction.user.id) {
        await interaction.reply("you wanna roast battle yourself? the self-awareness is refreshing but also sad.");
        break;
      }

      // Create a thread for the battle
      const thread = await interaction.channel.threads.create({
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
          thread.send(`${opponent.displayName} didn't show up. certified coward. archiving this embarrassment.`).catch(() => {});
          setTimeout(() => thread.setArchived(true).catch(() => {}), 5000);
        }
      }, 60000);
      activeBattles.get(battleId).timeout = timeout;
      break;
    }

    case 'beef': {
      const user1 = interaction.options.getUser('user1');
      const user2 = interaction.options.getUser('user2');
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
          { name: 'Latest Beef', value: beef.lastTopic || 'classified', inline: false },
        )
        .setFooter({ text: 'sass intelligence agency — beef division' });
      await interaction.reply({ embeds: [embed] });
      break;
    }

    case 'maincharacter': {
      const mc = getMainCharacter(interaction.guild.id);
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
      await interaction.deferReply();
      const stats = userMemory.getServerStats();
      if (!stats || stats.totalMessages === 0) {
        await interaction.editReply("not enough data yet. talk more so i have material to work with.");
        break;
      }

      try {
        const statsText = Object.entries(stats.users)
          .map(([, data]) => `${data.name}: ${data.messageCount} messages, roasted ${data.timesRoasted || 0} times`)
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
        await interaction.editReply({ embeds: [embed] });
      } catch {
        await interaction.editReply("my analytics department is on strike. try again later.");
      }
      break;
    }

    default:
      await interaction.reply("i don't know that command. impressive, you broke something that simple.");
  }
}

// --- Zodiac emoji helper ---
function getZodiacEmoji(sign) {
  const emojis = {
    aries: '♈', taurus: '♉', gemini: '♊', cancer: '♋', leo: '♌', virgo: '♍',
    libra: '♎', scorpio: '♏', sagittarius: '♐', capricorn: '♑', aquarius: '♒', pisces: '♓',
  };
  return emojis[sign] || '⭐';
}

// --- Roast Battle State ---
export const activeBattles = new Map();

export async function handleBattleMessage(message) {
  // Only handle messages in threads that are active battles
  const battle = activeBattles.get(message.channel.id);
  if (!battle) return false;

  // Ignore messages from non-participants
  if (message.author.id !== battle.challenger.id && message.author.id !== battle.opponent.id) return false;

  // Check if someone is accepting a battle
  if (message.content.toLowerCase() === 'accept' && battle.phase === 'waiting' && message.author.id === battle.opponent.id) {
    clearTimeout(battle.timeout);
    battle.phase = 'active';
    battle.round = 1;
    battle.currentTurn = battle.challenger.id;

    const roundEmbed = new EmbedBuilder()
      .setColor(0xFF4D6D)
      .setTitle('⚔️ ROUND 1/3')
      .setDescription(`**${battle.challenger.displayName}**, you challenged — you go first.\n\ndrop your best roast.`);
    await message.channel.send({ embeds: [roundEmbed] });
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

      const scoreLine = scoreResponse.match(/SCORE:(\d+)/);
      const reactionLine = scoreResponse.match(/REACTION:(.+)/);
      const score = scoreLine ? Math.min(10, Math.max(1, parseInt(scoreLine[1], 10))) : 5;
      const reaction = reactionLine ? reactionLine[1].trim() : "interesting.";

      battle.scores[message.author.id].push(score);

      const scoreBar = '🔥'.repeat(score) + '💨'.repeat(10 - score);
      await message.reply(`${scoreBar} **${score}/10**\n*${reaction}*`);

      // Switch turns or advance round
      const otherId = message.author.id === battle.challenger.id ? battle.opponent.id : battle.challenger.id;
      const otherName = message.author.id === battle.challenger.id ? battle.opponent.displayName : battle.challenger.displayName;

      if (battle.scores[otherId].length < battle.round) {
        battle.currentTurn = otherId;
        await message.channel.send(`**${otherName}**, your turn. fire back.`);
      } else {
        battle.round++;
        if (battle.round > battle.maxRounds) {
          const score1 = battle.scores[battle.challenger.id].reduce((a, b) => a + b, 0);
          const score2 = battle.scores[battle.opponent.id].reduce((a, b) => a + b, 0);
          const winner = score1 > score2 ? battle.challenger : score2 > score1 ? battle.opponent : null;
          const loser = winner ? (winner.id === battle.challenger.id ? battle.opponent : battle.challenger) : null;

          const embed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle('⚔️ ROAST BATTLE — FINAL RESULTS')
            .addFields(
              { name: battle.challenger.displayName, value: `${battle.scores[battle.challenger.id].join(' + ')} = **${score1}**`, inline: true },
              { name: 'vs', value: '⚔️', inline: true },
              { name: battle.opponent.displayName, value: `${battle.scores[battle.opponent.id].join(' + ')} = **${score2}**`, inline: true },
              { name: '\u200b', value: '\u200b', inline: false },
              { name: '🏆 Winner', value: winner ? `**${winner.displayName}** absolutely cooked.` : "it's a tie. you're both equally mid.", inline: false },
            )
            .setFooter({ text: loser ? `${loser.displayName} needs to sit down for a while` : 'nobody won. everybody lost.' });

          await message.channel.send({ embeds: [embed] });
          activeBattles.delete(battleId);
          // Archive thread after 10 seconds
          setTimeout(() => message.channel.setArchived(true).catch(() => {}), 10000);
        } else {
          const roundEmbed = new EmbedBuilder()
            .setColor(0xFF4D6D)
            .setTitle(`⚔️ ROUND ${battle.round}/${battle.maxRounds}`)
            .setDescription(`**${battle.challenger.displayName}**, you're up.`);
          battle.currentTurn = battle.challenger.id;
          await message.channel.send({ embeds: [roundEmbed] });
        }
      }
    } catch {
      await message.reply("my judging brain broke. i'll give that a 5 out of mercy.");
      battle.scores[message.author.id].push(5);
    }
    return true;
  }

  return false;
}
