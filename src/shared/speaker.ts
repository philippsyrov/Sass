import type { BufferEntry } from '../types.js';

/**
 * One stable label per speaker, used everywhere Sass reads chat: the recent-chat log,
 * the people list and the line she is answering. The Discord user id is in every label,
 * so the same person always reads as the same person even when the display name changes,
 * and the creator is marked so creator mode knows "Creator" in the log is who it's talking to.
 */
export function speakerLabel(
  entry: Pick<BufferEntry, 'authorId' | 'author' | 'isBot'> & { isSelf?: boolean },
  creatorId: string | undefined = process.env.CREATOR_ID,
): string {
  if (entry.isSelf) return 'Sass (you)';
  if (entry.isBot) return `${entry.author} [BOT]`;
  if (creatorId && entry.authorId === creatorId) return `${entry.author} (id ${entry.authorId}, your creator)`;
  return `${entry.author} (id ${entry.authorId})`;
}

interface MentionedUser { id: string; displayName?: string | null; username: string }

/**
 * Replace raw <@id> mentions with readable names: Sass's own id becomes "@Sass",
 * other users become "@Name". Unknown ids are left alone.
 */
export function resolveMentions(content: string, selfId: string | undefined, users: Iterable<MentionedUser>): string {
  const names = new Map<string, string>();
  for (const u of users) names.set(u.id, u.displayName || u.username);
  return content.replace(/<@!?(\d+)>/g, (raw, id: string) => {
    if (selfId && id === selfId) return '@Sass';
    const name = names.get(id);
    return name ? `@${name}` : raw;
  });
}
