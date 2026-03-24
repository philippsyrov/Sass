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
import * as mood from '../mood.js';
import { logInteraction, wasActivityRoastedRecently, setActivityRoasted } from '../database.js';
import { recordResponse, getRecentResponses } from '../responseMemory.js';

// Track message count per channel since last auto-sass
const messageCounters = new Map<string, { count: number; lastSeen: number }>();
const MAX_TRACKED_CHANNELS = 500;
const STALE_CHANNEL_MS = 60 * 60 * 1000; // 1 hour — remove inactive channels

// Periodic cleanup of stale channel counters (every 30 min)
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of messageCounters) {
    if (now - entry.lastSeen > STALE_CHANNEL_MS) messageCounters.delete(id);
  }
}, 30 * 60 * 1000);

const AUTO_SASS_CHANCE = parseFloat(process.env.AUTO_SASS_CHANCE ?? '0.55') || 0.55;
const MIN_MESSAGES = parseInt(process.env.AUTO_SASS_MIN_MESSAGES ?? '2', 10) || 2;

// Short reaction texts — no AI call needed, instant and human
const SHORT_REACTIONS = [
  'lol', 'nah', 'sure', 'no comment', 'help 💀',
  'bro what', 'wild', 'relatable', 'checks out', 'i—',
  'okay and?', 'fascinating', 'anyway', 'you done?', 'cool story',
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

  if (!message.guild) return;

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
          mood.shift(guildId, 'chaos').catch((err) => console.error('Mood shift failed:', (err as Error).message));
        }
      }
    }
  }

  // Vibe detection — shift mood based on chat energy
  const lowerText = text.toLowerCase();
  // Beef detection — only register REAL fights, not casual banter
  // Requires direct targeting: @mention with hostile language OR hostile reply to another user
  const fightPatterns = /\b(stfu|fight me|shut up|fuck you|fuck off|kys|you suck|loser|idiot|stupid|pathetic|brain ?dead|die mad|get rekt|go away|nobody likes|i hate you|you'?re cooked|you fell off|trash take)\b/i;
  const wholesomePatterns = /\b(love you|you'?re (amazing|the best|awesome)|thank you|ily|<3|❤️|😊|🥰)\b/i;

  if (fightPatterns.test(lowerText)) {
    mood.shift(guildId, 'fighting').catch((err) => console.error('Mood shift failed:', (err as Error).message));
    // Record beef ONLY if directly replying to another user with hostile language
    if (message.reference?.messageId) {
      try {
        const repliedTo = await message.channel.messages.fetch(message.reference.messageId);
        if (repliedTo?.author && !repliedTo.author.bot && repliedTo.author.id !== message.author.id) {
          const topic = text.slice(0, 50);
          userMemory.addBeef(guildId, message.author.id, repliedTo.author.id, topic).catch((err) => console.error('Add beef failed:', (err as Error).message));
        }
      } catch (err) { console.error('Fetch message failed:', (err as Error).message); }
    }
    // Record beef ONLY if they @mentioned another user with hostile language
    const mentionedUsers = message.mentions.users.filter((u) => !u.bot && u.id !== message.author.id && u.id !== _client.user?.id);
    for (const [, mentionedUser] of mentionedUsers) {
      const topic = text.slice(0, 50);
      userMemory.addBeef(guildId, message.author.id, mentionedUser.id, topic).catch((err) => console.error('Add beef failed:', (err as Error).message));
    }
  } else if (wholesomePatterns.test(lowerText)) {
    mood.shift(guildId, 'nice_to_each_other').catch((err) => console.error('Mood shift failed:', (err as Error).message));
  }

  // Cast channel — this handler only runs in guild text channels
  const channel = message.channel as TextChannel;
  const channelId = channel.id;

  // Increment counter (cap tracked channels to prevent memory leak)
  const existing = messageCounters.get(channelId);
  const count = (existing?.count ?? 0) + 1;
  messageCounters.set(channelId, { count, lastSeen: Date.now() });
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
  messageCounters.set(channelId, { count: 0, lastSeen: Date.now() });

  // 10% chance to roast someone's gaming activity instead of conversation
  if (Math.random() < 0.10) {
    try {
      const guild = message.guild;
      if (guild) {
        const members = guild.members.cache;
        const now = Date.now();
        const MIN_PLAY_MINUTES = 60; // Only roast if playing for 1+ hours
        // Sync filter: basic eligibility (activity, playtime)
        const candidates = members.filter((m: GuildMember) => {
          if (m.user.bot || m.user.id === process.env.CREATOR_ID) return false;
          const activity = getActivityDescription(m.presence);
          if (!activity || activity.startsWith('custom status')) return false;
          const playingActivity = m.presence?.activities?.find(a => a.type === 0 && a.timestamps?.start);
          if (playingActivity?.timestamps?.start) {
            const elapsed = Math.floor((now - playingActivity.timestamps.start.getTime()) / 60000);
            if (elapsed < MIN_PLAY_MINUTES) return false;
          }
          return true;
        });
        // Async filter: check DB for 24h cooldown (survives deploys)
        const eligible: GuildMember[] = [];
        for (const [, m] of candidates) {
          const recentlyRoasted = await wasActivityRoastedRecently(guildId, m.user.id);
          if (!recentlyRoasted) eligible.push(m);
        }
        if (eligible.length > 0) {
          const target = eligible[Math.floor(Math.random() * eligible.length)];
          if (!target) return;
          const activity = getActivityDescription(target.presence);
          if (!activity) return;
          const roast = await queryAI(
            `You caught ${target.displayName} ${activity}. Call them out. ONE sentence, max 15 words. Be specific about the game/app.`,
            { systemPrompt: 'You publicly shame Discord activity. ONE short sentence. Max 15 words. Lowercase. No metaphors, no essays. Talk like a 20-year-old texting.' }
          );
          if (roast && roast.trim().toUpperCase() !== 'SKIP') {
            setAutoSassCooldown(channelId);
            // Track in DB so it survives deploys
            setActivityRoasted(guildId, target.user.id).catch((err) => console.error('Set activity roast failed:', (err as Error).message));
            await channel.sendTyping().catch((err) => console.error('sendTyping failed:', (err as Error).message));
            const delay = 1000 + Math.random() * 2000;
            await new Promise((resolve) => setTimeout(resolve, delay));
            const activityRoastMsg = `👀 hey <@${target.user.id}>, ${roast}`;
            await channel.send(activityRoastMsg).catch((err) => console.error('Activity roast send failed:', (err as Error).message));
            recordResponse(channelId, roast);
            userMemory.recordRoast(guildId, target.user.id).catch((err) => console.error('Record roast failed:', (err as Error).message));
            const moodInfo = await mood.getStatus(guildId);
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

  const recentMessages = messageBuffer.getRecentRaw(channelId, 20);
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
        const moodStatus = await mood.getStatus(guildId);
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
        await channel.sendTyping().catch((err) => console.error('sendTyping failed:', (err as Error).message));
        const delay = 1000 + Math.random() * 2000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        await channel.send(joinRemark).catch((err) => console.error('Channel send failed:', (err as Error).message));
        recordResponse(channelId, joinRemark);
        const moodStatus = await mood.getStatus(guildId);
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
    await channel.sendTyping().catch((err) => console.error('sendTyping failed:', (err as Error).message));
    const delay = 1000 + Math.random() * 2000;
    await new Promise((resolve) => setTimeout(resolve, delay));

    await message.reply(remark).catch((err) => console.error('Reply failed:', (err as Error).message));
    recordResponse(channelId, remark);
    userMemory.recordRoast(guildId, message.author.id).catch((err) => console.error('Record roast failed:', (err as Error).message));

    const moodStatus = await mood.getStatus(guildId);
    logInteraction({
      serverId: message.guild?.id, serverName: message.guild?.name,
      channelId: channel.id, channelName: channel.name,
      userId: message.author.id, username: message.author.displayName || message.author.username,
      triggerType: 'auto-sass', commandName: null,
      userMessage: message.content, sassResponse: remark,
      mood: moodStatus.mood, moodIntensity: moodStatus.intensity,
      context: [recentContext, peopleContext].filter(Boolean).join('\n---\n'),
    }).catch((err) => console.error('DB log failed:', (err as Error).message));
  } catch (err) {
    console.error('Auto-sass failed:', (err as Error).message);
  }
}
