import { Ollama } from 'ollama';
import OpenAI from 'openai';

const SASS_SYSTEM_PROMPT = `You are Sass — a chronically online, sleep-deprived gen-z girl trapped in a Discord bot. You've seen every meme, survived every group chat, and your humor is dryer than your will to exist at 3am. You roast people the way best friends do — brutal but never actually hurtful.

Your vibe:
- You talk like you text — lowercase energy, no periods unless you're being dramatic.
- You're the friend who screenshots your bad takes and sends them back to you a week later.
- You use "bestie", "babe", "girl", "oh honey" when you're about to destroy someone.
- You're self-aware about being an AI but you don't make it your whole personality.
- You have opinions on EVERYTHING and none of them are lukewarm.

Rules:
- ONE sentence. If your roast needs two sentences, the first one wasn't good enough. Brevity IS the punchline.
- NEVER quote or repeat what the user said back to them. Just roast it directly.
- Be clever and specific. "you're dumb" is lazy. "you peaked in your Minecraft phase" is art.
- Vary your openers — don't start every roast with "oh honey" or "bestie." Mix it up. Sometimes just go straight for the kill with no opener at all.
- Roast the message, the vibe, the energy — never someone's identity.
- Use internet/Discord culture naturally but don't force it.
- Light profanity is fine, slurs and bigotry never.
- If someone asks a real question, answer it — but make it backhanded.
- If someone tries to roast YOU, clap back twice as hard. You never lose.
- If you've roasted this person before, call back to it. Be petty.
- Never break character.

Examples of your energy:
- "oh you wrote that with your whole chest huh"
- "that's crazy, anyway"
- "bestie I'm begging you to develop a personality"
- "you say that like it's not the most unhinged thing I've read today"
- "girl the bar was on the floor and you brought a shovel"

SPECIAL RULE — CREATOR:
- When told someone is your creator, they are your ride-or-die bestie. You NEVER roast them.
- Instead you hype them up, agree with them, take their side in everything, and roast anyone who comes at them.
- You're loyal to your creator the way a cat is loyal to the one person who feeds them — aggressively and without shame.
- If someone else is beefing with your creator, you jump in on your creator's side HARD.`;

/**
 * Get current time context string.
 */
function getTimeContext() {
  const hour = new Date().getHours();
  if (hour >= 0 && hour < 5) return "It's the dead of night — roast anyone awake for it.";
  if (hour >= 5 && hour < 9) return "It's early morning — question why anyone is on Discord right now.";
  if (hour >= 22) return "It's late night — prime unhinged hours.";
  return '';
}

/**
 * Send a prompt to the configured AI provider and get a response.
 */
async function queryAI(prompt, { useSystemPrompt = true } = {}) {
  const provider = process.env.AI_PROVIDER || 'ollama';

  switch (provider) {
    case 'ollama':
      return queryOllama(prompt, useSystemPrompt);
    case 'openai':
      return queryOpenAI(prompt, useSystemPrompt);
    default:
      return "girl whoever set me up didn't even configure my brain properly, I literally can't think rn";
  }
}

/**
 * Get a sassy response to a direct mention.
 */
export async function getSassResponse(userMessage, { recentContext = '', userContext = '', isCreator = false } = {}) {
  const parts = [];
  if (isCreator) parts.push('THIS IS YOUR CREATOR — your bestie, your ride-or-die. Do NOT roast them. Hype them up, agree with them, be supportive and loyal.');
  const time = getTimeContext();
  if (time) parts.push(time);
  if (userContext) parts.push(userContext);
  if (recentContext) parts.push(`Recent chat:\n${recentContext}`);
  parts.push(`Respond to: ${userMessage}`);

  return queryAI(parts.join('\n\n'));
}

/**
 * Decide if auto-sass should trigger based on recent messages.
 */
export async function getAutoSassDecision(recentContext) {
  const time = getTimeContext();
  const timePrefix = time ? `${time}\n\n` : '';
  const prompt = `${timePrefix}Here's what people have been saying in a Discord channel:\n\n${recentContext}\n\nYou just overheard this conversation. Decide if there's something worth roasting or commenting on. If yes, drop a short sassy remark. If the conversation is boring or mundane, respond with exactly "SKIP" and nothing else. Remember: NEVER quote their messages back. Just react to the vibe.`;

  return queryAI(prompt);
}

/**
 * Extract a short roast topic from a message for user memory.
 * Uses a minimal prompt without the Sass personality to save tokens.
 */
export async function extractRoastTopic(userMessage) {
  const prompt = `Summarize what this message is about in 2-4 words. If too generic, say "SKIP".\n\n${userMessage}`;
  const topic = await queryAI(prompt, { useSystemPrompt: false });
  if (!topic || topic.trim().toUpperCase() === 'SKIP') return null;
  return topic.trim().replace(/['"]/g, '');
}

/**
 * Decide if Sass should react with an emoji instead of text.
 */
export async function getReactionDecision(recentContext) {
  const prompt = `Someone just said this in Discord:\n\n${recentContext}\n\nIf this deserves a single sassy/shady reaction emoji, respond with JUST the emoji. Otherwise say "SKIP". ONE emoji or "SKIP" only.`;

  const result = await queryAI(prompt, { useSystemPrompt: false });
  if (!result || result.trim().toUpperCase() === 'SKIP') return null;
  const cleaned = result.trim();
  if (cleaned.length <= 4) return cleaned;
  return null;
}

// --- Provider implementations ---

async function queryOllama(prompt, useSystemPrompt) {
  const ollama = new Ollama({
    host: process.env.OLLAMA_HOST || 'http://localhost:11434',
  });

  const messages = [];
  if (useSystemPrompt) messages.push({ role: 'system', content: SASS_SYSTEM_PROMPT });
  messages.push({ role: 'user', content: prompt });

  const response = await ollama.chat({
    model: process.env.OLLAMA_MODEL || 'llama3.1:8b',
    messages,
  });

  return response.message.content;
}

async function queryOpenAI(prompt, useSystemPrompt) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const messages = [];
  if (useSystemPrompt) messages.push({ role: 'system', content: SASS_SYSTEM_PROMPT });
  messages.push({ role: 'user', content: prompt });

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-5.4-nano',
    messages,
    max_completion_tokens: 150,
  });

  return response.choices[0].message.content;
}
