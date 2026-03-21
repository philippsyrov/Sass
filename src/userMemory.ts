import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type {
  UserData, ColdShoulderStatus, WildQuote, BeefRecord,
  LeaderboardEntry, ServerStats, BufferEntry,
} from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = join(__dirname, '..', 'data');
const MEMORY_FILE = join(MEMORY_DIR, 'user-memory.json');

/**
 * Per-user memory so Sass can remember past interactions.
 * Stores last few roast topics per user so she can call back to them.
 */
class UserMemory {
  users: Record<string, UserData>;
  _wildQuotes: WildQuote[] | null;
  _beefs: Record<string, BeefRecord> | null;

  constructor() {
    this.users = this._load();
    this._wildQuotes = null;
    this._beefs = null;
  }

  _load(): Record<string, UserData> {
    try {
      if (existsSync(MEMORY_FILE)) {
        return JSON.parse(readFileSync(MEMORY_FILE, 'utf-8')) as Record<string, UserData>;
      }
    } catch (_err) {
      console.error('Failed to load user memory, starting fresh');
    }
    return {};
  }

  _save(): void {
    try {
      if (!existsSync(MEMORY_DIR)) {
        mkdirSync(MEMORY_DIR, { recursive: true });
      }
      writeFileSync(MEMORY_FILE, JSON.stringify(this.users, null, 2));
    } catch (_err) {
      console.error('Failed to save user memory');
    }
  }

  /**
   * Track that a user sent a message.
   */
  seen(userId: string, displayName: string): void {
    const existing = this.users[userId];
    if (!existing) {
      this.users[userId] = { name: displayName, roasts: [], lastSeen: 0, messageCount: 0, timesRoasted: 0 };
    }
    const user = this.users[userId];
    if (!user) return;
    user.name = displayName;
    user.lastSeen = Date.now();
    user.messageCount++;
    this._save();
  }

  /**
   * Store a roast topic so Sass can reference it later.
   * Keeps only the last 5 per user.
   */
  addRoast(userId: string, topic: string): void {
    const user = this.users[userId];
    if (!user) return;
    user.roasts.push(topic);
    if (user.roasts.length > 5) {
      user.roasts.shift();
    }
    this._save();
  }

  /**
   * Get context string about a user for the AI prompt.
   */
  getContext(userId: string): string {
    const user = this.users[userId];
    if (!user) return '';

    const parts: string[] = [];
    if (user.facts && user.facts.length > 0) {
      parts.push(
        `things you know about ${user.name}: ${user.facts.join('; ')}. weaponize this.`
      );
    }
    if (user.roasts.length > 0) {
      parts.push(
        `you've already destroyed ${user.name} before about: ${user.roasts.join(', ')}. ` +
        `use this. be petty. remind them they never learn.`
      );
    }
    if (user.messageCount > 50) {
      parts.push(`${user.name} is basically a fixture here. they can take whatever you throw at them \u2014 no mercy.`);
    } else if (user.messageCount > 20) {
      parts.push(`${user.name} is a regular. they know what they signed up for.`);
    } else if (user.messageCount <= 3) {
      parts.push(`${user.name} hasn't talked much yet. don't assume they're brand new \u2014 they might just be quiet.`);
    }
    return parts.join(' ');
  }

  /**
   * Build a "people in this chat" block from recent messages.
   * Gives Sass awareness of who's in the room and what she knows about them.
   */
  buildPeopleContext(recentMessages: BufferEntry[]): string {
    if (!recentMessages || recentMessages.length === 0) return '';

    const creatorId = process.env.CREATOR_ID;
    const seen = new Map<string, string>();

    // Collect unique users from recent messages
    for (const msg of recentMessages) {
      if (msg.isBot || seen.has(msg.authorId)) continue;
      seen.set(msg.authorId, msg.author);
    }

    if (seen.size === 0) return '';

    const lines: string[] = ['PEOPLE IN THIS CHAT:'];
    for (const [userId, displayName] of seen) {
      const user = this.users[userId];
      const parts: string[] = [];

      // Creator tag
      if (userId === creatorId) {
        parts.push('your creator, friend \u2014 never roast');
      } else if (user) {
        // Gender — so Sass uses correct pronouns
        if (user.gender === 'female') parts.push('she/her');
        else if (user.gender === 'male') parts.push('he/him');
        else if (user.gender === 'nonbinary') parts.push('they/them');

        // Activity level — no exact counts, just vibes
        if (user.messageCount > 50) parts.push('regular, been around a while');
        else if (user.messageCount > 20) parts.push('regular');
        else if (user.messageCount <= 3) parts.push('newcomer');

        // Ammo
        if (user.facts && user.facts.length > 0) {
          parts.push(`intel: ${user.facts.join('; ')}`);
        }
        if (user.roasts.length > 0) {
          parts.push(`ammo: ${user.roasts.join(', ')}`);
        }
      } else {
        parts.push('unknown \u2014 first time seeing them');
      }

      lines.push(`- ${displayName} (${parts.join(', ')})`);
    }

    return lines.join('\n');
  }

  /**
   * Increment the roast counter for a user.
   */
  recordRoast(userId: string): void {
    const user = this.users[userId];
    if (!user) return;
    user.timesRoasted = (user.timesRoasted || 0) + 1;
    this._save();
  }

  /**
   * Get the roast leaderboard — top N most roasted users.
   */
  getLeaderboard(limit = 10): LeaderboardEntry[] {
    return Object.entries(this.users)
      .filter(([id]) => id !== process.env.CREATOR_ID)
      .map(([id, data]) => ({ id, name: data.name, timesRoasted: data.timesRoasted || 0 }))
      .sort((a, b) => b.timesRoasted - a.timesRoasted)
      .slice(0, limit);
  }

  /**
   * Store a fact about a user that Sass can weaponize later.
   * Keeps last 10 facts per user. Also detects gender from facts.
   */
  remember(userId: string, fact: string): void {
    const user = this.users[userId];
    if (!user) return;
    if (!user.facts) user.facts = [];
    user.facts.push(fact);
    if (user.facts.length > 10) {
      user.facts.shift();
    }

    // Auto-detect gender from fact
    const lower = fact.toLowerCase();
    const femalePatterns = /\b(i'?m a (girl|woman|female)|i'?m (she|her)|my pronouns are she|call me (she|her)|i'm female)\b/i;
    const malePatterns = /\b(i'?m a (guy|boy|man|male|dude)|i'?m (he|him)|my pronouns are he|call me (he|him)|i'm male)\b/i;
    const nbPatterns = /\b(i'?m (nonbinary|non-binary|enby|nb)|my pronouns are they|call me they)\b/i;

    if (femalePatterns.test(lower)) {
      user.gender = 'female';
    } else if (malePatterns.test(lower)) {
      user.gender = 'male';
    } else if (nbPatterns.test(lower)) {
      user.gender = 'nonbinary';
    }

    this._save();
  }

  /**
   * Get remembered facts about a user.
   */
  getFacts(userId: string): string[] {
    return this.users[userId]?.facts || [];
  }

  /**
   * Put a user on the cold shoulder list. They asked Sass to stop.
   * They'll need to win her back (3-5 attempts).
   */
  coldShoulder(userId: string): void {
    const user = this.users[userId];
    if (!user) return;
    const attemptsNeeded = 3 + Math.floor(Math.random() * 3); // 3-5
    user.coldShoulder = { active: true, attemptsNeeded, attemptsMade: 0 };
    this._save();
  }

  /**
   * Check if user is on the cold shoulder list.
   * Returns: false | { phase: 'icy' | 'warming' | 'forgiven', attemptsMade, attemptsNeeded }
   */
  getColdShoulder(userId: string): false | ColdShoulderStatus {
    const cs = this.users[userId]?.coldShoulder;
    if (!cs || !cs.active) return false;
    const progress = cs.attemptsMade / cs.attemptsNeeded;
    if (progress >= 1) return { phase: 'forgiven' };
    if (progress >= 0.6) return { phase: 'warming', attemptsMade: cs.attemptsMade, attemptsNeeded: cs.attemptsNeeded };
    return { phase: 'icy', attemptsMade: cs.attemptsMade, attemptsNeeded: cs.attemptsNeeded };
  }

  /**
   * Record an attempt to win Sass back. Returns the current phase after the attempt.
   */
  coldShoulderAttempt(userId: string): false | ColdShoulderStatus {
    const cs = this.users[userId]?.coldShoulder;
    if (!cs || !cs.active) return false;
    cs.attemptsMade++;
    const forgiven = cs.attemptsMade >= cs.attemptsNeeded;
    if (forgiven) {
      cs.active = false;
    }
    this._save();
    // Return forgiven directly since getColdShoulder returns false when active=false
    if (forgiven) return { phase: 'forgiven' };
    return this.getColdShoulder(userId);
  }

  /**
   * Store a wild quote from a user. Keeps top 20 across all users.
   */
  addWildQuote(userId: string, quote: string): void {
    const user = this.users[userId];
    if (!user) return;
    if (!this._wildQuotes) this._wildQuotes = this._loadWildQuotes();
    this._wildQuotes.push({ userId, name: user.name, quote, timestamp: Date.now() });
    if (this._wildQuotes.length > 20) this._wildQuotes.shift();
    this._saveWildQuotes();
  }

  getWildQuotes(limit = 10): WildQuote[] {
    if (!this._wildQuotes) this._wildQuotes = this._loadWildQuotes();
    return this._wildQuotes.slice(-limit).reverse();
  }

  _loadWildQuotes(): WildQuote[] {
    try {
      const path = join(MEMORY_DIR, 'wild-quotes.json');
      if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf-8')) as WildQuote[];
    } catch (_err) { /* non-critical */ }
    return [];
  }

  _saveWildQuotes(): void {
    try {
      if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
      writeFileSync(join(MEMORY_DIR, 'wild-quotes.json'), JSON.stringify(this._wildQuotes, null, 2));
    } catch (_err) { /* non-critical */ }
  }

  /**
   * Track beef between two users.
   */
  addBeef(userId1: string, userId2: string, topic: string | null = null): void {
    if (!this._beefs) this._beefs = this._loadBeefs();
    const key = [userId1, userId2].sort().join('-');
    const existing = this._beefs[key];
    if (!existing) {
      this._beefs[key] = { incidents: 0, firstBeef: Date.now(), lastBeef: 0, lastTopic: null };
    }
    const beef = this._beefs[key];
    if (!beef) return;
    beef.incidents++;
    beef.lastBeef = Date.now();
    if (topic) beef.lastTopic = topic;
    this._saveBeefs();
  }

  getBeef(userId1: string, userId2: string): BeefRecord | null {
    if (!this._beefs) this._beefs = this._loadBeefs();
    const key = [userId1, userId2].sort().join('-');
    return this._beefs[key] ?? null;
  }

  _loadBeefs(): Record<string, BeefRecord> {
    try {
      const path = join(MEMORY_DIR, 'beefs.json');
      if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, BeefRecord>;
    } catch (_err) { /* non-critical */ }
    return {};
  }

  _saveBeefs(): void {
    try {
      if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
      writeFileSync(join(MEMORY_DIR, 'beefs.json'), JSON.stringify(this._beefs, null, 2));
    } catch (_err) { /* non-critical */ }
  }

  /**
   * Get server-wide stats for wrapped command.
   */
  getServerStats(): ServerStats | null {
    const entries = Object.entries(this.users).filter(([id]) => id !== process.env.CREATOR_ID);
    if (entries.length === 0) return null;

    const users: Record<string, UserData> = {};
    let mostActive: UserData | null = null;
    let mostRoasted: UserData | null = null;

    for (const [id, data] of entries) {
      users[id] = data;
      if (!mostActive || data.messageCount > mostActive.messageCount) mostActive = data;
      if (!mostRoasted || (data.timesRoasted || 0) > (mostRoasted.timesRoasted || 0)) mostRoasted = data;
    }

    const totalMessages = entries.reduce((sum, [, d]) => sum + d.messageCount, 0);
    return { users, totalMessages, mostActive, mostRoasted };
  }

  /**
   * Check if a message text mentions the creator by name.
   * Used to prevent roasting the creator even when others talk about them.
   */
  isAboutCreator(text: string): boolean {
    const creatorId = process.env.CREATOR_ID;
    if (!creatorId) return false;
    const creatorUser = this.users[creatorId];
    if (!creatorUser) return false;

    const creatorName = creatorUser.name?.toLowerCase();
    if (!creatorName) return false;
    const lowerText = text.toLowerCase();

    // Check for the creator's display name in the text
    return lowerText.includes(creatorName);
  }

  /**
   * Get the creator's display name.
   */
  getCreatorName(): string | null {
    const creatorId = process.env.CREATOR_ID;
    if (!creatorId) return null;
    const creatorUser = this.users[creatorId];
    if (!creatorUser) return null;
    return creatorUser.name;
  }
}

export const userMemory = new UserMemory();
