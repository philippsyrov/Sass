import { queryAI } from './ai.js';
import { storeMemory, searchMemories } from './vectorMemory.js';

const UTILITY_PROMPT = 'You are a utility function. Follow instructions exactly. Be concise. No personality.';

/**
 * Extract a claim/opinion/statement from a message if there is one.
 * Returns null if the message is too generic or has no real claim.
 */
export async function extractStatement(userMessage) {
  if (!userMessage || userMessage.length < 10) return null;

  const prompt = `Does this Discord message contain a clear opinion, preference, claim, or statement about themselves? If yes, extract it as a short factual claim (e.g., "hates pineapple pizza", "thinks valorant is better than cs", "says they're good at cooking"). If no clear claim, say "SKIP".

Message: "${userMessage}"`;

  try {
    const result = await queryAI(prompt, { systemPrompt: UTILITY_PROMPT });
    if (!result || result.trim().toUpperCase() === 'SKIP') return null;
    return result.trim().replace(/^["']|["']$/g, '');
  } catch {
    return null;
  }
}

/**
 * Check if a new statement contradicts any previous statements from this user.
 * Returns the contradiction details or null if no contradiction found.
 */
export async function checkContradiction(userId, newStatement, newMessage) {
  try {
    // Search for semantically similar past statements
    const pastMemories = await searchMemories(newStatement, { userId, limit: 5 });

    // Filter to only 'statement' type memories with decent similarity
    const pastStatements = pastMemories
      .filter((m) => m.type === 'statement' && m.score > 0.4);

    if (pastStatements.length === 0) return null;

    // Ask AI to check for contradictions
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
  } catch {
    return null;
  }
}

/**
 * Generate a sassy "caught in 4K" callout.
 */
export async function generate4kCallout(userName, oldStatement, newStatement) {
  const prompt = `${userName} previously said: "${oldStatement}"
But now they just said: "${newStatement}"

Write a short, brutal callout catching them in this contradiction. You caught them flip-flopping. Reference BOTH statements. Make it devastating. 1-2 sentences. Start with something like "wait hold on" or "excuse me" or similar.`;

  try {
    const result = await queryAI(prompt, {
      systemPrompt: 'You are Sass, a sassy Discord bot. You just caught someone contradicting themselves. Be petty and specific about what they said before vs now. Lowercase. Devastating.',
    });
    return result;
  } catch {
    return null;
  }
}

/**
 * Store a user's statement for future contradiction checking.
 */
export async function storeStatement(userId, statement) {
  await storeMemory(userId, 'statement', statement);
}
