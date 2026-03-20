import { getAutoSassDecision, getReactionDecision } from '../ai.js';
import { messageBuffer } from '../messageBuffer.js';
import { userMemory } from '../userMemory.js';
import { isOnAutoSassCooldown, setAutoSassCooldown } from '../cooldown.js';

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
  } catch (err) {
    // Auto-sass failures are silent — she just stays quiet
    console.error('Auto-sass failed:', err.message);
  }
}
