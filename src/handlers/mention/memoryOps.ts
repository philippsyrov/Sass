import type { Message, Client } from 'discord.js';
import * as userMemory from '../../userMemory.js';
import { storeMemory } from '../../vectorMemory.js';
import { setRememberCooldown } from './spamDetection.js';
import { pickRandom } from '../../shared/commandUtils.js';

/**
 * Handle "@Sass remember" commands — both "@Sass remember @user <fact>" and "@Sass remember <fact>".
 * Returns true if the message was a remember command (handled), false otherwise.
 */
export async function handleRemember(
  message: Message,
  client: Client,
  guildId: string,
  userId: string,
  cleanContent: string,
): Promise<boolean> {
  if (!client.user) return false;

  // Remember command — "@Sass remember @User likes pineapple pizza"
  const rememberMatch = cleanContent.match(/^remember\s+<@!?(\d+)>\s+(.+)/i);
  if (rememberMatch) {
    const targetId = rememberMatch[1];
    const fact = rememberMatch[2]?.trim();
    if (!targetId || !fact) return true;
    if (targetId === client.user.id) {
      await message.reply("i'm not storing dirt on myself, nice try").catch((err) => console.error('Reply failed:', (err as Error).message));
      return true;
    }
    userMemory.remember(guildId, targetId, fact).catch((err) => console.error('Remember failed:', (err as Error).message));
    storeMemory(guildId, targetId, 'fact', fact).catch((err) => console.error('Vector store failed:', (err as Error).message));
    setRememberCooldown(guildId, userId);
    const responses = [
      'noted. i\'ll use that later',
      'filed under "ammo" \u{1F4C1}',
      'oh this is gonna be good',
      'saved. they have no idea what\'s coming',
      'interesting... very interesting',
    ];
    await message.reply(pickRandom(responses)).catch((err) => console.error('Reply failed:', (err as Error).message));
    return true;
  }

  // Remember about self — "@Sass remember I like pizza"
  const rememberSelfMatch = cleanContent.match(/^remember\s+(.+)/i);
  if (rememberSelfMatch && !rememberSelfMatch[1]?.startsWith('<@')) {
    const fact = rememberSelfMatch[1]?.trim();
    if (!fact) return true;

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
      await message.reply(pickRandom(insultResponses)).catch((err) => console.error('Reply failed:', (err as Error).message));
      return true;
    }

    if (isSelfHype || isGarbage) {
      // They're hyping themselves up or typing garbage
      const hypeResponses = [
        'sure you are <:sass_stare:100000000000000900>',
        'saved under "delusion" <:sass_judge:100000000000000902>',
        'okay i wrote it down. in pencil tho.',
        'the confidence is almost impressive. almost.',
      ];
      await message.reply(pickRandom(hypeResponses)).catch((err) => console.error('Reply failed:', (err as Error).message));
      return true;
    }

    // Actual useful fact — store and respond
    userMemory.remember(guildId, userId, fact).catch((err) => console.error('Remember failed:', (err as Error).message));
    storeMemory(guildId, userId, 'fact', fact).catch((err) => console.error('Vector store failed:', (err as Error).message));
    setRememberCooldown(guildId, userId);
    const responses = [
      'noted. you just handed me a weapon',
      'filed. you\'ll regret this',
      'saved. this is going to come back to haunt you',
      'interesting... i\'ll keep that in mind <:sass_judge:100000000000000902>',
    ];
    await message.reply(pickRandom(responses)).catch((err) => console.error('Reply failed:', (err as Error).message));
    return true;
  }

  return false;
}
