import {
  type Message,
  type Client,
  type GuildMember,
  type TextChannel,
} from 'discord.js';
import { getAutoSassDecision, getReactionDecision, getConversationJoin, queryAI, pickCustomReaction } from '../ai.js';
import { messageBuffer } from '../messageBuffer.js';
import * as userMemory from '../userMemory.js';
import { isOnAutoSassCooldown, setAutoSassCooldown } from '../cooldown.js';
import { getActivityDescription } from '../shared/commandUtils.js';
import { mood } from '../mood.js';
import { logInteraction } from '../database.js';
import { recordResponse, getRecentResponses } from '../responseMemory.js';

// Track message count per channel since last auto-sass
const messageCounters = new Map<string, number>();
const MAX_TRACKED_CHANNELS = 500;

// Track activity roasts per user — max once per 24h
const activityRoastCooldowns = new Map<string, number>();
const ACTIVITY_ROAST_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_ACTIVITY_COOLDOWNS = 500;

// Clean up expired activity roast cooldowns every 30 min
setInterval(() => {
  const now = Date.now();
  for (const [id, ts] of activityRoastCooldowns) {
    if (now - ts > ACTIVITY_ROAST_COOLDOWN_MS) activityRoastCooldowns.delete(id);
  }
}, 30 * 60 * 1000);

const AUTO_SASS_CHANCE = parseFloat(process.env.AUTO_SASS_CHANCE ?? '0.55') || 0.55;
const MIN_MESSAGES = parseInt(process.env.AUTO_SASS_MIN_MESSAGES ?? '2', 10) || 2;

// Short reaction texts — no AI call needed, instant and human
const SHORT_REACTIONS = [
  'lol', 'real', 'nah', 'honestly fair', 'true', 'valid',
  'bro what', 'help 💀', 'no comment', 'sure', 'okay lol',
  'wild', 'relatable', 'that tracks', 'checks out', 'i—',
];

/**
 * Occasionally Sass reads the room and drops an unsolicited remark or reaction.
 *
 * Response types (diversified for human feel):
 * - Roast (35%) — classic sassy remark about what people are saying
 * - Join conversation (25%) — agree, take sides, add a genuine take
 * - Emoji react (20%) — just slap a reaction on the message
 * - Short text react (10%) — "lol", "real", "💀", no AI call
 * - Lurk react (10%) — react to an older message (3-5 msgs back)
 */
interface AutoSassOptions {
  heardName?: boolean; // someone said "sass" — skip dice roll, let AI decide
}

export async function handleAutoSass(message: Message, _client: Client, options: AutoSassOptions = {}): Promise<void> {
  const { heardName = false } = options;
  const guildId = message.guild?.id ?? '';

  // Never auto-sass the creator (unless they said her name)
  if (message.author.id === process.env.CREATOR_ID && !heardName) return;

  // Wild quote detection — store genuinely unhinged statements, not reactions
  const text = message.content;
  if (text.length > 15 && text.length < 200) {
    const wordCount = text.split(/\s+/).length;
    if (wordCount >= 4) {
      // Skip common reactions and short caps — these aren't wild, just excited
      const trimmed = text.trim().toLowerCase();
      const isJustReaction = /^(lmao|lol|bruh|bro|wtf|no way|i can'?t|help|dead|crying|oof|rip|yikes|same|real|true|valid|fr|nah|what|huh|bro what|no shot|help me|i'?m dead|this is insane|that was|oh my|are you|hahaha|lmfao|no way|stop|dude|damn|yo|wait)(\s|$|[!?.,])/i.test(trimmed);
      if (isJustReaction) {
        // Not wild, just a reaction — skip
      } else {
        // Short all-caps under 30 chars = reaction, not wild (e.g. "LMAO NO WAY BRO")
        const isAllCaps = text.length > 30 && (text.match(/[A-Z]/g) || []).length / text.length > 0.7;
        // Actual unhinged claims, threats, confessions
        const hasWildContent = /\b(kill|die|fight|marry|eat|destroy|worship|sacrifice|ban|arrest|haunted|cursed|pregnant|kidnap|steal|illegal|commit|murder|bury|poison|betray)\b/i.test(text);
        // Weird personal claims with emphasis (not just punctuation alone)
        const hasWeirdClaim = /\b(i (am|was|will|could|should|wanna|need to|have to|might|swear))\b/i.test(text) && hasWildContent;

        if (hasWildContent || hasWeirdClaim || isAllCaps) {
          const authorName = message.author.displayName || message.author.username;
          userMemory.addWildQuote(guildId, message.author.id, authorName, text).catch((err) => console.error('Add wild quote failed:', (err as Error).message));
          mood.shift('chaos');
        }
      }
    }
  }

  // Vibe detection — shift mood based on chat energy
  const lowerText = text.toLowerCase();
  const fightPatterns = /\b(stfu|fight me|you'?re wrong|shut up|no one asked|cope|L take|ratio|fuck you|fuck off|kys|you suck|trash|garbage|mid|ass|clown|loser|idiot|stupid|dumb)\b/i;
  const wholesomePatterns = /\b(love you|you'?re (amazing|the best|awesome)|thank you|ily|<3|❤️|😊|🥰)\b/i;

  if (fightPatterns.test(lowerText)) {
    mood.shift('fighting');
    // Record beef if this is a reply to another user
    if (message.reference?.messageId) {
      try {
        const repliedTo = await message.channel.messages.fetch(message.reference.messageId);
        if (repliedTo?.author && !repliedTo.author.bot && repliedTo.author.id !== message.author.id) {
          const topic = text.slice(0, 50);
          userMemory.addBeef(guildId, message.author.id, repliedTo.author.id, topic).catch((err) => console.error('Add beef failed:', (err as Error).message));
        }
      } catch (_err) { /* message might be deleted */ }
    }
    // Record beef if they mentioned another user aggressively
    const mentionedUsers = message.mentions.users.filter((u) => !u.bot && u.id !== message.author.id && u.id !== _client.user?.id);
    for (const [, mentionedUser] of mentionedUsers) {
      const topic = text.slice(0, 50);
      userMemory.addBeef(guildId, message.author.id, mentionedUser.id, topic).catch((err) => console.error('Add beef failed:', (err as Error).message));
    }
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
    const toDelete = messageCounters.size - MAX_TRACKED_CHANNELS;
    let deleted = 0;
    for (const key of messageCounters.keys()) {
      if (deleted >= toDelete) break;
      messageCounters.delete(key);
      deleted++;
    }
  }

  // If she heard her name, skip the gates — let the AI decide
  if (!heardName) {
    // Not enough messages yet
    if (count < MIN_MESSAGES) return;

    // Skip short messages — not enough to work with for a good auto-sass
    const wordCount = message.content.trim().split(/\s+/).length;
    if (wordCount < 4) return;

    // Channel cooldown — don't auto-sass too frequently
    if (isOnAutoSassCooldown(channelId)) return;

    // Roll the dice
    if (Math.random() > AUTO_SASS_CHANCE) return;
  }

  // Reset counter regardless of outcome
  messageCounters.set(channelId, 0);

  // 10% chance to roast someone's gaming activity instead of conversation
  if (Math.random() < 0.10) {
    try {
      const guild = message.guild;
      if (guild) {
        const members = guild.members.cache;
        const now = Date.now();
        const MIN_PLAY_MINUTES = 60; // Only roast if playing for 1+ hours
        const gamers = members.filter((m: GuildMember) => {
          if (m.user.bot || m.user.id === process.env.CREATOR_ID) return false;
          // Skip users already activity-roasted in last 24h
          const lastRoasted = activityRoastCooldowns.get(m.user.id);
          if (lastRoasted && now - lastRoasted < ACTIVITY_ROAST_COOLDOWN_MS) return false;
          const activity = getActivityDescription(m.presence);
          if (!activity || activity.startsWith('custom status')) return false;
          // Only roast long gaming sessions — 8 minutes isn't roast-worthy
          const playingActivity = m.presence?.activities?.find(a => a.type === 0 && a.timestamps?.start);
          if (playingActivity?.timestamps?.start) {
            const elapsed = Math.floor((now - playingActivity.timestamps.start.getTime()) / 60000);
            if (elapsed < MIN_PLAY_MINUTES) return false;
          }
          return true;
        });
        if (gamers.size > 0) {
          const target = gamers.random();
          if (!target) return;
          const activity = getActivityDescription(target.presence);
          if (!activity) return;
          const roast = await queryAI(
            `You caught ${target.displayName} ${activity}. Call them out. ONE sentence, max 15 words. Be specific about the game/app.`,
            { systemPrompt: 'You publicly shame Discord activity. ONE short sentence. Max 15 words. Lowercase. No metaphors, no essays. Talk like a 20-year-old texting.' }
          );
          if (roast && roast.trim().toUpperCase() !== 'SKIP') {
            setAutoSassCooldown(channelId);
            // Track this user so they don't get activity-roasted again for 24h
            activityRoastCooldowns.set(target.user.id, Date.now());
            if (activityRoastCooldowns.size > MAX_ACTIVITY_COOLDOWNS) {
              const oldest = activityRoastCooldowns.keys().next().value;
              if (oldest) activityRoastCooldowns.delete(oldest);
            }
            await channel.sendTyping();
            const delay = 1000 + Math.random() * 2000;
            await new Promise((resolve) => setTimeout(resolve, delay));
            const activityRoastMsg = `👀 hey <@${target.user.id}>, ${roast}`;
            await channel.send(activityRoastMsg);
            recordResponse(channelId, roast);
            userMemory.recordRoast(guildId, target.user.id).catch((err) => console.error('Record roast failed:', (err as Error).message));
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
      console.error('Activity roast failed:', (err as Error).message);
    }
  }

  const recentMessages = messageBuffer.getRecentRaw(channelId, 15);
  if (!recentMessages || recentMessages.length === 0) return;

  const recentContext = recentMessages.map(
    (msg) => `${msg.author}${msg.isBot ? ' [BOT]' : ''}: ${msg.content}`
  ).join('\n');
  const peopleContext = await userMemory.buildPeopleContext(guildId, recentMessages);
  const responseHistory = getRecentResponses(channelId);

  // Roll for response type
  const roll = Math.random();

  try {
    // 20% — Emoji react on current message (try custom emoji first, then standard)
    if (roll < 0.20) {
      const customEmoji = pickCustomReaction(message.content);
      if (customEmoji) {
        try {
          await message.react(customEmoji);
          setAutoSassCooldown(channelId);
          return;
        } catch (err) {
          console.error('Custom emoji react failed:', (err as Error).message);
        }
      }
      const emoji = await getReactionDecision(recentContext);
      if (emoji) {
        try {
          await message.react(emoji);
          setAutoSassCooldown(channelId);
        } catch (err) {
          console.error('Emoji react failed:', (err as Error).message);
        }
        return;
      }
      // Emoji failed — fall through to roast
    }

    // 10% — Lurk mode: react to an older message (3-5 messages back)
    if (roll >= 0.20 && roll < 0.30) {
      try {
        const fetched = await channel.messages.fetch({ limit: 8 });
        const candidates = fetched
          .filter((m) => !m.author.bot && m.content.length > 5)
          .toJSON()
          .slice(2, 6); // skip the 2 most recent, pick from 3rd-6th
        if (candidates.length > 0) {
          const target = candidates[Math.floor(Math.random() * candidates.length)];
          if (target) {
            const emoji = await getReactionDecision(`${target.author.displayName}: ${target.content}`);
            if (emoji) {
              try {
                await target.react(emoji);
                setAutoSassCooldown(channelId);
              } catch (err) {
                console.error('Lurk emoji react failed:', (err as Error).message);
              }
              return;
            }
          }
        }
      } catch (err) {
        console.error('Lurk mode failed:', (err as Error).message);
      }
    }

    // 10% — Short text reaction (no AI call)
    if (roll >= 0.30 && roll < 0.40) {
      const reaction = SHORT_REACTIONS[Math.floor(Math.random() * SHORT_REACTIONS.length)];
      if (reaction) {
        setAutoSassCooldown(channelId);
        const delay = 500 + Math.random() * 1500;
        await new Promise((resolve) => setTimeout(resolve, delay));
        await message.reply(reaction).catch((err) => console.error('Reply failed:', (err as Error).message));
        recordResponse(channelId, reaction);
        const moodStatus = mood.getStatus();
        logInteraction({
          serverId: message.guild?.id, serverName: message.guild?.name,
          channelId: channel.id, channelName: channel.name,
          userId: message.author.id, username: message.author.displayName || message.author.username,
          triggerType: 'auto-sass-short', commandName: null,
          userMessage: message.content, sassResponse: reaction,
          mood: moodStatus.mood, moodIntensity: moodStatus.intensity,
        }).catch((err) => console.error('DB log failed:', (err as Error).message));
        return;
      }
    }

    // 25% — Join conversation (not a roast)
    if (roll >= 0.40 && roll < 0.65) {
      const contextWithPeople = peopleContext ? `${peopleContext}\n\n${recentContext}` : recentContext;
      const joinRemark = await getConversationJoin(contextWithPeople, responseHistory);

      if (joinRemark && joinRemark.trim().toUpperCase() !== 'SKIP') {
        setAutoSassCooldown(channelId);
        await channel.sendTyping();
        const delay = 1000 + Math.random() * 2000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        await channel.send(joinRemark).catch((err) => console.error('Channel send failed:', (err as Error).message));
        recordResponse(channelId, joinRemark);
        const moodStatus = mood.getStatus();
        logInteraction({
          serverId: message.guild?.id, serverName: message.guild?.name,
          channelId: channel.id, channelName: channel.name,
          userId: message.author.id, username: message.author.displayName || message.author.username,
          triggerType: 'auto-sass-join', commandName: null,
          userMessage: message.content, sassResponse: joinRemark,
          mood: moodStatus.mood, moodIntensity: moodStatus.intensity,
        }).catch((err) => console.error('DB log failed:', (err as Error).message));
        return;
      }
      // AI skipped — fall through to roast
    }

    // 35% — Classic roast (default / fallthrough)
    const contextWithPeople = peopleContext ? `${peopleContext}\n\n${recentContext}` : recentContext;
    const remark = await getAutoSassDecision(contextWithPeople, responseHistory);

    if (!remark || remark.trim().toUpperCase() === 'SKIP') return;

    setAutoSassCooldown(channelId);
    await channel.sendTyping();
    const delay = 1000 + Math.random() * 2000;
    await new Promise((resolve) => setTimeout(resolve, delay));

    await message.reply(remark).catch((err) => console.error('Reply failed:', (err as Error).message));
    recordResponse(channelId, remark);
    userMemory.recordRoast(guildId, message.author.id).catch((err) => console.error('Record roast failed:', (err as Error).message));

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
    console.error('Auto-sass failed:', (err as Error).message);
  }
}
