import { getAutoSassDecision, getReactionDecision, queryAI } from '../ai.js';
import { messageBuffer } from '../messageBuffer.js';
import { userMemory } from '../userMemory.js';
import { isOnAutoSassCooldown, setAutoSassCooldown } from '../cooldown.js';
import { getActivityDescription } from '../commands.js';

// Track message count per channel since last auto-sass
const messageCounters = new Map();

const AUTO_SASS_CHANCE = parseFloat(process.env.AUTO_SASS_CHANCE) || 0.4;
const MIN_MESSAGES = parseInt(process.env.AUTO_SASS_MIN_MESSAGES, 10) || 2;

/**
 * Occasionally Sass reads the room and drops an unsolicited remark or reaction.
 *
 * Flow:
 * 1. Count messages per channel since last auto-sass
 * 2. After MIN_MESSAGES, roll the dice
 * 3. 70% chance of text remark, 30% chance of just a reaction emoji
 * 4. AI decides if it's worth commenting on or SKIPs
 */
export async function handleAutoSass(message, _client) {
  // Never auto-sass the creator
  if (message.author.id === process.env.CREATOR_ID) return;

  // Wild quote detection — store the craziest stuff people say
  const text = message.content;
  if (text.length > 10 && text.length < 200) {
    const caps = (text.match(/[A-Z]/g) || []).length;
    const capsRatio = caps / text.length;
    const hasExcitement = /[!?]{2,}|lmao|wtf|bruh|bro what|no way|i can't/i.test(text);
    const isWild = capsRatio > 0.5 || hasExcitement;
    if (isWild) {
      userMemory.addWildQuote(message.author.id, text);
    }
  }

  const channelId = message.channel.id;

  // Increment counter
  const count = (messageCounters.get(channelId) || 0) + 1;
  messageCounters.set(channelId, count);

  // Not enough messages yet
  if (count < MIN_MESSAGES) return;

  // Channel cooldown — don't auto-sass too frequently
  if (isOnAutoSassCooldown(channelId)) return;

  // Roll the dice
  if (Math.random() > AUTO_SASS_CHANCE) return;

  // Reset counter regardless of outcome
  messageCounters.set(channelId, 0);

  // 15% chance to roast someone's gaming activity instead of conversation
  if (Math.random() < 0.15) {
    try {
      const guild = message.guild;
      if (guild) {
        const members = await guild.members.fetch({ withPresences: true });
        const gamers = members.filter((m) => {
          if (m.user.bot || m.user.id === process.env.CREATOR_ID) return false;
          const activity = getActivityDescription(m.presence);
          return activity && !activity.startsWith('custom status');
        });
        if (gamers.size > 0) {
          const target = gamers.random();
          const activity = getActivityDescription(target.presence);
          const roast = await queryAI(
            `You just noticed ${target.displayName} has been ${activity}. Call them out publicly. Be specific about the game/app. One or two sentences. Mock the time spent if applicable.`,
            { systemPrompt: 'You are Sass. You\'re publicly shaming someone for their Discord activity. Lowercase. Funny and brutal. Make it feel like you just caught them.' }
          );
          if (roast && roast.trim().toUpperCase() !== 'SKIP') {
            setAutoSassCooldown(channelId);
            await message.channel.sendTyping();
            const delay = 1000 + Math.random() * 2000;
            await new Promise((resolve) => setTimeout(resolve, delay));
            await message.channel.send(`👀 hey <@${target.user.id}>, ${roast}`);
            userMemory.recordRoast(target.user.id);
            return;
          }
        }
      }
    } catch {
      // Activity roast failed — fall through to normal auto-sass
    }
  }

  const recentMessages = messageBuffer.getRecentRaw(channelId, 8);
  if (!recentMessages || recentMessages.length === 0) return;

  const recentContext = recentMessages.map(
    (msg) => `${msg.author}${msg.isBot ? ' [BOT]' : ''}: ${msg.content}`
  ).join('\n');
  const peopleContext = userMemory.buildPeopleContext(recentMessages);

  try {
    // 30% chance of just a reaction emoji instead of a full response
    if (Math.random() < 0.3) {
      const emoji = await getReactionDecision(recentContext);
      if (emoji) {
        try {
          await message.react(emoji);
          setAutoSassCooldown(channelId);
        } catch {
          // Emoji might not be valid — silently fail
        }
        return;
      }
    }

    const contextWithPeople = peopleContext ? `${peopleContext}\n\n${recentContext}` : recentContext;
    const remark = await getAutoSassDecision(contextWithPeople);

    // AI decided the conversation wasn't worth commenting on
    if (!remark || remark.trim().toUpperCase() === 'SKIP') return;

    setAutoSassCooldown(channelId);
    await message.channel.sendTyping();

    // Random delay (1-3s) so it feels natural
    const delay = 1000 + Math.random() * 2000;
    await new Promise((resolve) => setTimeout(resolve, delay));

    await message.reply(remark);
    userMemory.recordRoast(message.author.id);
  } catch (err) {
    // Auto-sass failures are silent — she just stays quiet
    console.error('Auto-sass failed:', err.message);
  }
}
