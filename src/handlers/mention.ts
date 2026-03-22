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
import { userMemory } from '../userMemory.js';
import { isOnMentionCooldown, setMentionCooldown, trackMentionEscalation, getEscalationCount } from '../cooldown.js';
import { storeMemory, searchMemories } from '../vectorMemory.js';
import { buildHelpPages } from '../helpPages.js';
import { mood } from '../mood.js';
import { extractStatement, checkContradiction, generate4kCallout, storeStatement } from '../caughtIn4k.js';
import { logInteraction, logCommand } from '../database.js';
import { recordResponse, getRecentResponses } from '../responseMemory.js';

/**
 * Handle direct @Sass mentions and replies to Sass.
 * Grabs recent context + user memory and fires back a sassy response.
 */
export async function handleMention(message: Message, client: Client): Promise<void> {
  const userId = message.author.id;
  const displayName = message.author.displayName || message.author.username;

  // Cooldown — don't spam-reply to the same user
  if (isOnMentionCooldown(userId)) return;
  setMentionCooldown(userId);

  if (!client.user) return;

  // Track escalation — how much this user has been tagging Sass recently
  const escalationLevel = trackMentionEscalation(userId);

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
      const percent = Math.floor(Math.random() * 99);
      const bar = '❤️'.repeat(Math.round(percent / 10)) + '🖤'.repeat(10 - Math.round(percent / 10));
      const shipName = name1.slice(0, Math.ceil(name1.length / 2)) + name2.slice(Math.floor(name2.length / 2));
      const verdict = await queryAI(
        `"${name1}" x "${name2}" at ${percent}%. ONE sentence verdict, max 12 words. No metaphors or object comparisons. React like a friend judging a couple.`,
        { systemPrompt: 'You judge ship compatibility. ONE short sentence. Max 12 words. Lowercase. Talk like a 20-year-old, not a poet. No "chemistry of a [object]" comparisons.' }
      );
      const shipResponse = `💘 **${name1}** x **${name2}**\nship name: **${shipName}**\n${bar} **${percent}%**\n\n*${verdict}*`;
      await message.reply(shipResponse);
      logInteraction({
        serverId: message.guild?.id, serverName: message.guild?.name,
        channelId: channel.id, channelName: channel.name,
        userId, username: displayName,
        triggerType: 'mention', commandName: 'ship',
        userMessage: cleanContent, sassResponse: shipResponse,
        mood: mood.getStatus().mood, moodIntensity: mood.getStatus().intensity,
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
    try {
      await channel.sendTyping();
      const member = await message.guild?.members.fetch(conspiracyTargetId);
      if (!member) {
        await message.reply("my investigation was compromised. suspicious.");
        return;
      }
      const conUserContext = userMemory.getContext(conspiracyTargetId);
      const conFacts = userMemory.getFacts(conspiracyTargetId);
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
    userMemory.remember(targetId, fact);
    storeMemory(targetId, 'fact', fact).catch((err) => console.error('Vector store failed:', (err as Error).message));
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
    userMemory.remember(userId, fact);
    storeMemory(userId, 'fact', fact).catch((err) => console.error('Vector store failed:', (err as Error).message));
    const responses = [
      'noted. you just handed me a weapon',
      'filed. you\'ll regret this',
      'saved. this is going to come back to haunt you',
      'okay i\'ll remember that... for my own reasons',
    ];
    await message.reply(responses[Math.floor(Math.random() * responses.length)] as string).catch((err) => console.error('Reply failed:', (err as Error).message));
    return;
  }

  // Mood command — "@Sass mood" (before cold shoulder so it always works)
  if (lowerClean === 'mood' || lowerClean === 'how are you' || lowerClean === 'how you doing') {
    const status = mood.getStatus();
    const bar = '█'.repeat(Math.round(status.intensity / 10)) + '░'.repeat(10 - Math.round(status.intensity / 10));
    await message.reply(`${status.label}\nintensity: ${bar} **${status.intensity}**/100`).catch((err) => console.error('Reply failed:', (err as Error).message));
    return;
  }

  // Leaderboard / stats command (before cold shoulder so it always works)
  if (lowerClean === 'leaderboard' || lowerClean === 'stats' || lowerClean === 'scoreboard') {
    const board = userMemory.getLeaderboard(5);
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
    const meanPatterns = /\b(you suck|worst bot|you'?re (trash|garbage|terrible|bad|boring|annoying|lame|stupid)|hate this bot|sass is (trash|mid|ass))\b/i;

    if (nicePatterns.test(lowerClean)) {
      mood.shift('complimented');
    } else if (meanPatterns.test(lowerClean)) {
      mood.shift('insulted');
    }
  }

  // Snowflake detection — someone wants Sass to stop
  const snowflakePhrases = /\b(stop roasting|leave me alone|you'?re mean|stop being mean|shut up|go away|i hate you|stop it|too far|that'?s rude|back off)\b/i;
  if (!isCreator && snowflakePhrases.test(lowerClean)) {
    mood.shift('insulted');
    userMemory.coldShoulder(userId);
    const coldResponses = [
      'fine. you\'re dead to me now',
      'lol okay. don\'t come crawling back',
      'wow can\'t even handle a little sass. noted.',
      'aight bet. see how boring it is without me',
      'imagine being this soft. goodbye.',
    ];
    await message.reply(coldResponses[Math.floor(Math.random() * coldResponses.length)] as string).catch((err) => console.error('Reply failed:', (err as Error).message));
    return;
  }

  // Cold shoulder check — if they're on the list, make them work for it
  if (!isCreator) {
    const cs = userMemory.getColdShoulder(userId);
    if (cs) {
      const status = userMemory.coldShoulderAttempt(userId);
      if (!status) return;
      if (status.phase === 'icy') {
        const icyResponses = [
          '...',
          'oh you\'re talking to me now?',
          'thought you didn\'t want this',
          'nah',
          '*seen*',
          'lol no',
        ];
        await message.reply(icyResponses[Math.floor(Math.random() * icyResponses.length)] as string).catch((err) => console.error('Reply failed:', (err as Error).message));
        return;
      }
      if (status.phase === 'warming') {
        const warmingResponses = [
          'hmm... maybe',
          'you\'re getting warmer i guess',
          'i\'m thinking about it',
          'keep trying',
          'almost... not quite though',
        ];
        await message.reply(warmingResponses[Math.floor(Math.random() * warmingResponses.length)] as string).catch((err) => console.error('Reply failed:', (err as Error).message));
        return;
      }
      if (status.phase === 'forgiven') {
        const forgivenResponses = [
          'FINE. you\'re back. don\'t make me regret this',
          'okay okay you earned it. welcome back loser',
          'ugh. i guess i missed roasting you. a little.',
          'alright you\'re unbanned. try not to cry this time',
        ];
        await message.reply(forgivenResponses[Math.floor(Math.random() * forgivenResponses.length)] as string).catch((err) => console.error('Reply failed:', (err as Error).message));
        return;
      }
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
  const recentMessages = messageBuffer.getRecentRaw(channel.id, 20);
  const recentContext = recentMessages.map(
    (msg) => `${msg.author}${msg.isBot ? ' [BOT]' : ''}: ${msg.content}`
  ).join('\n');
  const userContext = userMemory.getContext(userId);
  const peopleContext = userMemory.buildPeopleContext(recentMessages);

  // Check if someone is talking about the creator — protect them
  const creatorName = userMemory.getCreatorName();
  const mentionsCreator = !isCreator && userMemory.isAboutCreator(cleanContent);

  // Search vector memory for relevant ammo
  let vectorContext = '';
  if (!isCreator && cleanContent) {
    try {
      const memories = await searchMemories(cleanContent, { userId, limit: 3 });
      if (memories.length > 0) {
        vectorContext = 'RELEVANT MEMORIES (use these if they fit):\n' +
          memories.map((m) => `- [${m.type}] ${m.content}`).join('\n');
      }
    } catch (err) { console.error('Vector search failed:', (err as Error).message); }
  }

  // Escalation context — tell the AI how much this person has been tagging
  let escalationContext = '';
  if (!isCreator && escalationLevel !== 'normal') {
    const tagCount = getEscalationCount(userId);
    if (escalationLevel === 'annoyed') {
      escalationContext = `NOTE: ${displayName} has tagged you ${tagCount} times in the last few minutes. You're getting annoyed. Be shorter, more dismissive. Show some irritation.`;
    } else if (escalationLevel === 'cold') {
      escalationContext = `NOTE: ${displayName} has tagged you ${tagCount} times in the last few minutes. You're over it. Be cold and dismissive. One-word answers. "what." / "again?" / "you're still here?" energy.`;
    } else if (escalationLevel === 'petty') {
      escalationContext = `NOTE: ${displayName} has tagged you ${tagCount} times in the last few minutes. This is excessive. Be petty about it. Call out how much they're tagging you. "bro you've tagged me ${tagCount} times, get a hobby" type energy.`;
    }
  }

  // Frame the message with the speaker's name
  const framedMessage = `${displayName} says: ${cleanContent}`;

  try {
    await channel.sendTyping();

    // Caught in 4K — check for contradictions before responding (non-creator only)
    if (!isCreator && cleanContent && cleanContent.length > 15) {
      try {
        const statement = await extractStatement(cleanContent);
        if (statement) {
          const contradiction = await checkContradiction(userId, statement, cleanContent);
          if (contradiction) {
            const callout = await generate4kCallout(displayName, contradiction.oldStatement, contradiction.newStatement);
            if (callout) {
              await message.reply(`📸 **CAUGHT IN 4K** 📸\n\n${callout}`);
              mood.shift('chaos');
              userMemory.recordRoast(userId);
              // Still store the new statement
              storeStatement(userId, statement).catch((err) => console.error('Store statement failed:', (err as Error).message));
              return;
            }
          }
          // No contradiction — store the statement for future checks
          storeStatement(userId, statement).catch((err) => console.error('Store statement failed:', (err as Error).message));
        }
      } catch (err) { console.error('4K check failed:', (err as Error).message); }
    }

    const imageUrl = imageAttachment ? imageAttachment.url : null;
    const responseHistory = getRecentResponses(channel.id);
    const fullUserContext = [userContext, vectorContext, responseHistory, escalationContext].filter(Boolean).join('\n\n');
    const response = await getSassResponse(framedMessage, { recentContext, userContext: fullUserContext, peopleContext, isCreator, mentionsCreator, creatorName, imageUrl });
    if (!response) {
      await message.reply("My brain just short-circuited. Even AI has bad days, okay?");
      return;
    }

    // Typing delay — feel more human, not instant
    const typingDelay = Math.min(1500 + response.length * 20, 4000);
    await new Promise((resolve) => setTimeout(resolve, typingDelay));
    await message.reply(response);
    recordResponse(channel.id, response);

    // Log to database
    const moodStatus = mood.getStatus();
    logInteraction({
      serverId: message.guild?.id, serverName: message.guild?.name,
      channelId: channel.id, channelName: channel.name,
      userId, username: displayName,
      triggerType: 'mention', commandName: null,
      userMessage: cleanContent, sassResponse: response,
      mood: moodStatus.mood, moodIntensity: moodStatus.intensity,
    }).catch((err) => console.error('Log interaction failed:', (err as Error).message));

    // Don't track roast topics for the creator (we don't roast them)
    if (!isCreator) {
      userMemory.recordRoast(userId);
      extractRoastTopic(cleanContent).then((topic) => {
        if (topic) {
          userMemory.addRoast(userId, topic);
          storeMemory(userId, 'roast', topic).catch((err) => console.error('Store memory failed:', (err as Error).message));
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
