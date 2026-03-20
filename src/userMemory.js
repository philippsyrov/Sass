import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = join(__dirname, '..', 'data');
const MEMORY_FILE = join(MEMORY_DIR, 'user-memory.json');

/**
 * Per-user memory so Sass can remember past interactions.
 * Stores last few roast topics per user so she can call back to them.
 */
class UserMemory {
  constructor() {
    // { userId: { name, roasts: [string], lastSeen: timestamp, messageCount: number } }
    this.users = this._load();
  }

  _load() {
    try {
      if (existsSync(MEMORY_FILE)) {
        return JSON.parse(readFileSync(MEMORY_FILE, 'utf-8'));
      }
    } catch {
      console.error('Failed to load user memory, starting fresh');
    }
    return {};
  }

  _save() {
    try {
      if (!existsSync(MEMORY_DIR)) {
        mkdirSync(MEMORY_DIR, { recursive: true });
      }
      writeFileSync(MEMORY_FILE, JSON.stringify(this.users, null, 2));
    } catch {
      console.error('Failed to save user memory');
    }
  }

  /**
   * Track that a user sent a message.
   */
  seen(userId, displayName) {
    if (!this.users[userId]) {
      this.users[userId] = { name: displayName, roasts: [], lastSeen: 0, messageCount: 0, timesRoasted: 0 };
    }
    this.users[userId].name = displayName;
    this.users[userId].lastSeen = Date.now();
    this.users[userId].messageCount++;
    this._save();
  }

  /**
   * Store a roast topic so Sass can reference it later.
   * Keeps only the last 5 per user.
   */
  addRoast(userId, topic) {
    if (!this.users[userId]) return;
    this.users[userId].roasts.push(topic);
    if (this.users[userId].roasts.length > 5) {
      this.users[userId].roasts.shift();
    }
    this._save();
  }

  /**
   * Get context string about a user for the AI prompt.
   */
  getContext(userId) {
    const user = this.users[userId];
    if (!user) return '';

    const parts = [];
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
      parts.push(`${user.name} is basically a fixture here. they can take whatever you throw at them — no mercy.`);
    } else if (user.messageCount > 20) {
      parts.push(`${user.name} is a regular. they know what they signed up for.`);
    } else if (user.messageCount <= 3) {
      parts.push(`${user.name} is new here. welcome them — ominously.`);
    }
    return parts.join(' ');
  }

  /**
   * Build a "people in this chat" block from recent messages.
   * Gives Sass awareness of who's in the room and what she knows about them.
   */
  buildPeopleContext(recentMessages) {
    if (!recentMessages || recentMessages.length === 0) return '';

    const creatorId = process.env.CREATOR_ID;
    const seen = new Map();

    // Collect unique users from recent messages
    for (const msg of recentMessages) {
      if (msg.isBot || seen.has(msg.authorId)) continue;
      seen.set(msg.authorId, msg.author);
    }

    if (seen.size === 0) return '';

    const lines = ['PEOPLE IN THIS CHAT:'];
    for (const [userId, displayName] of seen) {
      const user = this.users[userId];
      const parts = [];

      // Creator tag
      if (userId === creatorId) {
        parts.push('your creator, friend — never roast');
      } else if (user) {
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
        parts.push('unknown — first time seeing them');
      }

      lines.push(`- ${displayName} (${parts.join(', ')})`);
    }

    return lines.join('\n');
  }

  /**
   * Increment the roast counter for a user.
   */
  recordRoast(userId) {
    if (!this.users[userId]) return;
    this.users[userId].timesRoasted = (this.users[userId].timesRoasted || 0) + 1;
    this._save();
  }

  /**
   * Get the roast leaderboard — top N most roasted users.
   */
  getLeaderboard(limit = 10) {
    return Object.entries(this.users)
      .filter(([id]) => id !== process.env.CREATOR_ID)
      .map(([id, data]) => ({ id, name: data.name, timesRoasted: data.timesRoasted || 0 }))
      .sort((a, b) => b.timesRoasted - a.timesRoasted)
      .slice(0, limit);
  }

  /**
   * Store a fact about a user that Sass can weaponize later.
   * Keeps last 10 facts per user.
   */
  remember(userId, fact) {
    if (!this.users[userId]) return;
    if (!this.users[userId].facts) this.users[userId].facts = [];
    this.users[userId].facts.push(fact);
    if (this.users[userId].facts.length > 10) {
      this.users[userId].facts.shift();
    }
    this._save();
  }

  /**
   * Get remembered facts about a user.
   */
  getFacts(userId) {
    return this.users[userId]?.facts || [];
  }

  /**
   * Put a user on the cold shoulder list. They asked Sass to stop.
   * They'll need to win her back (3-5 attempts).
   */
  coldShoulder(userId) {
    if (!this.users[userId]) return;
    const attemptsNeeded = 3 + Math.floor(Math.random() * 3); // 3-5
    this.users[userId].coldShoulder = { active: true, attemptsNeeded, attemptsMade: 0 };
    this._save();
  }

  /**
   * Check if user is on the cold shoulder list.
   * Returns: false | { phase: 'icy' | 'warming' | 'forgiven', attemptsMade, attemptsNeeded }
   */
  getColdShoulder(userId) {
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
  coldShoulderAttempt(userId) {
    const cs = this.users[userId]?.coldShoulder;
    if (!cs || !cs.active) return false;
    cs.attemptsMade++;
    if (cs.attemptsMade >= cs.attemptsNeeded) {
      cs.active = false;
    }
    this._save();
    return this.getColdShoulder(userId);
  }

  /**
   * Store a wild quote from a user. Keeps top 20 across all users.
   */
  addWildQuote(userId, quote) {
    if (!this.users[userId]) return;
    if (!this._wildQuotes) this._wildQuotes = this._loadWildQuotes();
    this._wildQuotes.push({ userId, name: this.users[userId].name, quote, timestamp: Date.now() });
    if (this._wildQuotes.length > 20) this._wildQuotes.shift();
    this._saveWildQuotes();
  }

  getWildQuotes(limit = 10) {
    if (!this._wildQuotes) this._wildQuotes = this._loadWildQuotes();
    return this._wildQuotes.slice(-limit).reverse();
  }

  _loadWildQuotes() {
    try {
      const path = join(MEMORY_DIR, 'wild-quotes.json');
      if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf-8'));
    } catch { /* ignore */ }
    return [];
  }

  _saveWildQuotes() {
    try {
      if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
      writeFileSync(join(MEMORY_DIR, 'wild-quotes.json'), JSON.stringify(this._wildQuotes, null, 2));
    } catch { /* ignore */ }
  }

  /**
   * Check if a message text mentions the creator by name.
   * Used to prevent roasting the creator even when others talk about them.
   */
  isAboutCreator(text) {
    const creatorId = process.env.CREATOR_ID;
    if (!creatorId || !this.users[creatorId]) return false;

    const creatorName = this.users[creatorId].name.toLowerCase();
    const lowerText = text.toLowerCase();

    // Check for the creator's display name in the text
    return lowerText.includes(creatorName);
  }

  /**
   * Get the creator's display name.
   */
  getCreatorName() {
    const creatorId = process.env.CREATOR_ID;
    if (!creatorId || !this.users[creatorId]) return null;
    return this.users[creatorId].name;
  }
}

export const userMemory = new UserMemory();
