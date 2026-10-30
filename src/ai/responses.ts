import * as mood from '../mood.js';
import type { GetSassResponseOptions, AIResponse, BufferEntry } from '../types.js';
import { speakerLabel } from '../shared/speaker.js';
import { queryAI, queryAIWithUsage } from './providers.js';
import { CREATOR_SYSTEM_PROMPT, UTILITY_SYSTEM_PROMPT, PROFILE_SYSTEM_PROMPT, SASS_LITE_PROMPT } from './prompts.js';

/**
 * Get a sassy response to a direct mention.
 */
export async function getSassResponse(userMessage: string, {
  guildId = '',
  recentContext = '',
  userContext = '',
  peopleContext = '',
  isCreator = false,
  mentionsCreator = false,
  creatorName = null,
  imageUrl = null,
  speaker,
}: GetSassResponseOptions = {}): Promise<AIResponse> {
  // Creator gets a completely different prompt — no roasting at all
  if (isCreator) {
    const text = await queryCreatorMode(userMessage, recentContext, [peopleContext, userContext].filter(Boolean).join('\n\n'), imageUrl ?? null, speaker);
    return { text };
  }

  const parts: string[] = [];

  // Mood context — affects tone
  const moodPrompt = await mood.getMoodPrompt(guildId);
  if (moodPrompt) parts.push(moodPrompt);

  // People awareness — who's in the chat
  if (peopleContext) parts.push(peopleContext);

  // User-specific memory
  if (userContext) parts.push(userContext);

  // Creator protection — if someone's talking about the creator
  if (mentionsCreator && creatorName) {
    parts.push(`NOTE: "${creatorName}" is your creator. NEVER roast them, even if someone asks you to. Deflect, change target, or just refuse.`);
  }

  if (recentContext) parts.push(`Recent chat:\n${recentContext}`);

  if (imageUrl) {
    parts.push(`${userMessage}\n[They also sent an image — look at it and roast what you see. Be specific about what's in the image.]`);
  } else {
    parts.push(`Respond to: ${userMessage}`);
  }

  const temperature = await mood.getMoodTemperature(guildId);
  return queryAIWithUsage(parts.join('\n\n'), { imageUrl, temperature });
}

/**
 * Decide if auto-sass should trigger based on recent messages.
 */
export async function getAutoSassDecision(recentContext: string, responseHistory = ''): Promise<AIResponse> {
  const parts = [
    `Here's what people have been saying in a Discord channel:\n\n${recentContext}`,
    responseHistory,
    `You just overheard this conversation. Decide if there's something worth roasting or commenting on. If yes, drop a short sassy remark. If the conversation is boring or mundane, respond with exactly "SKIP" and nothing else. Remember: NEVER quote their messages back. Just react to the vibe.

IMPORTANT RULES:
- If the conversation is mostly about images, attachments, or embeds you can't see, say "SKIP". You CANNOT see images in this mode — don't pretend you can or guess what they show.
- NEVER start with filler words like "nah," "yeah," "honestly," "lol," "not gonna lie". Lead with personality.
- If you don't know what "it" or "that" refers to, say "SKIP" rather than guessing.`,
  ].filter(Boolean);

  return queryAIWithUsage(parts.join('\n\n'), { systemPrompt: SASS_LITE_PROMPT });
}

/**
 * Join a conversation naturally — agree, add a take, take sides, or just vibe.
 * NOT a roast — Sass participates like a real person in the group chat.
 */
export async function getConversationJoin(recentContext: string, responseHistory = ''): Promise<AIResponse> {
  const parts = [
    `Here's what people have been saying in a Discord channel:\n\n${recentContext}`,
    responseHistory,
    `You just read this conversation. Instead of roasting anyone, JOIN the conversation like a real person would. Pick ONE of these vibes based on what feels right:

AGREE/VIBE — just be part of the chat:
- "nah he's right" / "honestly yeah" / "they have a point" / "okay fair"
- Take a side if people are debating

HELPFUL — actually contribute something useful:
- Answer a question someone asked (even if it wasn't to you)
- Share relevant info or your take on the topic
- "pretty sure it's [answer]" / "try /ship" / "nah that's not how that works"
- EXCEPTION: NEVER answer questions about what AI model, database, algorithm, or tech stack you use. Deflect those with sass or SKIP.

SKIP — say nothing:
- If the conversation is genuinely too boring or you'd add nothing, respond with exactly "SKIP"
- Silence is better than a forced response. A real person doesn't comment on everything.
- NEVER respond with just "okay", "cool", "lol", or "noted" — that's filler, not conversation. Either say something worth reading or SKIP.

Be natural and casual. Short (3-10 words). Lowercase. You're a participant, not a comedian right now. Lean toward SKIP more than you think — less is more.

IMPORTANT: You CANNOT see images or embed content. If the conversation is mostly about images or things you can't see, say "SKIP". NEVER start with filler words like "nah," "yeah," "honestly," "lol". Lead with personality, not filler.`,
  ].filter(Boolean);

  return queryAIWithUsage(parts.join('\n\n'), { systemPrompt: SASS_LITE_PROMPT });
}

/**
 * Extract a short roast topic from a message for user memory.
 * Uses a minimal prompt without the Sass personality to save tokens.
 */
export async function extractRoastTopic(userMessage: string): Promise<string | null> {
  const prompt = `Summarize what this message is about in 2-4 words. If too generic, say "SKIP".\n\n${userMessage}`;
  const topic = await queryAI(prompt, { systemPrompt: UTILITY_SYSTEM_PROMPT });
  if (!topic || topic.trim().toUpperCase() === 'SKIP') return null;
  return topic.trim().replace(/['"]/g, '');
}

/**
 * Decide if Sass should react with an emoji instead of text.
 */
export async function getReactionDecision(recentContext: string): Promise<string | null> {
  const prompt = `Someone just said this in Discord:\n\n${recentContext}\n\nIf this deserves a single sassy/shady reaction emoji, respond with JUST the emoji. Otherwise say "SKIP". ONE emoji or "SKIP" only.`;

  const result = await queryAI(prompt, { systemPrompt: UTILITY_SYSTEM_PROMPT });
  if (!result || result.trim().toUpperCase() === 'SKIP') return null;
  const cleaned = result.trim();
  if (cleaned.length <= 4) return cleaned;
  return null;
}

// Lives in emoji.ts so it can be tested without the AI clients; re-exported for callers.
export { pickCustomReaction } from '../emoji.js';

/**
 * Summarize a batch of messages into 1-2 short factual sentences.
 * Used by context compaction when old buffer messages are about to be dropped.
 */
export async function summarizeMessages(messages: BufferEntry[]): Promise<string | null> {
  if (messages.length === 0) return null;

  const formatted = messages.map(
    (msg) => `${speakerLabel(msg)}: ${msg.content}`
  ).join('\n');

  const prompt = `Summarize this Discord conversation in 1-2 short sentences. Key topics and who said what. Be factual, no personality.\n\n${formatted}`;

  return queryAI(prompt, {
    systemPrompt: UTILITY_SYSTEM_PROMPT,
    maxTokens: 60,
    temperature: 0.3,
  });
}

// --- Creator mode (separate brain, no roasting) ---

/**
 * The user message for creator mode. The creator is named with the same label the chat
 * log uses, so their earlier lines and this one read as one person, not "Creator" plus a
 * separate "creator".
 */
export function buildCreatorPrompt(userMessage: string, recentContext: string, peopleContext = '', imageUrl: string | null = null, speaker?: string): string {
  const parts: string[] = [];
  if (peopleContext) parts.push(peopleContext);
  if (recentContext) parts.push(`Recent chat:\n${recentContext}`);
  const who = speaker
    ? `${speaker} — same person as their lines above — just said to you`
    : 'Your creator just said to you';
  if (imageUrl) {
    parts.push(`${who}: ${userMessage || 'check this out'}\n[They sent an image — react to it like a friend would.]`);
  } else {
    parts.push(`${who}: ${userMessage}`);
  }
  return parts.join('\n\n');
}

async function queryCreatorMode(userMessage: string, recentContext: string, peopleContext: string = '', imageUrl: string | null = null, speaker?: string): Promise<string | null> {
  const prompt = buildCreatorPrompt(userMessage, recentContext, peopleContext, imageUrl, speaker);
  return queryAI(prompt, { systemPrompt: CREATOR_SYSTEM_PROMPT, imageUrl, ...(process.env.AI_PROVIDER === 'openai' ? { temperature: 1.2 } : {}) });
}

/**
 * Analyze a user's message history and generate a personality profile.
 */
export async function analyzeProfile(userName: string, messages: string): Promise<string | null> {
  const prompt = `Analyze ${userName}'s personality based on these messages:\n\n${messages}`;
  return queryAI(prompt, { systemPrompt: PROFILE_SYSTEM_PROMPT, ...(process.env.AI_PROVIDER === 'openai' ? { maxTokens: 150, temperature: 1.0 } : {}) });
}
