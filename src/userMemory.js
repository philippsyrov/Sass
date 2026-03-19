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
      parts.push(`You've roasted ${user.name} before about: ${user.roasts.join(', ')}. Use this as ammo — be petty, call back to it, remind them they never learn.`);
    }
    if (user.messageCount > 50) {
      parts.push(`${user.name} basically lives here (${user.messageCount} messages). They're a known regular — roast them like an old friend.`);
    } else if (user.messageCount > 20) {
      parts.push(`${user.name} is becoming a regular.`);
    } else if (user.messageCount <= 3) {
      parts.push(`${user.name} is new here — welcome them... your way.`);
    }
    return parts.join(' ');
  }
}

export const userMemory = new UserMemory();
