import type { Presence } from 'discord.js';
import type { MainCharacter } from '../types.js';
import * as userMemory from '../userMemory.js';

// --- Daily rate limiting ---
const dailyUsage = new Map<string, string>(); // key: "userId:command", value: date string
const MAX_DAILY_TRACKED = 5000;

export function hasUsedToday(userId: string, command: string): boolean {
  const key = `${userId}:${command}`;
  const today = new Date().toDateString();
  return dailyUsage.get(key) === today;
}

export function markUsedToday(userId: string, command: string): void {
  const key = `${userId}:${command}`;
  dailyUsage.set(key, new Date().toDateString());
  if (dailyUsage.size > MAX_DAILY_TRACKED) {
    const oldest = dailyUsage.keys().next().value;
    if (oldest) dailyUsage.delete(oldest);
  }
}

// Clean up stale daily entries every hour
setInterval(() => {
  const today = new Date().toDateString();
  for (const [key, date] of dailyUsage) {
    if (date !== today) dailyUsage.delete(key);
  }
}, 60 * 60 * 1000);

// --- Activity description helper ---
export function getActivityDescription(presence: Presence | null): string | null {
  if (!presence?.activities || presence.activities.length === 0) return null;

  const parts: string[] = [];
  for (const activity of presence.activities) {
    // ActivityType: 0=Playing, 1=Streaming, 2=Listening, 3=Watching, 4=Custom, 5=Competing
    switch (activity.type) {
      case 0: { // Playing
        let desc = `playing ${activity.name}`;
        if (activity.details) desc += ` — ${activity.details}`;
        if (activity.state) desc += ` (${activity.state})`;
        if (activity.timestamps?.start) {
          const elapsed = Math.floor((Date.now() - activity.timestamps.start.getTime()) / 60000);
          if (elapsed >= 60) desc += ` for ${Math.floor(elapsed / 60)}h ${elapsed % 60}m`;
          else if (elapsed > 0) desc += ` for ${elapsed}m`;
        }
        parts.push(desc);
        break;
      }
      case 1: parts.push(`streaming ${activity.name}${activity.url ? ` on ${activity.url}` : ''}`); break;
      case 2: parts.push(`listening to ${activity.details ?? activity.name}${activity.state ? ` by ${activity.state}` : ''}`); break;
      case 3: parts.push(`watching ${activity.name}`); break;
      case 4: if (activity.state) parts.push(`custom status: "${activity.state}"`); break;
      case 5: parts.push(`competing in ${activity.name}`); break;
    }
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

// --- Utility ---
export function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

// --- Main Character tracking ---
const mainCharacters = new Map<string, MainCharacter>(); // guildId -> { name, date }
const MAX_TRACKED_GUILDS = 200;

export async function getMainCharacter(guildId: string): Promise<MainCharacter | null> {
  const mc = mainCharacters.get(guildId);
  const today = new Date().toDateString();
  if (mc && mc.date === today) return mc;

  // Pick new main character — most active user today (from memory)
  const stats = await userMemory.getServerStats(guildId);
  if (!stats?.mostActive) return null;
  const newMc: MainCharacter = { name: stats.mostActive.name, date: today };
  mainCharacters.set(guildId, newMc);
  // Evict oldest if at capacity
  if (mainCharacters.size > MAX_TRACKED_GUILDS) {
    const oldest = mainCharacters.keys().next().value;
    if (oldest !== undefined) mainCharacters.delete(oldest);
  }
  return newMc;
}
