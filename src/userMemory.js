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
      this.users[userId] = { name: displayName, roasts: [], lastSeen: 0, messageCount: 0 };
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
    if (user.roasts.length > 0) {
      parts.push(
        `you've already destroyed ${user.name} before about: ${user.roasts.join(', ')}. ` +
        `use this. be petty. remind them they never learn.`
      );
    }
    if (user.messageCount > 50) {
      parts.push(`${user.name} is basically a fixture here (${user.messageCount} messages). they can take whatever you throw at them — no mercy.`);
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
        // Activity level
        if (user.messageCount > 50) parts.push('regular');
        else if (user.messageCount > 20) parts.push('regular');
        else if (user.messageCount <= 3) parts.push('newcomer');

        parts.push(`${user.messageCount} msgs`);

        // Ammo
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
