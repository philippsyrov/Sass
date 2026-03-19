import { getSassResponse, extractRoastTopic } from '../ai.js';
import { messageBuffer } from '../messageBuffer.js';
import { userMemory } from '../userMemory.js';
import { isOnMentionCooldown, setMentionCooldown } from '../cooldown.js';

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

  // If they just tagged us with nothing else
  if (!cleanContent) {
    if (isCreator) {
      await message.reply("heyyy bestie, what's up?");
    } else {
      await message.reply("You rang? Use your words, I don't do telepathy.");
    }
    return;
  }

  // Build context — include who is speaking so the AI understands the conversation
  const recentContext = messageBuffer.getRecent(message.channel.id, 5);
  const userContext = userMemory.getContext(userId);

  // Frame the message with the speaker's name
  const framedMessage = `${displayName} says: ${cleanContent}`;

  try {
    await message.channel.sendTyping();
    const response = await getSassResponse(framedMessage, { recentContext, userContext, isCreator });
    await message.reply(response);

    // Don't track roast topics for the creator (we don't roast them)
    if (!isCreator) {
      extractRoastTopic(cleanContent).then((topic) => {
        if (topic) userMemory.addRoast(userId, topic);
      }).catch(() => {});
    }
  } catch (err) {
    console.error('Sass brain malfunction:', err.message);
    await message.reply(
      "My brain just short-circuited. Even AI has bad days, okay?"
    );
  }
}
