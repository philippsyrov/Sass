import { EmbedBuilder } from 'discord.js';
import { getSassResponse, extractRoastTopic, analyzeProfile } from '../ai.js';
import { messageBuffer } from '../messageBuffer.js';
import { userMemory } from '../userMemory.js';
import { isOnMentionCooldown, setMentionCooldown } from '../cooldown.js';
import { storeMemory, searchMemories } from '../vectorMemory.js';

/**
 * Handle direct @Sass mentions and replies to Sass.
 * Grabs recent context + user memory and fires back a sassy response.
 */
export async function handleMention(message, client) {
  const userId = message.author.id;
  const displayName = message.author.displayName || message.author.username;

  // Cooldown — don't spam-reply to the same user
  if (isOnMentionCooldown(userId)) return;
  setMentionCooldown(userId);

  // Strip the @mention to get the actual user message
  const cleanContent = message.content
    .replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '')
    .trim();

  // Check if this is the creator
  const isCreator = userId === process.env.CREATOR_ID;

  // Check for image attachments (jpg, png, gif, webp)
  const imageAttachment = message.attachments.find((a) =>
    a.contentType && a.contentType.startsWith('image/')
  );

  const lowerClean = cleanContent.toLowerCase();

  // Help command
  if (lowerClean === 'help' || lowerClean === 'commands' || lowerClean === '?') {
    const botAvatar = client.user.displayAvatarURL({ size: 256 });
    const embed = new EmbedBuilder()
      .setColor(0xFF4D6D)
      .setAuthor({ name: 'Sass', iconURL: botAvatar })
      .setThumbnail(botAvatar)
      .setDescription("here's everything i can do. use it wisely (you won't).")
      .addFields(
        { name: '💬 Chat', value: '`@Sass <anything>` — talk to me\n`/sass <message>` — same but fancier', inline: true },
        { name: '🧠 Memory', value: '`@Sass remember <fact>` — weaponize yourself\n`@Sass remember @user <fact>` — snitch', inline: true },
        { name: '\u200b', value: '\u200b', inline: false },
        { name: '📊 Stats', value: '`@Sass leaderboard` — wall of shame\n`@Sass profile [@user]` — diagnosis\n`/favorite` · `/halloffame` · `/beef`\n`/maincharacter` · `/wrapped`', inline: true },
        { name: '🎲 Fun', value: '`/8ball` · `/ship` · `/hottake`\n`/fortune` · `/quote` · `/npc`\n`/roastas` · `/translate` · `/horoscope`\n`/conspiracy` · `/compliment`\n`/status @user` — roast their status', inline: true },
        { name: '\u200b', value: '\u200b', inline: false },
        { name: '⚔️ Battle', value: '`/roastbattle @user` — PvP roast battle with AI judging', inline: false },
        { name: '⚠️ Fine Print', value: 'i jump into convos uninvited. tell me to stop and i\'ll ghost you until you beg.', inline: false },
      )
      .setFooter({ text: "i'm not a helper bot. i'm a problem.", iconURL: botAvatar })
      .setTimestamp();
    await message.reply({ embeds: [embed] });
    return;
  }

  // Profile command — "@Sass profile" or "@Sass profile @user"
  const profileMatch = lowerClean.match(/^profile\s*(?:<@!?(\d+)>)?$/);
  if (lowerClean === 'profile' || profileMatch) {
    const targetId = profileMatch?.[1] || userId;
    const targetUser = targetId === userId
      ? message.author
      : await message.guild.members.fetch(targetId).then((m) => m.user).catch(() => null);
    if (!targetUser) {
      await message.reply("can't find that person. they probably don't exist, like your taste");
      return;
    }
    const targetName = targetUser.displayName || targetUser.username;

    // Fetch recent messages from this channel by the target user
    try {
      await message.channel.sendTyping();
      const fetched = await message.channel.messages.fetch({ limit: 100 });
      const userMsgs = fetched
        .filter((m) => m.author.id === targetId && !m.author.bot)
        .map((m) => m.content)
        .filter((c) => c.length > 0)
        .reverse()
        .slice(0, 30);

      if (userMsgs.length < 3) {
        await message.reply(`${targetName} barely talks. can't profile a ghost.`);
        return;
      }

      const raw = await analyzeProfile(targetName, userMsgs.join('\n'));

      // Parse the response
      const lines = raw.trim().split('\n');
      const scores = {};
      let archetype = 'Unknown';
      let roast = '';
      for (const line of lines) {
        const [key, ...rest] = line.split(':');
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
      const bar = (score) => '█'.repeat(score) + '░'.repeat(10 - score);
      const profile = [
        `**${targetName}'s behavioral diagnosis**`,
        `> archetype: **${archetype}**`,
        '',
        `\`chaos \` ${bar(scores.chaos || 0)} **${scores.chaos || 0}**/10`,
        `\`thirst\` ${bar(scores.thirst || 0)} **${scores.thirst || 0}**/10`,
        `\`aggro \` ${bar(scores.aggro || 0)} **${scores.aggro || 0}**/10`,
        `\`clown \` ${bar(scores.clown || 0)} **${scores.clown || 0}**/10`,
        `\`brain \` ${bar(scores.brain || 0)} **${scores.brain || 0}**/10`,
        '',
        `*${roast}*`,
      ];
      await message.reply(profile.join('\n'));
    } catch (err) {
      console.error('Profile analysis failed:', err.message);
      await message.reply("my brain crashed trying to analyze this person. that says a lot honestly.");
    }
    return;
  }

  // Remember command — "@Sass remember @User likes pineapple pizza"
  const rememberMatch = cleanContent.match(/^remember\s+<@!?(\d+)>\s+(.+)/i);
  if (rememberMatch) {
    const targetId = rememberMatch[1];
    const fact = rememberMatch[2].trim();
    if (targetId === client.user.id) {
      await message.reply("i'm not storing dirt on myself, nice try");
      return;
    }
    userMemory.remember(targetId, fact);
    storeMemory(targetId, 'fact', fact).catch(() => {});
    const responses = [
      'noted. i\'ll use that later',
      'filed under "ammo" 📁',
      'oh this is gonna be good',
      'saved. they have no idea what\'s coming',
      'interesting... very interesting',
    ];
    await message.reply(responses[Math.floor(Math.random() * responses.length)]);
    return;
  }

  // Remember about self — "@Sass remember I like pizza"
  const rememberSelfMatch = cleanContent.match(/^remember\s+(.+)/i);
  if (rememberSelfMatch && !rememberSelfMatch[1].startsWith('<@')) {
    const fact = rememberSelfMatch[1].trim();
    userMemory.remember(userId, fact);
    storeMemory(userId, 'fact', fact).catch(() => {});
    const responses = [
      'noted. you just handed me a weapon',
      'filed. you\'ll regret this',
      'saved. this is going to come back to haunt you',
      'okay i\'ll remember that... for my own reasons',
    ];
    await message.reply(responses[Math.floor(Math.random() * responses.length)]);
    return;
  }

  // Snowflake detection — someone wants Sass to stop
  const snowflakePhrases = /\b(stop roasting|leave me alone|you'?re mean|stop being mean|shut up|go away|i hate you|stop it|too far|that'?s rude|back off)\b/i;
  if (!isCreator && snowflakePhrases.test(lowerClean)) {
    userMemory.coldShoulder(userId);
    const coldResponses = [
      'fine. you\'re dead to me now',
      'lol okay. don\'t come crawling back',
      'wow can\'t even handle a little sass. noted.',
      'aight bet. see how boring it is without me',
      'imagine being this soft. goodbye.',
    ];
    await message.reply(coldResponses[Math.floor(Math.random() * coldResponses.length)]);
    return;
  }

  // Cold shoulder check — if they're on the list, make them work for it
  if (!isCreator) {
    const cs = userMemory.getColdShoulder(userId);
    if (cs) {
      const status = userMemory.coldShoulderAttempt(userId);
      if (status.phase === 'icy') {
        const icyResponses = [
          '...',
          'oh you\'re talking to me now?',
          'thought you didn\'t want this',
          'nah',
          '*seen*',
          'lol no',
        ];
        await message.reply(icyResponses[Math.floor(Math.random() * icyResponses.length)]);
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
        await message.reply(warmingResponses[Math.floor(Math.random() * warmingResponses.length)]);
        return;
      }
      if (status.phase === 'forgiven') {
        const forgivenResponses = [
          'FINE. you\'re back. don\'t make me regret this',
          'okay okay you earned it. welcome back loser',
          'ugh. i guess i missed roasting you. a little.',
          'alright you\'re unbanned. try not to cry this time',
        ];
        await message.reply(forgivenResponses[Math.floor(Math.random() * forgivenResponses.length)]);
        return;
      }
    }
  }

  // Leaderboard / stats command
  if (lowerClean === 'leaderboard' || lowerClean === 'stats' || lowerClean === 'scoreboard') {
    const board = userMemory.getLeaderboard(5);
    if (board.length === 0 || board.every((u) => u.timesRoasted === 0)) {
      await message.reply("nobody's been roasted enough to make a list yet. give it time.");
      return;
    }
    const medals = ['👑', '💀', '🪦', '💩', '🤡'];
    const lines = board
      .filter((u) => u.timesRoasted > 0)
      .map((u, i) => `${medals[i] || '•'} **${u.name}** — roasted ${u.timesRoasted} time${u.timesRoasted === 1 ? '' : 's'}`);
    const header = "**sass's wall of shame**";
    await message.reply(`${header}\n${lines.join('\n')}`);
    return;
  }

  // If they just tagged us with nothing else (and no image)
  if (!cleanContent && !imageAttachment) {
    if (isCreator) {
      const creatorPings = ['yeah?', "what's up", 'hm?', 'you good?', "i'm here lol"];
      await message.reply(creatorPings[Math.floor(Math.random() * creatorPings.length)]);
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
      await message.reply(emptyPings[Math.floor(Math.random() * emptyPings.length)]);
    }
    return;
  }

  // Build context — include who is speaking so the AI understands the conversation
  const recentMessages = messageBuffer.getRecentRaw(message.channel.id, 10);
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
    } catch { /* vector search is non-critical */ }
  }

  // Frame the message with the speaker's name
  const framedMessage = `${displayName} says: ${cleanContent}`;

  try {
    await message.channel.sendTyping();
    const imageUrl = imageAttachment ? imageAttachment.url : null;
    const fullUserContext = [userContext, vectorContext].filter(Boolean).join('\n\n');
    const response = await getSassResponse(framedMessage, { recentContext, userContext: fullUserContext, peopleContext, isCreator, mentionsCreator, creatorName, imageUrl });
    await message.reply(response);

    // Don't track roast topics for the creator (we don't roast them)
    if (!isCreator) {
      userMemory.recordRoast(userId);
      extractRoastTopic(cleanContent).then((topic) => {
        if (topic) {
          userMemory.addRoast(userId, topic);
          storeMemory(userId, 'roast', topic).catch(() => {});
        }
      }).catch(() => {});
    }
  } catch (err) {
    console.error('Sass brain malfunction:', err.message);
    await message.reply(
      "My brain just short-circuited. Even AI has bad days, okay?"
    );
  }
}
