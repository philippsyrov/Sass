import { queryAI } from './ai.js';
import { storeMemory, searchMemories } from './vectorMemory.js';
import type { ContradictionResult } from './types.js';

const UTILITY_PROMPT = 'You are a utility function. Follow instructions exactly. Be concise. No personality.';

/**
 * Extract a claim/opinion/statement from a message if there is one.
 * Returns null if the message is too generic or has no real claim.
 */
export async function extractStatement(userMessage: string): Promise<string | null> {
  if (!userMessage || userMessage.length < 10) return null;

  const prompt = `Does this Discord message contain a clear opinion, preference, claim, or statement about themselves? If yes, extract it as a short factual claim (e.g., "hates pineapple pizza", "thinks valorant is better than cs", "says they're good at cooking"). If no clear claim, say "SKIP".

Message: "${userMessage}"`;

  try {
    const result = await queryAI(prompt, { systemPrompt: UTILITY_PROMPT });
    if (!result || result.trim().toUpperCase() === 'SKIP') return null;
    return result.trim().replace(/^["']|["']$/g, '');
  } catch (_err) {
    return null;
  }
}

/**
 * Check if a new statement contradicts any previous statements from this user.
 * Guild-scoped — only checks statements made in the same server.
 */
export async function checkContradiction(guildId: string, userId: string, newStatement: string, newMessage: string): Promise<ContradictionResult | null> {
  try {
    const pastMemories = await searchMemories(newStatement, { guildId, userId, limit: 5 });

    const pastStatements = pastMemories
      .filter((m) => m.type === 'statement' && m.score > 0.4);

    if (pastStatements.length === 0) return null;

    const pastList = pastStatements.map((m) => `- "${m.content}"`).join('\n');

    const prompt = `A Discord user previously said these things:
${pastList}

Now they just said: "${newMessage}"
Which translates to: "${newStatement}"

Does the new statement CLEARLY contradict any of the previous ones? Not just different topics — an actual flip-flop or hypocrisy. If yes, respond with EXACTLY this format:
CAUGHT: [the old statement they contradicted]
If no clear contradiction, say "CLEAN".`;

    const result = await queryAI(prompt, { systemPrompt: UTILITY_PROMPT });

    if (!result || !result.trim().startsWith('CAUGHT:')) return null;

    const oldStatement = result.replace('CAUGHT:', '').trim();
    return { oldStatement, newStatement };
  } catch (_err) {
    return null;
  }
}

/**
 * Generate a sassy "caught in 4K" callout.
 */
export async function generate4kCallout(userName: string, oldStatement: string, newStatement: string): Promise<string | null> {
  const prompt = `${userName} previously said: "${oldStatement}"
But now they just said: "${newStatement}"

Write a short, brutal callout catching them in this contradiction. You caught them flip-flopping. Reference BOTH statements. Make it devastating. 1-2 sentences. Start with something like "wait hold on" or "excuse me" or similar.`;

  try {
    const result = await queryAI(prompt, {
      systemPrompt: 'You are Sass, a sassy Discord bot. You just caught someone contradicting themselves. Be petty and specific about what they said before vs now. Lowercase. Devastating.',
    });
    return result;
  } catch (_err) {
    return null;
  }
}

/**
 * Store a user's statement for future contradiction checking. Guild-scoped.
 */
export async function storeStatement(guildId: string, userId: string, statement: string): Promise<void> {
  await storeMemory(guildId, userId, 'statement', statement);
}
