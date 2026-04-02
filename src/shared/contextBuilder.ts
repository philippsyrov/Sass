import { messageBuffer } from '../messageBuffer.js';
import * as userMemory from '../userMemory.js';
import type { BufferEntry } from '../types.js';

/**
 * Shared context assembly for mention and auto-sass handlers.
 * Eliminates duplicated buffer + people context building across both paths.
 */

export interface BaseContext {
  recentMessages: BufferEntry[];
  recentContext: string;
  peopleContext: string;
}

/**
 * Build the base context needed by both mention and auto-sass handlers.
 * Fetches recent messages, buffer summary, and people intel in one call.
 */
export async function buildBaseContext(
  guildId: string,
  channelId: string,
  messageCount: number,
): Promise<BaseContext> {
  const recentMessages = messageBuffer.getRecentRaw(channelId, messageCount);
  const bufferSummary = messageBuffer.getSummary(channelId);

  const recentContext = [
    bufferSummary,
    ...recentMessages.map(
      (msg) => `${msg.author}${msg.isBot ? ' [BOT]' : ''}: ${msg.content}`
    ),
  ].filter(Boolean).join('\n');

  const peopleContext = await userMemory.buildPeopleContext(guildId, recentMessages);

  return { recentMessages, recentContext, peopleContext };
}
