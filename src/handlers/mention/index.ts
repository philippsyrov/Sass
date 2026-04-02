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
import { getSassResponse, queryAI } from '../../ai/index.js';
import * as userMemory from '../../userMemory.js';
import { buildBaseContext } from '../../shared/contextBuilder.js';
import { handleResponse } from '../../shared/responsePipeline.js';
import { isOnMentionCooldown, setMentionCooldown, trackMentionEscalation, getEscalationCount } from '../../cooldown.js';
import { searchMemories } from '../../vectorMemory.js';
import { buildHelpPages } from '../../helpPages.js';
import * as mood from '../../mood.js';
import { extractStatement, checkContradiction, generate4kCallout, storeStatement } from '../../caughtIn4k.js';
import { updateAffinity, getAffinity } from '../../database/index.js';
import { getRecentResponses } from '../../responseMemory.js';
import { isSpamPing, isSensitiveTopic, isOnRememberCooldown, getSensitiveHint } from './spamDetection.js';
import { buildPersonalityContext } from './personality.js';
import { handleRemember } from './memoryOps.js';
import type { SassEvent } from '../../types.js';

/**
 * Handle direct @Sass mentions and replies to Sass.
 * Grabs recent context + user memory and fires back a sassy response.
 */
export async function handleMention(message: Message, client: Client, event?: SassEvent): Promise<void> {
  const userId = event?.userId ?? message.author.id;
  const displayName = event?.displayName ?? (message.author.displayName || message.author.username);
  const guildId = event?.guildId ?? message.guild?.id ?? '';

  if (!message.guild) return;

  // Cooldown — don't spam-reply to the same user
  if (isOnMentionCooldown(userId)) { console.log(`[SKIP] mention cooldown for ${userId.slice(-4)}`); return; }
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
  if (isSpamPing(guildId, userId, cleanContent, isCreator)) { console.log(`[SKIP] spam ping from ${userId.slice(-4)}`); return; }

  // --- Sensitive topic handling: disengage from drama bait ---
  const sensitiveResult = await isSensitiveTopic(message, guildId, userId, displayName, cleanContent, isCreator);
  if (sensitiveResult === 'ignore' || sensitiveResult === 'check-in') { console.log(`[SKIP] sensitive topic (${sensitiveResult}) for ${userId.slice(-4)}`); return; }

  // Help command — paginated embeds with button navigation
  if (lowerClean === 'help' || lowerClean === 'commands' || lowerClean === '?') {
    const botAvatar = client.user.displayAvatarURL({ size: 256 });
    const pages = buildHelpPages(botAvatar);

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('help_prev').setLabel('\u25C0').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('help_next').setLabel('\u25B6').setStyle(ButtonStyle.Secondary),
    );

    let currentPage = 0;
    const firstPage = pages[0];
    if (!firstPage) return;
    const reply = await message.reply({ embeds: [firstPage], components: [buttons] }).catch((err) => { console.error('Help reply failed:', (err as Error).message); return null; });
    if (!reply) return;

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
      await btn.update({ embeds: [page], components: [buttons] }).catch((err) => console.error('Help page update failed:', (err as Error).message));
    });

    collector.on('end', () => {
      const disabledButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('help_prev').setLabel('\u25C0').setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('help_next').setLabel('\u25B6').setStyle(ButtonStyle.Secondary).setDisabled(true),
      );
      reply.edit({ components: [disabledButtons] }).catch((err) => console.error('Failed to disable help buttons:', (err as Error).message));
    });

    return;
  }

  // Profile command — moved to /profile slash command
  if (lowerClean === 'profile' || lowerClean.match(/^profile\s/)) {
    await message.reply("profile is now a slash command! use `/profile @user` instead.").catch((err) => console.error('Reply failed:', (err as Error).message));
    return;
  }

  // Ship — moved to /ship slash command
  if (cleanContent.match(/^ship\s+<@/i)) {
    await message.reply("ship is a slash command! use `/ship @user1 @user2` instead.").catch((err) => console.error('Reply failed:', (err as Error).message));
    return;
  }

  // Compliment command — moved to /compliment slash command
  if (lowerClean.match(/^compliment\s/)) {
    await message.reply("compliment is now a slash command! use `/compliment @user` instead.").catch((err) => console.error('Reply failed:', (err as Error).message));
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
      await message.reply(`i don't do that persona. try: ${available}`).catch((err) => console.error('Persona list reply failed:', (err as Error).message));
      return;
    }
    try {
      await channel.sendTyping().catch((err) => console.error('sendTyping failed:', (err as Error).message));
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
  if (isOnRememberCooldown(guildId, userId) && cleanContent.startsWith('remember')) {
    const rememberSpamResponses = [
      'slow down, my notes app isn\'t that fast <:sass_done:100000000000000901>',
      'you\'re speed-running the remember command and it shows',
      'one at a time. i\'m not your diary.',
    ];
    await message.reply(rememberSpamResponses[Math.floor(Math.random() * rememberSpamResponses.length)] as string).catch((err) => console.error('Reply failed:', (err as Error).message));
    return;
  }

  // Remember commands — "@Sass remember ..." (both @user and self)
  const wasRemember = await handleRemember(message, client, guildId, userId, cleanContent);
  if (wasRemember) return;

  // Leaderboard / stats command (before cold shoulder so it always works)
  if (lowerClean === 'leaderboard' || lowerClean === 'stats' || lowerClean === 'scoreboard') {
    await message.reply("leaderboard is now a slash command! use `/leaderboard` instead.").catch((err) => console.error('Reply failed:', (err as Error).message));
    return;
  }

  // Mood detection — detect how user is treating Sass
  // Tiered: standard insults just shift mood, severe toxicity also penalizes affinity
  if (!isCreator && cleanContent) {
    const nicePatterns = /\b(you'?re (actually |pretty )?(cool|funny|great|awesome|the best|amazing|hilarious)|i love you|good bot|nice one|that was good|love sass|sass is the best|you'?re my fav)\b/i;
    const meanPatterns = /\b(you suck|worst bot|you'?re (trash|garbage|terrible|bad|boring|annoying|lame|stupid)|hate this bot|sass is (trash|mid|ass)|fuck you|fuck off|stfu|eat shit|piece of shit|pos)\b/i;
    const severeMeanPatterns = /\b(kys|kill yourself|go die)\b/i;

    if (nicePatterns.test(lowerClean)) {
      mood.shift(guildId, 'complimented').catch((err) => console.error('Mood shift failed:', (err as Error).message));
    } else if (severeMeanPatterns.test(lowerClean)) {
      mood.shift(guildId, 'insulted').catch((err) => console.error('Mood shift failed:', (err as Error).message));
      updateAffinity(guildId, userId, -3).catch((err) => console.error('Severe mean affinity penalty failed:', (err as Error).message));
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
  const { recentContext, peopleContext } = await buildBaseContext(guildId, channel.id, 25);
  const userContext = await userMemory.getContext(guildId, userId, displayName);

  // Check if someone is talking about the creator — protect them
  const creatorName = await userMemory.getCreatorName(guildId);
  const mentionsCreator = !isCreator && await userMemory.isAboutCreator(guildId, cleanContent);

  // Fetch vector memory and affinity in parallel — both are independent read-only ops
  const memoriesPromise = (!isCreator && cleanContent)
    ? searchMemories(cleanContent, { guildId, userId, limit: 3 }).catch((err) => {
        console.error('Vector search failed:', (err as Error).message);
        return [];
      })
    : Promise.resolve([]);
  const affinityPromise = getAffinity(guildId, userId);
  const [memories, affinity] = await Promise.all([memoriesPromise, affinityPromise]);

  let vectorContext = '';
  if (!isCreator && memories.length > 0) {
    vectorContext = `RELEVANT MEMORIES about ${displayName} (use these if they fit):\n` +
      memories.map((m) => `- [${m.type}] ${displayName}: ${m.content}`).join('\n');
  }

  // Escalation tag count — needed for unified personality context
  const tagCount = getEscalationCount(guildId, userId);

  // Frame the message with the speaker's name
  // Creator mode should receive the raw message, not a quoted "X says:" wrapper.
  // Otherwise the model can misread it like the creator is relaying someone else's words.
  const framedMessage = isCreator ? cleanContent : `${displayName} says: ${cleanContent}`;

  try {
    await channel.sendTyping().catch((err) => console.error('sendTyping failed:', (err as Error).message));

    // Caught in 4K — check for contradictions before responding (non-creator only)
    if (!isCreator && cleanContent && cleanContent.length > 15) {
      try {
        const statement = await extractStatement(cleanContent);
        if (statement) {
          const contradiction = await checkContradiction(guildId, userId, statement, cleanContent);
          if (contradiction) {
            const callout = await generate4kCallout(displayName, contradiction.oldStatement, contradiction.newStatement);
            if (callout) {
              await message.reply(`\u{1F4F8} **CAUGHT IN 4K** \u{1F4F8}\n\n${callout}`);
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
    let personalityContext = '';

    if (!isCreator) {
      personalityContext = buildPersonalityContext(displayName, escalationLevel, tagCount, affinity, coldShoulderPhase);
    }

    // Sensitive topic dismiss hint
    const sensitiveHint = getSensitiveHint(guildId, userId, displayName);

    const fullUserContext = [userContext, vectorContext, responseHistory, personalityContext, sensitiveHint].filter(Boolean).join('\n\n');
    const aiResult = await getSassResponse(framedMessage, { guildId, recentContext, userContext: fullUserContext, peopleContext, isCreator, mentionsCreator, creatorName, imageUrl });
    const response = aiResult.text;
    if (!response) {
      await message.reply("My brain just short-circuited. Even AI has bad days, okay?");
      return;
    }

    // Build SassEvent for pipeline (if not passed from messageCreate)
    const pipelineEvent: SassEvent = event ?? {
      guildId, channelId: channel.id, userId, displayName,
      content: cleanContent, isCreator, message, channel,
    };

    const fullContext = [recentContext, peopleContext, vectorContext, personalityContext].filter(Boolean).join('\n---\n');
    await handleResponse({
      event: pipelineEvent,
      response,
      aiResult,
      userMessage: cleanContent,
      triggerType: 'mention',
      onFiltered: 'fallback',
      sendMode: 'reply',
      trackRoast: !isCreator,
      updateAffinity: true,
      context: fullContext,
      affinity,
    });
  } catch (err) {
    console.error('Sass brain malfunction:', (err as Error).message);
    await message.reply(
      "My brain just short-circuited. Even AI has bad days, okay?"
    ).catch((replyErr) => console.error('Error fallback reply failed:', (replyErr as Error).message));
  }
}
