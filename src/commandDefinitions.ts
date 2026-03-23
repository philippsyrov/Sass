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
    .setName('bestof')
    .setDescription('Sass\'s greatest hits — ranked by your reactions'),

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
    .setName('confess')
    .setDescription('Send an anonymous confession to someone')
    .addUserOption((opt) => opt.setName('user').setDescription('Who to confess to').setRequired(true))
    .addStringOption((opt) => opt.setName('confession').setDescription('Your anonymous confession').setRequired(true)),

  new SlashCommandBuilder()
    .setName('predict')
    .setDescription('Predict someone\'s future based on their Discord behavior')
    .addUserOption((opt) => opt.setName('user').setDescription('Whose future to predict (defaults to you)').setRequired(false)),
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
