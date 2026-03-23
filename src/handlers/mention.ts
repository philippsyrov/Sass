import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type Message,
  type Client,
  type ButtonInteraction,
  type Attachment,
  type TextChannel,
} from 'discord.js';
import { getSassResponse, extractRoastTopic, analyzeProfile, queryAI } from '../ai.js';
import { messageBuffer } from '../messageBuffer.js';
import * as userMemory from '../userMemory.js';
import { isOnMentionCooldown, setMentionCooldown, setAutoSassCooldown, trackMentionEscalation, getEscalationCount } from '../cooldown.js';
import { storeMemory, searchMemories } from '../vectorMemory.js';
import { buildHelpPages } from '../helpPages.js';
import * as mood from '../mood.js';
import { extractStatement, checkContradiction, generate4kCallout, storeStatement } from '../caughtIn4k.js';
import { logInteraction, logCommand, updateAffinity, getAffinity } from '../database.js';
import { recordResponse, getRecentResponses } from '../responseMemory.js';
import { getShipScore, getPairInteractions, warmPairCache } from '../shipScore.js';

// Profile cooldown — prevent spamming profile checks
const profileCooldowns = new Map<string, number>();
const PROFILE_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes
const MAX_PROFILE_COOLDOWNS = 500;

// Remember cooldown — prevent spamming remember commands
const rememberCooldowns = new Map<string, number>();
const REMEMBER_COOLDOWN_MS = 30 * 1000; // 30 seconds between remembers
const MAX_REMEMBER_COOLDOWNS = 500;

// Spam tracker — detect low-effort repeated pings
const spamTracker = new Map<string, { count: number; lastTimestamp: number }>();
const SPAM_WINDOW_MS = 2 * 60 * 1000; // 2 minutes
const SPAM_THRESHOLD = 3; // 3+ low-effort messages = ignore
const MAX_SPAM_TRACKER = 500;

// Sensitive topic tracker — soft-ban users who spam drama
const sensitiveTracker = new Map<string, { count: number; lastTimestamp: number; softBanUntil: number }>();
const SENSITIVE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const SENSITIVE_BAN_MS = 15 * 60 * 1000; // 15 minute soft-ban
const MAX_SENSITIVE_TRACKER = 500;
const SENSITIVE_KEYWORDS = /\b(kill myself|wanna die|killing myself|i'm dying|im dying|bleeding out|gonna bleed|self.?harm|end it all|jump off|hang myself|slit my|cut myself|overdose|i'm dead|im dead|my arm fell off|pass out|bleeding everywhere)\b/i;

// Affinity gain cooldown — max 1 gain per 10 min per user
const affinityGainCooldowns = new Map<string, number>();
const AFFINITY_GAIN_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes
const MAX_AFFINITY_COOLDOWNS = 500;

// Clean up cooldowns every 10 min
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of profileCooldowns) {
    if (now - ts > PROFILE_COOLDOWN_MS) profileCooldowns.delete(key);
  }
  for (const [key, ts] of rememberCooldowns) {
    if (now - ts > REMEMBER_COOLDOWN_MS) rememberCooldowns.delete(key);
  }
  for (const [key, entry] of spamTracker) {
    if (now - entry.lastTimestamp > SPAM_WINDOW_MS) spamTracker.delete(key);
  }
  // FIFO eviction if still over cap after time-based cleanup
  while (spamTracker.size > MAX_SPAM_TRACKER) {
    const oldest = spamTracker.keys().next().value;
    if (oldest !== undefined) spamTracker.delete(oldest); else break;
  }
  for (const [key, entry] of sensitiveTracker) {
    if (now - entry.lastTimestamp > SENSITIVE_BAN_MS * 2) sensitiveTracker.delete(key);
  }
  while (sensitiveTracker.size > MAX_SENSITIVE_TRACKER) {
    const oldest = sensitiveTracker.keys().next().value;
    if (oldest !== undefined) sensitiveTracker.delete(oldest); else break;
  }
  for (const [key, ts] of affinityGainCooldowns) {
    if (now - ts > AFFINITY_GAIN_COOLDOWN_MS) affinityGainCooldowns.delete(key);
  }
  while (affinityGainCooldowns.size > MAX_AFFINITY_COOLDOWNS) {
    const oldest = affinityGainCooldowns.keys().next().value;
    if (oldest !== undefined) affinityGainCooldowns.delete(oldest); else break;
  }
}, 10 * 60 * 1000);

/**
 * Handle direct @Sass mentions and replies to Sass.
 * Grabs recent context + user memory and fires back a sassy response.
 */
export async function handleMention(message: Message, client: Client): Promise<void> {
  const userId = message.author.id;
  const displayName = message.author.displayName || message.author.username;
  const guildId = message.guild?.id ?? '';

  // Cooldown — don't spam-reply to the same user
  if (isOnMentionCooldown(userId)) return;
  setMentionCooldown(userId);

  if (!client.user) return;

  // Track escalation — how much this user has been tagging Sass recently
  const escalationLevel = trackMentionEscalation(guildId, userId);

  // Cast channel — this handler only runs in guild text channels
  const channel = message.channel as TextChannel;

  // Strip the @mention to get the actual user message
  const cleanContent = message.content
    .replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '')
    .trim();

  // Check if this is the creator
  const isCreator = userId === process.env.CREATOR_ID;

  // Check for image attachments (jpg, png, gif, webp)
  const imageAttachment = message.attachments.find((a: Attachment) =>
    a.contentType != null && a.contentType.startsWith('image/')
  );

  const lowerClean = cleanContent.toLowerCase();

  // --- Spam detection: ignore low-effort repeated pings ---
  const spamKey = `${guildId}:${userId}`;
  if (cleanContent.length <= 5 && !isCreator) {
    const now = Date.now();
    const entry = spamTracker.get(spamKey);
    if (entry && now - entry.lastTimestamp < SPAM_WINDOW_MS) {
      entry.count++;
      entry.lastTimestamp = now;
      if (entry.count >= SPAM_THRESHOLD) {
        // Silently ignore — no API call, no response
        updateAffinity(guildId, userId, -3).catch((err) => console.error('Affinity update failed:', (err as Error).message));
        return;
      }
    } else {
      spamTracker.set(spamKey, { count: 1, lastTimestamp: now });
    }
  } else {
    // Real message — reset spam counter
    spamTracker.delete(spamKey);
  }

  // --- Sensitive topic handling: disengage from drama bait ---
  if (!isCreator && SENSITIVE_KEYWORDS.test(cleanContent)) {
    const sensitiveKey = `${guildId}:${userId}`;
    const now = Date.now();
    const entry = sensitiveTracker.get(sensitiveKey);

    if (entry?.softBanUntil && now < entry.softBanUntil) {
      // Still soft-banned — ignore completely
      return;
    }

    if (entry?.softBanUntil && now >= entry.softBanUntil) {
      // Soft-ban expired — check-in message
      sensitiveTracker.delete(sensitiveKey);
      const channel = message.channel as TextChannel;
      await channel.sendTyping();
      const checkIn = await queryAI(`${displayName} was being dramatic earlier about injuries/death. They just messaged again. Give a short sassy check-in like "you good now?" or "you better? i need proof." Keep it under 10 words, be sassy but not mean.`, { temperature: 1.0 });
      if (checkIn) {
        await message.reply(checkIn).catch((err) => console.error('Reply failed:', (err as Error).message));
      }
      return;
    }

    if (entry && now - entry.lastTimestamp < SENSITIVE_WINDOW_MS) {
      entry.count++;
      entry.lastTimestamp = now;
      if (entry.count >= 2) {
        // 2nd+ sensitive message — soft-ban
        entry.softBanUntil = now + SENSITIVE_BAN_MS;
        return;
      }
    } else {
      sensitiveTracker.set(sensitiveKey, { count: 1, lastTimestamp: now, softBanUntil: 0 });
    }
    // First sensitive message — let AI handle with dismiss hint (added to escalationContext later)
  }

  // Help command — paginated embeds with button navigation
  if (lowerClean === 'help' || lowerClean === 'commands' || lowerClean === '?') {
    const botAvatar = client.user.displayAvatarURL({ size: 256 });
    const pages = buildHelpPages(botAvatar);

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('help_prev').setLabel('◀').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('help_next').setLabel('▶').setStyle(ButtonStyle.Secondary),
    );

    let currentPage = 0;
    const firstPage = pages[0];
    if (!firstPage) return;
    const reply = await message.reply({ embeds: [firstPage], components: [buttons] });

    const collector = reply.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 120_000,
    });

    collector.on('collect', async (btn: ButtonInteraction) => {
      currentPage = btn.customId === 'help_prev'
        ? (currentPage > 0 ? currentPage - 1 : pages.length - 1)
        : (currentPage < pages.length - 1 ? currentPage + 1 : 0);
      const page = pages[currentPage];
      if (!page) return;
      await btn.update({ embeds: [page], components: [buttons] });
    });

    collector.on('end', () => {
      const disabledButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('help_prev').setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('help_next').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(true),
      );
      reply.edit({ components: [disabledButtons] }).catch((err) => console.error('Failed to disable help buttons:', (err as Error).message));
    });

    return;
  }

  // Profile command — "@Sass profile" or "@Sass profile @user"
  const profileMatch = lowerClean.match(/^profile\s*(?:<@!?(\d+)>)?$/);
  if (lowerClean === 'profile' || profileMatch) {
    const targetId = profileMatch?.[1] || userId;

    // Profile cooldown — 10 min per target user
    const profileCooldownKey = `profile:${guildId}:${userId}:${targetId}`;
    const lastProfiled = profileCooldowns.get(profileCooldownKey);
    const now = Date.now();
    if (lastProfiled && now - lastProfiled < PROFILE_COOLDOWN_MS) {
      const remaining = Math.ceil((PROFILE_COOLDOWN_MS - (now - lastProfiled)) / 60000);
      const spamResponses = [
        `you just checked ${remaining} min ago. they haven't gotten less annoying yet.`,
        `obsessed much? try again in ${remaining} min <:sass_judge:100000000000000902>`,
        `i already told you. reading it twice won't change the verdict.`,
        `you're speedrunning this command and it's embarrassing <:sass_stare:100000000000000900>`,
      ];
      await message.reply(spamResponses[Math.floor(Math.random() * spamResponses.length)] as string).catch((err) => console.error('Reply failed:', (err as Error).message));
      return;
    }

    const targetUser = targetId === userId
      ? message.author
      : await message.guild?.members.fetch(targetId).then((m) => m.user).catch(() => null) ?? null;
    if (!targetUser) {
      await message.reply("can't find that person. they probably don't exist, like your taste").catch((err) => console.error('Reply failed:', (err as Error).message));
      return;
    }
    const targetName = targetUser.displayName || targetUser.username;

    // Fetch recent messages from this channel by the target user
    try {
      await channel.sendTyping();
      const fetched = await channel.messages.fetch({ limit: 100 });
      const userMsgs = fetched
        .filter((m) => m.author.id === targetId && !m.author.bot)
        .map((m) => m.content)
        .filter((c) => c.length > 0)
        .reverse()
        .slice(0, 30);

      if (userMsgs.length < 3) {
        await message.reply(`${targetName} barely talks. can't profile a ghost.`).catch((err) => console.error('Reply failed:', (err as Error).message));
        return;
      }

      const raw = await analyzeProfile(targetName, userMsgs.join('\n'));
      if (!raw) {
        await message.reply("my brain crashed trying to analyze this person. that says a lot honestly.").catch((err) => console.error('Reply failed:', (err as Error).message));
        return;
      }

      // Parse the response
      const lines = raw.trim().split('\n');
      const scores: Record<string, number> = {};
      let archetype = 'Unknown';
      let roast = '';
      for (const line of lines) {
        const [key, ...rest] = line.split(':');
        if (!key) continue;
        const val = rest.join(':').trim();
        if (['chaos', 'thirst', 'aggro', 'clown', 'brain'].includes(key.trim())) {
          scores[key.trim()] = Math.min(10, Math.max(0, parseInt(val, 10) || 0));
        } else if (key.trim() === 'archetype') {
          archetype = val;
        } else if (key.trim() === 'roast') {
          roast = val;
        }
      }

      // Build visual bars
      const bar = (score: number): string => '█'.repeat(score) + '░'.repeat(10 - score);
      const profile = [
        `**${targetName}'s behavioral diagnosis**`,
        `> archetype: **${archetype}**`,
        '',
        `\`chaos \` ${bar(scores['chaos'] || 0)} **${scores['chaos'] || 0}**/10`,
        `\`thirst\` ${bar(scores['thirst'] || 0)} **${scores['thirst'] || 0}**/10`,
        `\`aggro \` ${bar(scores['aggro'] || 0)} **${scores['aggro'] || 0}**/10`,
        `\`clown \` ${bar(scores['clown'] || 0)} **${scores['clown'] || 0}**/10`,
        `\`brain \` ${bar(scores['brain'] || 0)} **${scores['brain'] || 0}**/10`,
        '',
        `*${roast}*`,
      ];
      await message.reply(profile.join('\n')).catch((err) => console.error('Reply failed:', (err as Error).message));
      // Set profile cooldown
      profileCooldowns.set(profileCooldownKey, Date.now());
      if (profileCooldowns.size > MAX_PROFILE_COOLDOWNS) {
        const oldest = profileCooldowns.keys().next().value;
        if (oldest !== undefined) profileCooldowns.delete(oldest);
      }
      logCommand({ serverId: message.guild?.id, userId, commandName: 'profile', commandType: 'mention' }).catch((err) => console.error('Log command failed:', (err as Error).message));
    } catch (err) {
      console.error('Profile analysis failed:', (err as Error).message);
      await message.reply("my brain crashed trying to analyze this person. that says a lot honestly.").catch((replyErr) => console.error('Reply failed:', (replyErr as Error).message));
    }
    return;
  }

  // Ship command — "@Sass ship @user1 @user2"
  const shipMatch = cleanContent.match(/^ship\s+<@!?(\d+)>\s+<@!?(\d+)>/i);
  if (shipMatch) {
    const id1 = shipMatch[1]; const id2 = shipMatch[2];
    if (!id1 || !id2) return;
    try {
      await channel.sendTyping();
      const member1 = await message.guild?.members.fetch(id1);
      const member2 = await message.guild?.members.fetch(id2);
      if (!member1 || !member2) {
        await message.reply("couldn't ship them. maybe they're not meant to be.");
        return;
      }
      const name1 = member1.displayName; const name2 = member2.displayName;
      await warmPairCache(guildId, id1, id2);
      const percent = await getShipScore(guildId, id1, id2);
      const bar = '❤️'.repeat(Math.round(percent / 10)) + '🖤'.repeat(10 - Math.round(percent / 10));
      const shipName = name1.slice(0, Math.ceil(name1.length / 2)) + name2.slice(Math.floor(name2.length / 2));
      let verdict = await queryAI(
        `"${name1}" x "${name2}" at ${percent}%. ONE sentence verdict, max 12 words. No metaphors or object comparisons. React like a friend judging a couple.`,
        { systemPrompt: 'You judge ship compatibility. ONE short sentence. Max 12 words. Lowercase. Talk like a 20-year-old, not a poet. No "chemistry of a [object]" comparisons. If you exceed 12 words, you failed.' }
      );
      // Hard enforce 12 word cap
      if (verdict && verdict.split(/\s+/).length > 14) {
        const firstSentence = verdict.split(/[.!?]/)[0];
        verdict = firstSentence ? firstSentence.trim() + '.' : verdict.split(/\s+/).slice(0, 12).join(' ') + '.';
      }
      const interactions = getPairInteractions(guildId, id1, id2);
      let hint = '';
      if (percent === 100) {
        hint = '\n\n💯 **100% — PROVEN PAIR.** sass has seen enough. this is real.';
      } else if (percent >= 95 && interactions >= 40) {
        hint = '\n\n👀 *almost there... keep talking to each other*';
      } else if (interactions >= 10) {
        hint = `\n\n📈 *sass has seen ${interactions} interactions between you two*`;
      }
      const shipResponse = `🌸 ✿ 🌸 ✿ 🌸 ✿ 🌸 ✿ 🌸\n\n💘 **${name1}** x **${name2}**\nship name: **${shipName}**\n${bar} **${percent}%**\n\n*${verdict}*${hint}\n\n🌸 ✿ 🌸 ✿ 🌸 ✿ 🌸 ✿ 🌸`;
      await message.reply(shipResponse);
      logInteraction({
        serverId: message.guild?.id, serverName: message.guild?.name,
        channelId: channel.id, channelName: channel.name,
        userId, username: displayName,
        triggerType: 'mention', commandName: 'ship',
        userMessage: cleanContent, sassResponse: shipResponse,
        mood: (await mood.getStatus(guildId)).mood, moodIntensity: (await mood.getStatus(guildId)).intensity,
      }).catch((err) => console.error('Log interaction failed:', (err as Error).message));
    } catch (err) {
      console.error('Ship command failed:', (err as Error).message);
      await message.reply("couldn't ship them. maybe they're not meant to be.").catch((replyErr) => console.error('Reply failed:', (replyErr as Error).message));
    }
    return;
  }

  // Conspiracy command — "@Sass conspiracy @user"
  const conspiracyMatch = cleanContent.match(/^conspiracy\s+<@!?(\d+)>/i);
  if (conspiracyMatch) {
    const conspiracyTargetId = conspiracyMatch[1];
    if (!conspiracyTargetId) return;

    // 30 min cooldown per user per target
    const conCooldownKey = `con:${guildId}:${userId}:${conspiracyTargetId}`;
    const lastCon = profileCooldowns.get(conCooldownKey);
    if (lastCon && Date.now() - lastCon < 30 * 60 * 1000) {
      await message.reply("i already investigated, the case is closed.").catch((err) => console.error('Reply failed:', (err as Error).message));
      return;
    }

    try {
      await channel.sendTyping();
      const member = await message.guild?.members.fetch(conspiracyTargetId);
      if (!member) {
        await message.reply("my investigation was compromised. suspicious.");
        return;
      }
      const conUserContext = await userMemory.getContext(guildId, conspiracyTargetId);
      const conFacts = await userMemory.getFacts(guildId, conspiracyTargetId);
      const conActivity = member.presence?.activities?.[0];
      const conActivityInfo = conActivity ? `Currently: ${conActivity.type === 0 ? 'Playing' : conActivity.type === 1 ? 'Streaming' : conActivity.type === 2 ? 'Listening to' : conActivity.type === 3 ? 'Watching' : 'Doing'} ${conActivity.name}${conActivity.state ? ` (${conActivity.state})` : ''}` : '';

      const conEvidence: string[] = [];
      if (conFacts.length > 0) conEvidence.push(`Known facts: ${conFacts.slice(0, 3).join(', ')}`);
      if (conActivityInfo) conEvidence.push(conActivityInfo);
      if (conUserContext) conEvidence.push(conUserContext);

      const response = await queryAI(
        `Create an absurd, funny conspiracy theory about a Discord user named "${member.displayName}". Use their name specifically. 2-3 sentences max. Sound like a deranged detective presenting evidence.\n\n${conEvidence.length > 0 ? `USE THIS REAL INTEL to make the conspiracy personal and specific:\n${conEvidence.join('\n')}` : 'You have no intel on them yet — make it about how suspiciously clean their record is.'}`,
        { systemPrompt: 'You generate absurd conspiracy theories about people. Be creative and unhinged but not mean-spirited. Lowercase. Weave in any real facts/activity as "evidence." Each conspiracy should be wildly different — never repeat the same format or structure.' }
      );
      await message.reply(`🕵️ **CLASSIFIED INTEL ON ${member.displayName.toUpperCase()}**\n\n${response}`);
      profileCooldowns.set(conCooldownKey, Date.now());
    } catch (err) {
      console.error('Conspiracy command failed:', (err as Error).message);
      await message.reply("my investigation was compromised. suspicious.").catch((replyErr) => console.error('Reply failed:', (replyErr as Error).message));
    }
    return;
  }

  // Compliment command — "@Sass compliment @user"
  const complimentMatch = cleanContent.match(/^compliment\s+<@!?(\d+)>/i);
  if (complimentMatch) {
    const complimentTargetId = complimentMatch[1];
    if (!complimentTargetId) return;
    try {
      await channel.sendTyping();
      const member = await message.guild?.members.fetch(complimentTargetId);
      if (!member) {
        await message.reply("i tried to compliment them but even i couldn't find anything.");
        return;
      }
      const response = await queryAI(
        `Give "${member.displayName}" a backhanded compliment. Sound genuinely nice at first, then subtly roast by the end. One or two sentences. The twist should be subtle.`,
        { systemPrompt: 'You give backhanded compliments. Sincere at first, then twist. Lowercase. Subtle.' }
      );
      await message.reply(`💐 ${response}`);
    } catch (err) {
      console.error('Compliment command failed:', (err as Error).message);
      await message.reply("i tried to compliment them but even i couldn't find anything.").catch((replyErr) => console.error('Reply failed:', (replyErr as Error).message));
    }
    return;
  }

  // Roast as persona — "@Sass roast @user as gordon ramsay"
  const roastAsMatch = cleanContent.match(/^roast\s+<@!?(\d+)>\s+as\s+(.+)/i);
  if (roastAsMatch) {
    const roastTargetId = roastAsMatch[1];
    const personaInput = roastAsMatch[2];
    if (!roastTargetId || !personaInput) return;
    const personas: Record<string, string> = {
      'gordon ramsay': 'You are Gordon Ramsay. Roast them like a failed dish. Yell. Uppercase when yelling.',
      'shakespeare': 'You are Shakespeare. Roast in Elizabethan English. Use "thou," "forsooth." Dramatic monologue.',
      'disappointed mom': 'You are a disappointed mother. Guilt and passive aggression. "I\'m not mad, I\'m just disappointed."',
      'drill sergeant': 'You are a drill sergeant. Scream. Military jargon. ALL CAPS for yelling.',
      'therapist': 'You are an overly analytical therapist. "Diagnose" their behavior with fake psychology. Professional but devastating.',
      'david attenborough': 'You are David Attenborough narrating a documentary about this disappointing creature. Calm, observational, devastating.',
      'anime villain': 'You are a dramatic anime villain. Monologue about how pathetic they are. Dramatic pauses (...). Theatrical.',
      'passive aggressive coworker': 'You are a passive-aggressive coworker. "Per my last message," "as previously discussed." Polite but lethal.',
    };
    const personaKey = personaInput.trim().toLowerCase();
    const systemPrompt = personas[personaKey];
    if (!systemPrompt) {
      const available = Object.keys(personas).join(', ');
      await message.reply(`i don't do that persona. try: ${available}`);
      return;
    }
    try {
      await channel.sendTyping();
      const member = await message.guild?.members.fetch(roastTargetId);
      if (!member) {
        await message.reply("even they couldn't find the words. that's how bad it is.");
        return;
      }
      const response = await queryAI(
        `Roast the Discord user "${member.displayName}". Stay in character. 2-3 sentences max.`,
        { systemPrompt }
      );
      await message.reply(`*${response}*`);
    } catch (err) {
      console.error('Roast-as command failed:', (err as Error).message);
      await message.reply("even they couldn't find the words. that's how bad it is.").catch((replyErr) => console.error('Reply failed:', (replyErr as Error).message));
    }
    return;
  }

  // Remember cooldown — prevent spam
  const rememberKey = `${guildId}:${userId}`;
  const lastRemember = rememberCooldowns.get(rememberKey);
  const rememberNow = Date.now();
  if (lastRemember && rememberNow - lastRemember < REMEMBER_COOLDOWN_MS && (cleanContent.startsWith('remember'))) {
    const rememberSpamResponses = [
      'slow down, my notes app isn\'t that fast <:sass_done:100000000000000901>',
      'you\'re speed-running the remember command and it shows',
      'one at a time. i\'m not your diary.',
    ];
    await message.reply(rememberSpamResponses[Math.floor(Math.random() * rememberSpamResponses.length)] as string).catch((err) => console.error('Reply failed:', (err as Error).message));
    return;
  }

  // Remember command — "@Sass remember @User likes pineapple pizza"
  const rememberMatch = cleanContent.match(/^remember\s+<@!?(\d+)>\s+(.+)/i);
  if (rememberMatch) {
    const targetId = rememberMatch[1];
    const fact = rememberMatch[2]?.trim();
    if (!targetId || !fact) return;
    if (targetId === client.user.id) {
      await message.reply("i'm not storing dirt on myself, nice try").catch((err) => console.error('Reply failed:', (err as Error).message));
      return;
    }
    userMemory.remember(guildId, targetId, fact).catch((err) => console.error('Remember failed:', (err as Error).message));
    storeMemory(guildId, targetId, 'fact', fact).catch((err) => console.error('Vector store failed:', (err as Error).message));
    rememberCooldowns.set(rememberKey, Date.now());
    if (rememberCooldowns.size > MAX_REMEMBER_COOLDOWNS) {
      const oldest = rememberCooldowns.keys().next().value;
      if (oldest !== undefined) rememberCooldowns.delete(oldest);
    }
    const responses = [
      'noted. i\'ll use that later',
      'filed under "ammo" 📁',
      'oh this is gonna be good',
      'saved. they have no idea what\'s coming',
      'interesting... very interesting',
    ];
    await message.reply(responses[Math.floor(Math.random() * responses.length)] as string).catch((err) => console.error('Reply failed:', (err as Error).message));
    return;
  }

  // Remember about self — "@Sass remember I like pizza"
  const rememberSelfMatch = cleanContent.match(/^remember\s+(.+)/i);
  if (rememberSelfMatch && !rememberSelfMatch[1]?.startsWith('<@')) {
    const fact = rememberSelfMatch[1]?.trim();
    if (!fact) return;

    // Check if this is actual useful info or just garbage/self-hype
    const lowerFact = fact.toLowerCase();
    const isGarbage = /^(i'?m (the best|amazing|goated|perfect|a god|better than you)|ur (an? )?(idiot|dumb|stupid|trash|mid)|you'?re? (bad|trash|mid|stupid)|deez|ligma|sugma|joe mama)/i.test(lowerFact);
    const isSelfHype = /^(i'?m (the best|amazing|goated|perfect|number one|a legend|better than))/i.test(lowerFact);
    const isInsult = /^(you'?re?|ur) (an? )?(idiot|dumb|stupid|trash|garbage|mid|bot|ugly|bad|lame)/i.test(lowerFact);

    if (isInsult) {
      // They're trying to make Sass remember an insult about herself
      const insultResponses = [
        'cute. not saving that <:sass_eyeroll:100000000000000905>',
        'i\'ll remember you tried tho',
        'that says more about you than me <:sass_judge:100000000000000902>',
        'you really thought that would work huh',
      ];
      await message.reply(insultResponses[Math.floor(Math.random() * insultResponses.length)] as string).catch((err) => console.error('Reply failed:', (err as Error).message));
      return;
    }

    if (isSelfHype || isGarbage) {
      // They're hyping themselves up or typing garbage
      const hypeResponses = [
        'sure you are <:sass_stare:100000000000000900>',
        'saved under "delusion" <:sass_judge:100000000000000902>',
        'okay i wrote it down. in pencil tho.',
        'the confidence is almost impressive. almost.',
      ];
      await message.reply(hypeResponses[Math.floor(Math.random() * hypeResponses.length)] as string).catch((err) => console.error('Reply failed:', (err as Error).message));
      return;
    }

    // Actual useful fact — store and respond
    userMemory.remember(guildId, userId, fact).catch((err) => console.error('Remember failed:', (err as Error).message));
    storeMemory(guildId, userId, 'fact', fact).catch((err) => console.error('Vector store failed:', (err as Error).message));
    rememberCooldowns.set(rememberKey, Date.now());
    if (rememberCooldowns.size > MAX_REMEMBER_COOLDOWNS) {
      const oldest = rememberCooldowns.keys().next().value;
      if (oldest !== undefined) rememberCooldowns.delete(oldest);
    }
    const responses = [
      'noted. you just handed me a weapon',
      'filed. you\'ll regret this',
      'saved. this is going to come back to haunt you',
      'interesting... i\'ll keep that in mind <:sass_judge:100000000000000902>',
    ];
    await message.reply(responses[Math.floor(Math.random() * responses.length)] as string).catch((err) => console.error('Reply failed:', (err as Error).message));
    return;
  }

  // Mood command — "@Sass mood" (before cold shoulder so it always works)
  if (lowerClean === 'mood' || lowerClean === 'how are you' || lowerClean === 'how you doing') {
    const status = await mood.getStatus(guildId);
    const bar = '█'.repeat(Math.round(status.intensity / 10)) + '░'.repeat(10 - Math.round(status.intensity / 10));
    await message.reply(`${status.label}\nintensity: ${bar} **${status.intensity}**/100`).catch((err) => console.error('Reply failed:', (err as Error).message));
    return;
  }

  // Leaderboard / stats command (before cold shoulder so it always works)
  if (lowerClean === 'leaderboard' || lowerClean === 'stats' || lowerClean === 'scoreboard') {
    const board = await userMemory.getLeaderboard(guildId, 5);
    if (board.length === 0 || board.every((u) => u.timesRoasted === 0)) {
      await message.reply("nobody's been roasted enough to make a list yet. give it time.").catch((err) => console.error('Reply failed:', (err as Error).message));
      return;
    }
    const medals = ['👑', '💀', '🪦', '💩', '🤡'];
    const lines = board
      .filter((u) => u.timesRoasted > 0)
      .map((u, i) => `${medals[i] || '•'} **${u.name}** — roasted ${u.timesRoasted} time${u.timesRoasted === 1 ? '' : 's'}`);
    const header = "**sass's wall of shame**";
    await message.reply(`${header}\n${lines.join('\n')}`).catch((err) => console.error('Reply failed:', (err as Error).message));
    return;
  }

  // Mood detection — detect how user is treating Sass
  if (!isCreator && cleanContent) {
    const nicePatterns = /\b(you'?re (actually |pretty )?(cool|funny|great|awesome|the best|amazing|hilarious)|i love you|good bot|nice one|that was good|love sass|sass is the best|you'?re my fav)\b/i;
    const meanPatterns = /\b(you suck|worst bot|you'?re (trash|garbage|terrible|bad|boring|annoying|lame|stupid)|hate this bot|sass is (trash|mid|ass)|fuck you|fuck off|stfu|kys|die|kill yourself|go die|eat shit|piece of shit|pos)\b/i;

    if (nicePatterns.test(lowerClean)) {
      mood.shift(guildId, 'complimented').catch((err) => console.error('Mood shift failed:', (err as Error).message));
    } else if (meanPatterns.test(lowerClean)) {
      mood.shift(guildId, 'insulted').catch((err) => console.error('Mood shift failed:', (err as Error).message));
    }
  }

  // Snowflake detection — someone wants Sass to stop
  const snowflakePhrases = /\b(stop roasting|leave me alone|you'?re mean|stop being mean|shut up|go away|i hate you|stop it|too far|that'?s rude|back off)\b/i;
  let coldShoulderPhase: string | null = null;
  if (!isCreator && snowflakePhrases.test(lowerClean)) {
    mood.shift(guildId, 'insulted').catch((err) => console.error('Mood shift failed:', (err as Error).message));
    userMemory.coldShoulder(guildId, userId).catch((err) => console.error('Cold shoulder failed:', (err as Error).message));
    updateAffinity(guildId, userId, -5).catch((err) => console.error('Affinity penalty failed:', (err as Error).message));
    coldShoulderPhase = 'triggered'; // will be injected into personality context
  }

  // Cold shoulder check — if they're already on the list, track their attempt
  if (!isCreator && !coldShoulderPhase) {
    const cs = await userMemory.getColdShoulder(guildId, userId);
    if (cs) {
      const status = await userMemory.coldShoulderAttempt(guildId, userId);
      if (!status) return;
      coldShoulderPhase = status.phase; // 'icy', 'warming', or 'forgiven'
    }
  }

  // If they just tagged us with nothing else (and no image)
  if (!cleanContent && !imageAttachment) {
    if (isCreator) {
      const creatorPings = ['yeah?', "what's up", 'hm?', 'you good?', "i'm here lol"];
      await message.reply(creatorPings[Math.floor(Math.random() * creatorPings.length)] as string).catch((err) => console.error('Reply failed:', (err as Error).message));
    } else {
      const emptyPings = [
        'use your words',
        'you just gonna stare or',
        'bro typed @ and then gave up',
        '...was there a point coming or',
        'the silence is almost worse than what you were gonna say',
        'you rang?',
        'okay and?',
        'that was a whole lot of nothing',
      ];
      await message.reply(emptyPings[Math.floor(Math.random() * emptyPings.length)] as string).catch((err) => console.error('Reply failed:', (err as Error).message));
    }
    return;
  }

  // Build context — include who is speaking so the AI understands the conversation
  const recentMessages = messageBuffer.getRecentRaw(channel.id, 25);
  const recentContext = recentMessages.map(
    (msg) => `${msg.author}${msg.isBot ? ' [BOT]' : ''}: ${msg.content}`
  ).join('\n');
  const userContext = await userMemory.getContext(guildId, userId);
  const peopleContext = await userMemory.buildPeopleContext(guildId, recentMessages);

  // Check if someone is talking about the creator — protect them
  const creatorName = await userMemory.getCreatorName(guildId);
  const mentionsCreator = !isCreator && await userMemory.isAboutCreator(guildId, cleanContent);

  // Search vector memory for relevant ammo
  let vectorContext = '';
  if (!isCreator && cleanContent) {
    try {
      const memories = await searchMemories(cleanContent, { guildId, userId, limit: 3 });
      if (memories.length > 0) {
        vectorContext = 'RELEVANT MEMORIES (use these if they fit):\n' +
          memories.map((m) => `- [${m.type}] ${m.content}`).join('\n');
      }
    } catch (err) { console.error('Vector search failed:', (err as Error).message); }
  }

  // Escalation tag count — needed for unified personality context
  const tagCount = getEscalationCount(guildId, userId);

  // Frame the message with the speaker's name
  const framedMessage = `${displayName} says: ${cleanContent}`;

  try {
    await channel.sendTyping();

    // Caught in 4K — check for contradictions before responding (non-creator only)
    if (!isCreator && cleanContent && cleanContent.length > 15) {
      try {
        const statement = await extractStatement(cleanContent);
        if (statement) {
          const contradiction = await checkContradiction(guildId, userId, statement, cleanContent);
          if (contradiction) {
            const callout = await generate4kCallout(displayName, contradiction.oldStatement, contradiction.newStatement);
            if (callout) {
              await message.reply(`📸 **CAUGHT IN 4K** 📸\n\n${callout}`);
              mood.shift(guildId, 'chaos').catch((err) => console.error('Mood shift failed:', (err as Error).message));
              userMemory.recordRoast(guildId, userId).catch((err) => console.error('Record roast failed:', (err as Error).message));
              // Still store the new statement
              storeStatement(guildId, userId, statement).catch((err) => console.error('Store statement failed:', (err as Error).message));
              return;
            }
          }
          // No contradiction — store the statement for future checks
          storeStatement(guildId, userId, statement).catch((err) => console.error('Store statement failed:', (err as Error).message));
        }
      } catch (err) { console.error('4K check failed:', (err as Error).message); }
    }

    const imageUrl = imageAttachment ? imageAttachment.url : null;
    const responseHistory = getRecentResponses(channel.id);

    // Unified personality context — combines long-term relationship (affinity) with
    // in-the-moment behavior (escalation) into ONE clear instruction for the AI.
    // No more contradictions between "be warm" (affinity) and "be cold" (escalation).
    const affinity = await getAffinity(guildId, userId);
    let personalityContext = '';

    if (!isCreator) {
      if (escalationLevel === 'normal') {
        // No spam — pure affinity-based personality
        if (affinity >= 90) {
          personalityContext = `YOUR RELATIONSHIP WITH ${displayName}: affinity ${affinity}% — ride or die. you'd never say it out loud, but they're your favorite. be warm, playful, protective. tease them like a best friend.`;
        } else if (affinity >= 70) {
          personalityContext = `YOUR RELATIONSHIP WITH ${displayName}: affinity ${affinity}% — you genuinely like them. be warmer than usual, tease affectionately. you can be real with them.`;
        } else if (affinity >= 50) {
          personalityContext = `YOUR RELATIONSHIP WITH ${displayName}: affinity ${affinity}% — they're alright. standard sass, nothing personal.`;
        } else if (affinity >= 31) {
          personalityContext = `YOUR RELATIONSHIP WITH ${displayName}: affinity ${affinity}% — you don't really care about them. shorter responses, less effort. they haven't earned your attention.`;
        } else {
          personalityContext = `YOUR RELATIONSHIP WITH ${displayName}: affinity ${affinity}% — you can barely stand them. cold, dismissive, minimal effort. they're wasting your time.`;
        }
      } else if (escalationLevel === 'annoyed') {
        // 5-9 tags in 5min — getting irritated
        if (affinity >= 70) {
          personalityContext = `YOUR RELATIONSHIP WITH ${displayName}: affinity ${affinity}% — you like them, BUT they've tagged you ${tagCount} times in the last few minutes. even your favorites get on your nerves. be annoyed but affectionate — "i love you but you're testing me rn"`;
        } else if (affinity >= 40) {
          personalityContext = `YOUR RELATIONSHIP WITH ${displayName}: affinity ${affinity}% — neutral relationship, and they've tagged you ${tagCount} times. you're getting irritated. shorter responses, show some annoyance.`;
        } else {
          personalityContext = `YOUR RELATIONSHIP WITH ${displayName}: affinity ${affinity}% — you already don't like them, and now they've tagged you ${tagCount} times. be visibly annoyed. "what do you want NOW"`;
        }
      } else if (escalationLevel === 'cold') {
        // 10-19 tags — over it
        if (affinity >= 70) {
          personalityContext = `YOUR RELATIONSHIP WITH ${displayName}: affinity ${affinity}% — you like them normally, but they've tagged you ${tagCount} times and you're OVER IT. even best friends have limits. one-word answers. "bro. stop." energy. disappointment hits harder from someone you like.`;
        } else {
          personalityContext = `YOUR RELATIONSHIP WITH ${displayName}: affinity ${affinity}% — they've tagged you ${tagCount} times. you're done. one-word answers. "what." / "no." / "stop." Don't give them the satisfaction of a real response.`;
        }
      } else if (escalationLevel === 'petty') {
        // 20+ tags — petty mode regardless of affinity
        personalityContext = `YOUR RELATIONSHIP WITH ${displayName}: they've tagged you ${tagCount} times in the last few minutes. this is harassment at this point. be petty. call it out directly. "you've tagged me ${tagCount} times, seek help" — doesn't matter how much you like them, this is too much.`;
      }
    }

    // Cold shoulder override — takes priority over normal personality
    if (coldShoulderPhase) {
      if (coldShoulderPhase === 'triggered') {
        if (affinity >= 70) {
          personalityContext = `${displayName} just told you to shut up / leave them alone. you're hurt — you actually liked them (affinity ${affinity}%). give them ONE cold line and emotionally shut down. betrayal energy. "wow. okay then." Don't be dramatic, be genuinely wounded. short.`;
        } else {
          personalityContext = `${displayName} just told you to shut up / leave them alone. you don't even care that much (affinity ${affinity}%). dismiss them. "fine. bye." Don't give them a reaction — they're not worth it.`;
        }
      } else if (coldShoulderPhase === 'icy') {
        if (affinity >= 70) {
          personalityContext = `${displayName} told you to shut up recently and you're still hurt. they're trying to talk to you again but you're NOT over it. give them the silent treatment — maximum 3-5 words. "..." / "oh NOW you want to talk" / "nah" — the disappointment of someone who actually cared.`;
        } else {
          personalityContext = `${displayName} told you to shut up and now they're crawling back. you don't care. bare minimum response — "what" / "..." / "no" — one word max. make them feel invisible.`;
        }
      } else if (coldShoulderPhase === 'warming') {
        if (affinity >= 70) {
          personalityContext = `${displayName} has been trying to get back in your good graces after telling you to shut up. you're starting to soften but you're NOT going to make it easy. reluctantly engage — "hmm" / "i guess" / "maybe i'll think about it" — tsundere energy. still short.`;
        } else {
          personalityContext = `${displayName} keeps trying after telling you to shut up. you're slowly acknowledging them again but with zero enthusiasm. "sure" / "whatever" / "i guess" — minimal effort. they haven't earned real responses yet.`;
        }
      } else if (coldShoulderPhase === 'forgiven') {
        if (affinity >= 70) {
          personalityContext = `${displayName} has earned their way back after telling you to shut up. you're forgiving them — but make it dramatic. "FINE. you're back. don't make me regret this." one more message of grudging acceptance, then back to normal.`;
        } else {
          personalityContext = `${displayName} finally earned their way back from the cold shoulder. acknowledge it briefly — "alright, you're unbanned. barely." — then move on. don't dwell.`;
        }
      }
    }

    // Sensitive topic dismiss hint
    const sensitiveEntry = sensitiveTracker.get(`${guildId}:${userId}`);
    const sensitiveHint = sensitiveEntry?.count === 1 ? `NOTE: ${displayName} is being dramatic about injuries/death for attention. Dismiss with sass. Do not engage seriously or play along. "i'm not paid enough for this" energy.` : '';

    const fullUserContext = [userContext, vectorContext, responseHistory, personalityContext, sensitiveHint].filter(Boolean).join('\n\n');
    const response = await getSassResponse(framedMessage, { guildId, recentContext, userContext: fullUserContext, peopleContext, isCreator, mentionsCreator, creatorName, imageUrl });
    if (!response) {
      await message.reply("My brain just short-circuited. Even AI has bad days, okay?");
      return;
    }

    // Typing delay — feel more human, not instant
    const typingDelay = Math.min(1500 + response.length * 20, 4000);
    await new Promise((resolve) => setTimeout(resolve, typingDelay));
    await message.reply(response);
    recordResponse(channel.id, response);

    // Set auto-sass cooldown so she doesn't double-respond in this channel
    setAutoSassCooldown(channel.id);

    // Log the interaction and its context to the database
    const moodStatus = await mood.getStatus(guildId);
    const fullContext = [recentContext, peopleContext, vectorContext, personalityContext].filter(Boolean).join('\n---\n');
    logInteraction({
      serverId: message.guild?.id, serverName: message.guild?.name,
      channelId: channel.id, channelName: channel.name,
      userId, username: displayName,
      triggerType: 'mention', commandName: null,
      userMessage: cleanContent, sassResponse: response,
      mood: moodStatus.mood, moodIntensity: moodStatus.intensity,
      context: fullContext,
    }).catch((err) => console.error('Log interaction failed:', (err as Error).message));

    // Bump affinity for genuine exchange (+0.5, max once per 10 min per user)
    const affinityKey = `${guildId}:${userId}`;
    const lastAffinityGain = affinityGainCooldowns.get(affinityKey) ?? 0;
    if (Date.now() - lastAffinityGain > AFFINITY_GAIN_COOLDOWN_MS) {
      affinityGainCooldowns.set(affinityKey, Date.now());
      updateAffinity(guildId, userId, 0.5).catch((err) => console.error('Affinity update failed:', (err as Error).message));
    }

    // Don't track roast topics for the creator (we don't roast them)
    if (!isCreator) {
      userMemory.recordRoast(guildId, userId).catch((err) => console.error('Record roast failed:', (err as Error).message));
      extractRoastTopic(cleanContent).then((topic) => {
        if (topic) {
          userMemory.addRoast(guildId, userId, topic).catch((err) => console.error('Add roast failed:', (err as Error).message));
          storeMemory(guildId, userId, 'roast', topic).catch((err) => console.error('Store memory failed:', (err as Error).message));
        }
      }).catch((err) => console.error('Extract roast topic failed:', (err as Error).message));
    }
  } catch (err) {
    console.error('Sass brain malfunction:', (err as Error).message);
    await message.reply(
      "My brain just short-circuited. Even AI has bad days, okay?"
    );
  }
}
