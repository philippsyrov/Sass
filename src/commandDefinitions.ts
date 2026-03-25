import { SlashCommandBuilder } from 'discord.js';

// --- Command definitions ---

export const commands = [
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
    .setName('halloffame')
    .setDescription('The wildest things people have said in this server'),

  new SlashCommandBuilder()
    .setName('bestof')
    .setDescription('Sass\'s greatest hits — ranked by your reactions'),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show help information about SassyBot'),

  new SlashCommandBuilder()
    .setName('compliment')
    .setDescription('Give someone a backhanded compliment')
    .addUserOption((opt) => opt.setName('user').setDescription('The lucky recipient').setRequired(true)),

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
    .setName('profile')
    .setDescription('Behavioral diagnosis — chaos, thirst, aggro, clown, brain')
    .addUserOption((opt) => opt.setName('user').setDescription('Who to analyze (defaults to you)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Wall of shame — most roasted users'),

  new SlashCommandBuilder()
    .setName('forgetme')
    .setDescription('Delete all your data — affinity, facts, memories, beef. Cannot be undone.'),

  new SlashCommandBuilder()
    .setName('conspiracy')
    .setDescription('Generate a conspiracy theory connecting server members')
    .addStringOption((opt) => opt.setName('topic').setDescription('Optional seed topic').setRequired(false)),

];

// --- Fortune cookies ---
export const FORTUNES: string[] = [
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
export const QUOTE_AUTHORS: string[] = [
  'Sun Tzu', 'Gandhi', 'Einstein', 'Aristotle', 'Confucius',
  'Socrates', 'Shakespeare', 'Plato', 'Lao Tzu', 'Marcus Aurelius',
  'Nikola Tesla', 'Napoleon', 'Cleopatra', 'Genghis Khan',
];
