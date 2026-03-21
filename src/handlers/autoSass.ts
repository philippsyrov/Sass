import {
  type Message,
  type Client,
  type GuildMember,
  type TextChannel,
} from 'discord.js';
import { getAutoSassDecision, getReactionDecision, queryAI } from '../ai.js';
import { messageBuffer } from '../messageBuffer.js';
import { userMemory } from '../userMemory.js';
import { isOnAutoSassCooldown, setAutoSassCooldown } from '../cooldown.js';
import { getActivityDescription } from '../commands.js';
import { mood } from '../mood.js';
import { logInteraction } from '../database.js';

// Track message count per channel since last auto-sass
const messageCounters = new Map<string, number>();
const MAX_TRACKED_CHANNELS = 500;

const AUTO_SASS_CHANCE = parseFloat(process.env.AUTO_SASS_CHANCE ?? '0.4') || 0.4;
const MIN_MESSAGES = parseInt(process.env.AUTO_SASS_MIN_MESSAGES ?? '2', 10) || 2;

/**
 * Occasionally Sass reads the room and drops an unsolicited remark or reaction.
 *
 * Flow:
 * 1. Count messages per channel since last auto-sass
 * 2. After MIN_MESSAGES, roll the dice
 * 3. 70% chance of text remark, 30% chance of just a reaction emoji
 * 4. AI decides if it's worth commenting on or SKIPs
 */
export async function handleAutoSass(message: Message, _client: Client): Promise<void> {
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
      mood.shift('chaos');
    }
  }

  // Vibe detection — shift mood based on chat energy
  const lowerText = text.toLowerCase();
  const fightPatterns = /\b(stfu|fight me|you'?re wrong|shut up|no one asked|cope|L take|ratio)\b/i;
  const wholesomePatterns = /\b(love you|you'?re (amazing|the best|awesome)|thank you|ily|<3|❤️|😊|🥰)\b/i;

  if (fightPatterns.test(lowerText)) {
    mood.shift('fighting');
  } else if (wholesomePatterns.test(lowerText)) {
    mood.shift('nice_to_each_other');
  }

  // Cast channel — this handler only runs in guild text channels
  const channel = message.channel as TextChannel;
  const channelId = channel.id;

  // Increment counter (cap tracked channels to prevent memory leak)
  const count = (messageCounters.get(channelId) || 0) + 1;
  messageCounters.set(channelId, count);
  if (messageCounters.size > MAX_TRACKED_CHANNELS) {
    // Remove oldest entries (first inserted)
    const toDelete = messageCounters.size - MAX_TRACKED_CHANNELS;
    let deleted = 0;
    for (const key of messageCounters.keys()) {
      if (deleted >= toDelete) break;
      messageCounters.delete(key);
      deleted++;
    }
  }

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
        const gamers = members.filter((m: GuildMember) => {
          if (m.user.bot || m.user.id === process.env.CREATOR_ID) return false;
          const activity = getActivityDescription(m.presence);
          return activity != null && !activity.startsWith('custom status');
        });
        if (gamers.size > 0) {
          const target = gamers.random();
          if (!target) return;
          const activity = getActivityDescription(target.presence);
          if (!activity) return;
          const roast = await queryAI(
            `You just noticed ${target.displayName} has been ${activity}. Call them out publicly. Be specific about the game/app. One or two sentences. Mock the time spent if applicable.`,
            { systemPrompt: 'You are Sass. You\'re publicly shaming someone for their Discord activity. Lowercase. Funny and brutal. Make it feel like you just caught them.' }
          );
          if (roast && roast.trim().toUpperCase() !== 'SKIP') {
            setAutoSassCooldown(channelId);
            await channel.sendTyping();
            const delay = 1000 + Math.random() * 2000;
            await new Promise((resolve) => setTimeout(resolve, delay));
            const activityRoastMsg = `👀 hey <@${target.user.id}>, ${roast}`;
            await channel.send(activityRoastMsg);
            userMemory.recordRoast(target.user.id);
            const moodInfo = mood.getStatus();
            logInteraction({
              serverId: message.guild?.id, serverName: message.guild?.name,
              channelId: channel.id, channelName: channel.name,
              userId: target.user.id, username: target.displayName,
              triggerType: 'auto-sass-activity', commandName: null,
              userMessage: activity, sassResponse: roast,
              mood: moodInfo.mood, moodIntensity: moodInfo.intensity,
            }).catch((err) => console.error('DB log failed:', (err as Error).message));
            return;
          }
        }
      }
    } catch (err) {
      // Activity roast failed — fall through to normal auto-sass
      console.error('Activity roast failed:', (err as Error).message);
    }
  }

  const recentMessages = messageBuffer.getRecentRaw(channelId, 15);
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
    await channel.sendTyping();

    // Random delay (1-3s) so it feels natural
    const delay = 1000 + Math.random() * 2000;
    await new Promise((resolve) => setTimeout(resolve, delay));

    await message.reply(remark);
    userMemory.recordRoast(message.author.id);

    // Log auto-sass interaction
    const moodStatus = mood.getStatus();
    logInteraction({
      serverId: message.guild?.id, serverName: message.guild?.name,
      channelId: channel.id, channelName: channel.name,
      userId: message.author.id, username: message.author.displayName || message.author.username,
      triggerType: 'auto-sass', commandName: null,
      userMessage: message.content, sassResponse: remark,
      mood: moodStatus.mood, moodIntensity: moodStatus.intensity,
    }).catch((err) => console.error('DB log failed:', (err as Error).message));
  } catch (err) {
    // Auto-sass failures are silent — she just stays quiet
    console.error('Auto-sass failed:', (err as Error).message);
  }
}
