import {
  type Message,
  type Client,
  type GuildMember,
  type TextChannel,
} from 'discord.js';
import { getAutoSassDecision, getReactionDecision, getConversationJoin, queryAI, queryAIWithUsage, pickCustomReaction } from '../ai/index.js';
import * as userMemory from '../userMemory.js';
import { buildBaseContext } from '../shared/contextBuilder.js';
import { isOnAutoSassCooldown, setAutoSassCooldown, isOnGuildAutoSassCooldown, setGuildAutoSassCooldown } from '../cooldown.js';
import { getActivityDescription } from '../shared/commandUtils.js';
import * as mood from '../mood.js';
import { logInteraction, wasActivityRoastedRecently, setActivityRoasted, getAffinity, updateAffinity } from '../database/index.js';
import { recordResponse, getRecentResponses } from '../responseMemory.js';
import { UTILITY_SYSTEM_PROMPT } from '../ai/prompts.js';
import { handleResponse } from '../shared/responsePipeline.js';
import type { SassEvent } from '../types.js';

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

/**
 * Quality gate: ask AI if a response is worth sending.
 * Returns true if the response passes, false if it should be skipped.
 */
async function passesQualityGate(response: string): Promise<boolean> {
  // Short responses that are clearly filler — skip without AI call
  const lower = response.trim().toLowerCase();
  const FILLER = ['sure', 'checks out', 'real', 'valid', 'that tracks', 'cool', 'okay', 'nice', 'true', 'fair', 'mood', 'same', 'lol'];
  if (FILLER.includes(lower)) return false;

  // Very short responses (1-2 words) that aren't punchy — skip
  if (response.trim().split(/\s+/).length <= 2 && !/[!?]/.test(response)) {
    return false;
  }

  try {
    const verdict = await queryAI(
      `Rate this Discord auto-sass response on a scale of 1-10 for being funny, witty, or adding to a conversation. Just respond with the number.\n\nResponse: "${response}"`,
      { systemPrompt: UTILITY_SYSTEM_PROMPT, maxTokens: 5 }
    );
    const score = parseInt(verdict?.trim() ?? '0', 10);
    return score >= 5;
  } catch (err) {
    console.error('Quality gate check failed:', (err as Error).message);
    return true;
  }
}

/**
 * Build affinity context string for active users in a channel.
 */
async function buildAffinityContext(guildId: string, recentMessages: { authorId: string; author: string; isBot: boolean }[]): Promise<string> {
  const seen = new Set<string>();
  const parts: string[] = [];

  for (const msg of recentMessages) {
    if (msg.isBot || seen.has(msg.authorId)) continue;
    seen.add(msg.authorId);
    const affinity = await getAffinity(guildId, msg.authorId);
    const tier = affinity >= 86 ? 'favorite — be warm/playful'
      : affinity >= 71 ? 'liked — friendly teasing'
      : affinity >= 51 ? 'familiar — standard sass'
      : affinity >= 31 ? 'acquaintance — keep distance'
      : 'cold — dismissive/short';
    parts.push(`${msg.author}: ${Math.round(affinity)}% (${tier})`);
  }

  return parts.length > 0 ? `AFFINITY LEVELS:\n${parts.join('\n')}` : '';
}

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

export async function handleAutoSass(message: Message, _client: Client, options: AutoSassOptions = {}, event?: SassEvent): Promise<void> {
  const { heardName = false } = options;
  const guildId = message.guild?.id ?? '';

  if (!message.guild) return;

  // Build SassEvent for pipeline (if not passed from messageCreate)
  const channel = message.channel as TextChannel;
  const sassEvent: SassEvent = event ?? {
    guildId,
    channelId: channel.id,
    userId: message.author.id,
    displayName: message.author.displayName || message.author.username,
    content: message.content,
    isCreator: message.author.id === process.env.CREATOR_ID,
    message,
    channel,
  };

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

  // Tiered hostility detection — distinguishes casual banter from genuine hostility
  // Mild words (common in gaming/anime servers) only record beef if low affinity
  const mildFightPatterns = /\b(loser|idiot|stupid|pathetic|brain ?dead|get rekt|you'?re cooked|you fell off|trash take|you suck)\b/i;
  const mediumFightPatterns = /\b(stfu|fight me|shut up|fuck you|fuck off|go away|nobody likes|i hate you)\b/i;
  const severeFightPatterns = /\b(kys|die mad|kill yourself|go die)\b/i;
  const wholesomePatterns = /\b(love you|you'?re (amazing|the best|awesome)|thank you|ily|<3|❤️|😊|🥰)\b/i;

  const isSevere = severeFightPatterns.test(lowerText);
  const isMedium = !isSevere && mediumFightPatterns.test(lowerText);
  const isMild = !isSevere && !isMedium && mildFightPatterns.test(lowerText);

  if (isSevere || isMedium || isMild) {
    mood.shift(guildId, 'fighting').catch((err) => console.error('Mood shift failed:', (err as Error).message));

    // Severe: extra affinity penalty
    if (isSevere) {
      updateAffinity(guildId, message.author.id, -5).catch((err) => console.error('Severe affinity penalty failed:', (err as Error).message));
    }

    // Determine if beef should be recorded based on tier
    // Mild banter only counts as beef if the author has low affinity with Sass
    let shouldRecordBeef = isSevere || isMedium;
    if (isMild && !shouldRecordBeef) {
      const authorAffinity = await getAffinity(guildId, message.author.id);
      shouldRecordBeef = authorAffinity < 30;
    }

    if (shouldRecordBeef) {
      // Record beef ONLY if directly replying to another user with hostile language
      if (message.reference?.messageId) {
        try {
          const repliedTo = await message.channel.messages.fetch(message.reference.messageId);
          if (repliedTo?.author && !repliedTo.author.bot && repliedTo.author.id !== message.author.id) {
            const topic = text.slice(0, 50);
            userMemory.addBeef(guildId, message.author.id, repliedTo.author.id, topic).catch((err) => console.error('Add beef failed:', (err as Error).message));
          }
        } catch (err) { console.error('Fetch replied message failed:', (err as Error).message); }
      }
      // Record beef ONLY if they @mentioned another user with hostile language
      const mentionedUsers = message.mentions.users.filter((u) => !u.bot && u.id !== message.author.id && u.id !== _client.user?.id);
      for (const [, mentionedUser] of mentionedUsers) {
        const topic = text.slice(0, 50);
        userMemory.addBeef(guildId, message.author.id, mentionedUser.id, topic).catch((err) => console.error('Add beef failed:', (err as Error).message));
      }
    }
  } else if (wholesomePatterns.test(lowerText)) {
    mood.shift(guildId, 'nice_to_each_other').catch((err) => console.error('Mood shift failed:', (err as Error).message));
  }

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
    if (isOnAutoSassCooldown(channelId)) { console.log(`[SKIP] auto-sass channel cooldown for ${channelId.slice(-4)}`); return; }
    if (isOnGuildAutoSassCooldown(guildId)) { console.log(`[SKIP] auto-sass guild cooldown for ${guildId.slice(-4)}`); return; }

    // Roll the dice
    if (Math.random() > AUTO_SASS_CHANCE) { console.log(`[SKIP] auto-sass probability roll for ${channelId.slice(-4)}`); return; }
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
          const activityResult = await queryAIWithUsage(
            `You caught ${target.displayName} ${activity}. Call them out. ONE sentence, max 15 words. Be specific about the game/app.`,
            { systemPrompt: 'You publicly shame Discord activity. ONE short sentence. Max 15 words. Lowercase. No metaphors, no essays. Talk like a 20-year-old texting.' }
          );
          const roast = activityResult.text;
          if (roast && roast.trim().toUpperCase() !== 'SKIP') {
            // Activity roast is a snowflake — targets different user, custom message format
            // Kept manual instead of using handleResponse pipeline
            const { validateResponse } = await import('../responseFilter.js');
            const validation = validateResponse(roast);
            if (!validation.valid) { console.log(`[FILTER] activity roast filtered: ${validation.reason}`); return; }
            setAutoSassCooldown(channelId);
            setGuildAutoSassCooldown(guildId);
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
            const targetAffinity = await getAffinity(guildId, target.user.id);
            logInteraction({
              serverId: message.guild?.id, serverName: message.guild?.name,
              channelId: channel.id, channelName: channel.name,
              userId: target.user.id, username: target.displayName,
              triggerType: 'auto-sass-activity', commandName: null,
              userMessage: activity, sassResponse: roast,
              mood: moodInfo.mood, moodIntensity: moodInfo.intensity,
              affinity: targetAffinity,
              promptTokens: activityResult.promptTokens,
              completionTokens: activityResult.completionTokens,
            }).catch((err) => console.error('DB log failed:', (err as Error).message));
            return;
          }
        }
      }
    } catch (err) {
      console.error('Activity roast failed:', (err as Error).message);
    }
  }

  const { recentMessages, recentContext, peopleContext } = await buildBaseContext(guildId, channelId, 20);
  if (!recentMessages || recentMessages.length === 0) return;

  const affinityContext = await buildAffinityContext(guildId, recentMessages);
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
            setGuildAutoSassCooldown(guildId);
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
            setGuildAutoSassCooldown(guildId);
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
            setGuildAutoSassCooldown(guildId);
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
            setGuildAutoSassCooldown(guildId);
        const delay = 500 + Math.random() * 1500;
        await new Promise((resolve) => setTimeout(resolve, delay));
        await message.reply(reaction).catch((err) => console.error('Reply failed:', (err as Error).message));
        recordResponse(channelId, reaction);
        const moodStatus = await mood.getStatus(guildId);
        const userAffinity = await getAffinity(guildId, message.author.id);
        logInteraction({
          serverId: message.guild?.id, serverName: message.guild?.name,
          channelId: channel.id, channelName: channel.name,
          userId: message.author.id, username: message.author.displayName || message.author.username,
          triggerType: 'auto-sass-short', commandName: null,
          userMessage: message.content, sassResponse: reaction,
          mood: moodStatus.mood, moodIntensity: moodStatus.intensity,
          affinity: userAffinity,
        }).catch((err) => console.error('DB log failed:', (err as Error).message));
        return;
      }
    }

    // 25% — Join conversation (not a roast)
    if (roll >= 0.40 && roll < 0.65) {
      const contextWithPeople = [peopleContext, affinityContext, recentContext].filter(Boolean).join('\n\n');
      const joinResult = await getConversationJoin(contextWithPeople, responseHistory);
      const joinRemark = joinResult.text;

      if (joinRemark && joinRemark.trim().toUpperCase() !== 'SKIP') {
        // Quality gate — skip filler responses
        if (!(await passesQualityGate(joinRemark))) { console.log('[SKIP] join quality gate failed'); return; }

        setGuildAutoSassCooldown(guildId);
        const sent = await handleResponse({
          event: sassEvent,
          response: joinRemark,
          aiResult: joinResult,
          userMessage: message.content,
          triggerType: 'auto-sass-join',
          onFiltered: 'skip',
          sendMode: 'channel',
          trackRoast: false,
          updateAffinity: false,
        });
        if (sent) return;
      }
      // AI skipped — fall through to roast
    }

    // 35% — Classic roast (default / fallthrough)
    const contextWithPeople = [peopleContext, affinityContext, recentContext].filter(Boolean).join('\n\n');
    const roastResult = await getAutoSassDecision(contextWithPeople, responseHistory);
    const remark = roastResult.text;

    if (!remark || remark.trim().toUpperCase() === 'SKIP') return;
    // Quality gate — skip filler responses
    if (!(await passesQualityGate(remark))) { console.log('[SKIP] roast quality gate failed'); return; }

    setGuildAutoSassCooldown(guildId);
    await handleResponse({
      event: sassEvent,
      response: remark,
      aiResult: roastResult,
      userMessage: message.content,
      triggerType: 'auto-sass',
      onFiltered: 'skip',
      sendMode: 'reply',
      trackRoast: true,
      updateAffinity: false,
      context: [recentContext, peopleContext, affinityContext].filter(Boolean).join('\n---\n'),
    });
  } catch (err) {
    console.error('Auto-sass failed:', (err as Error).message);
  }
}
