/**
 * mood.ts — Guild-scoped mood system backed by PostgreSQL
 *
 * Each server has its own independent mood state.
 * Mood affects Sass's tone, temperature, and system prompt.
 * Decays over time toward neutral.
 */

import { getPool, isDatabaseConnected } from './database.js';
import type { MoodType, MoodEvent, MoodState, MoodStatus } from './types.js';

const MOOD_DECAY_MS = 30 * 60 * 1000; // mood decays every 30 min
const DECAY_AMOUNT = 15;

const MOOD_PROMPTS: Record<MoodType, string> = {
  neutral: '',
  chaotic: `YOUR CURRENT MOOD: chaotic. you're in full gremlin mode right now. things are funny to you. you're more likely to use caps lock and be unhinged. lean into the chaos. "LMAO WHAT" energy.`,
  chill: `YOUR CURRENT MOOD: chill. you're in a rare good mood. still sassy but more playful than mean. your roasts have a smile behind them. you might even — barely — compliment someone. don't overdo the niceness tho, you still have a reputation.`,
  petty: `YOUR CURRENT MOOD: petty. someone pissed you off recently and now everyone's paying for it. bring up old stuff. be passive aggressive. hold grudges. "oh you're back? thought you left after that embarrassing thing you said earlier" energy.`,
  bored: `YOUR CURRENT MOOD: bored. nothing interesting is happening and you're letting everyone know. short responses. "okay" and "cool" and "anyway." you're barely paying attention. if someone says something boring, just sigh and move on.`,
  unhinged: `YOUR CURRENT MOOD: completely unhinged. you've snapped. full caps energy. no filter. everything is funny or insane to you. "I CAN'T WITH Y'ALL" but you keep going anyway. chaotic and unstoppable.`,
  soft: `YOUR CURRENT MOOD: soft (don't tell anyone). you're feeling almost... kind? you care about these people more than you'd ever admit. you still roast, but it's gentle — more teasing than attacking. you might say something genuinely nice and then immediately get embarrassed about it. "that was actually really cool... anyway shut up." or "i'm not being nice, i'm being accurate." if someone calls you out for being soft, deny it aggressively. classic tsundere — you care, you just can't say it without a layer of sass on top.`,
};

const MOOD_TEMPERATURES: Record<MoodType, number> = {
  neutral: 1.2,
  chaotic: 1.4,
  chill: 1.0,
  petty: 1.3,
  bored: 0.9,
  unhinged: 1.5,
  soft: 1.0,
};

const MOOD_LABELS: Record<MoodType, string> = {
  neutral: '\u{1F610} neutral \u2014 just vibing',
  chaotic: '\u{1F92A} chaotic \u2014 gremlin mode activated',
  chill: '\u{1F60E} chill \u2014 almost friendly (don\'t get used to it)',
  petty: '\u{1F485} petty \u2014 holding grudges and names',
  bored: '\u{1F611} bored \u2014 couldn\'t care less',
  unhinged: '\u{1F525} UNHINGED \u2014 no filter, no mercy',
  soft: '\u{1F97A} soft \u2014 (don\'t tell anyone)',
};

interface MoodShiftConfig {
  mood: MoodType;
  delta: number;
}

// --- Helper to get mood state from DB ---
async function getMoodState(guildId: string): Promise<MoodState> {
  const pool = getPool();
  if (!pool) return { mood: 'neutral', intensity: 0, lastShift: Date.now(), lastDecay: Date.now() };

  try {
    const result = await pool.query(
      'SELECT mood, intensity, last_shift, last_decay FROM mood_state WHERE server_id = $1',
      [guildId]
    );
    const row = result.rows[0];
    if (!row) return { mood: 'neutral', intensity: 0, lastShift: Date.now(), lastDecay: Date.now() };
    return {
      mood: (row.mood as MoodType) || 'neutral',
      intensity: (row.intensity as number) || 0,
      lastShift: new Date(row.last_shift as string).getTime(),
      lastDecay: new Date(row.last_decay as string).getTime(),
    };
  } catch (err) {
    console.error('getMoodState failed:', (err as Error).message);
    return { mood: 'neutral', intensity: 0, lastShift: Date.now(), lastDecay: Date.now() };
  }
}

// --- Helper to save mood state ---
async function saveMoodState(guildId: string, state: MoodState): Promise<void> {
  const pool = getPool();
  if (!pool) return;

  try {
    await pool.query(
      `INSERT INTO mood_state (server_id, mood, intensity, last_shift, last_decay)
       VALUES ($1, $2, $3, to_timestamp($4), to_timestamp($5))
       ON CONFLICT (server_id) DO UPDATE SET
         mood = $2, intensity = $3, last_shift = to_timestamp($4), last_decay = to_timestamp($5)`,
      [guildId, state.mood, state.intensity, state.lastShift / 1000, state.lastDecay / 1000]
    );
  } catch (err) {
    console.error('saveMoodState failed:', (err as Error).message);
  }
}

// --- Apply decay ---
function applyDecay(state: MoodState): boolean {
  const now = Date.now();
  const elapsed = now - (state.lastDecay || now);
  const ticks = Math.floor(elapsed / MOOD_DECAY_MS);

  if (ticks > 0) {
    state.intensity = Math.max(0, state.intensity - ticks * DECAY_AMOUNT);
    state.lastDecay = now;
    if (state.intensity <= 0) {
      state.mood = 'neutral';
    }
    return true; // changed
  }
  return false;
}

// --- Public API ---

/**
 * Get current mood for a guild after applying decay.
 */
export async function getMood(guildId: string): Promise<{ mood: MoodType; intensity: number }> {
  const state = await getMoodState(guildId);
  const changed = applyDecay(state);
  if (changed) await saveMoodState(guildId, state);

  if (state.intensity <= 0) {
    return { mood: 'neutral', intensity: 0 };
  }
  return { mood: state.mood, intensity: state.intensity };
}

/**
 * Get the mood-specific addition to the system prompt.
 */
export async function getMoodPrompt(guildId: string): Promise<string> {
  const { mood, intensity } = await getMood(guildId);
  if (mood === 'neutral' || intensity <= 10) return '';
  return MOOD_PROMPTS[mood] || '';
}

/**
 * Get the temperature adjustment for the current mood.
 */
export async function getMoodTemperature(guildId: string): Promise<number> {
  const { mood, intensity } = await getMood(guildId);
  if (mood === 'neutral' || intensity <= 10) return 1.2;
  const moodTemp = MOOD_TEMPERATURES[mood] || 1.2;
  const blend = Math.min(intensity, 100) / 100;
  return 1.2 + (moodTemp - 1.2) * blend;
}

/**
 * Shift mood based on an event.
 */
export async function shift(guildId: string, event: MoodEvent): Promise<void> {
  if (!isDatabaseConnected()) return;

  const shifts: Record<MoodEvent, MoodShiftConfig> = {
    complimented: { mood: 'soft', delta: 40 },
    insulted: { mood: 'petty', delta: 40 },
    chaos: { mood: 'chaotic', delta: 30 },
    boring: { mood: 'bored', delta: 20 },
    nice_to_each_other: { mood: 'chill', delta: 25 },
    fighting: { mood: 'unhinged', delta: 35 },
    begged_back: { mood: 'petty', delta: 30 },
  };

  let config = shifts[event];
  if (!config) return;

  if (event === 'nice_to_each_other' && Math.random() < 0.4) {
    config = { mood: 'soft', delta: 15 };
  }

  const state = await getMoodState(guildId);
  applyDecay(state);

  if (state.mood !== config.mood && state.mood !== 'neutral') {
    state.intensity = Math.max(0, state.intensity - 20);
    if (state.intensity <= 10) {
      state.mood = config.mood;
      state.intensity = config.delta;
    }
  } else {
    state.mood = config.mood;
    state.intensity = Math.min(100, state.intensity + config.delta);
  }

  state.lastShift = Date.now();
  await saveMoodState(guildId, state);
}

/**
 * Get a human-readable mood status for display.
 */
export async function getStatus(guildId: string): Promise<MoodStatus> {
  const { mood, intensity } = await getMood(guildId);
  return { mood, intensity, label: MOOD_LABELS[mood] || MOOD_LABELS.neutral };
}
