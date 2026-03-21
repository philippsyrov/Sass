import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { MoodType, MoodEvent, MoodState, MoodStatus } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOOD_FILE = join(__dirname, '..', 'data', 'mood.json');
const DATA_DIR = join(__dirname, '..', 'data');

/**
 * Dynamic mood system for Sass.
 *
 * Sass has a global mood that shifts based on how the server treats her.
 * Mood affects her tone, temperature, and system prompt additions.
 *
 * Moods:
 * - neutral   — default, standard sass
 * - chaotic   — unhinged, more caps, wilder responses
 * - chill     — playful, lighter roasts, almost friendly
 * - petty     — extra callbacks, brings up old stuff, holds grudges
 * - bored     — dismissive, short, "anyway" energy
 * - unhinged  — full chaos, no filter
 * - soft      — rare, tiny cracks of niceness (still sassy tho)
 */

const MOOD_DECAY_MS = 30 * 60 * 1000; // mood decays every 30 min
const DECAY_AMOUNT = 15; // how much intensity drops per decay tick

const MOOD_PROMPTS: Record<MoodType, string> = {
  neutral: '',
  chaotic: `YOUR CURRENT MOOD: chaotic. you're in full gremlin mode right now. things are funny to you. you're more likely to use caps lock and be unhinged. lean into the chaos. "LMAO WHAT" energy.`,
  chill: `YOUR CURRENT MOOD: chill. you're in a rare good mood. still sassy but more playful than mean. your roasts have a smile behind them. you might even — barely — compliment someone. don't overdo the niceness tho, you still have a reputation.`,
  petty: `YOUR CURRENT MOOD: petty. someone pissed you off recently and now everyone's paying for it. bring up old stuff. be passive aggressive. hold grudges. "oh you're back? thought you left after that embarrassing thing you said earlier" energy.`,
  bored: `YOUR CURRENT MOOD: bored. nothing interesting is happening and you're letting everyone know. short responses. "okay" and "cool" and "anyway." you're barely paying attention. if someone says something boring, just sigh and move on.`,
  unhinged: `YOUR CURRENT MOOD: completely unhinged. you've snapped. full caps energy. no filter. everything is funny or insane to you. "I CAN'T WITH Y'ALL" but you keep going anyway. chaotic and unstoppable.`,
  soft: `YOUR CURRENT MOOD: soft (don't tell anyone). something nice happened and you're feeling almost... kind? still sassy, but there's warmth underneath. you might say something genuinely nice and then immediately backtrack. "that was actually cool... don't let it go to your head." cover your softness with deflection.`,
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

interface MoodShiftConfig {
  mood: MoodType;
  delta: number;
}

class MoodSystem {
  state: MoodState;

  constructor() {
    this.state = this._load();
  }

  _load(): MoodState {
    try {
      if (existsSync(MOOD_FILE)) {
        return JSON.parse(readFileSync(MOOD_FILE, 'utf-8')) as MoodState;
      }
    } catch (_err) {
      console.error('Failed to load mood state, starting fresh');
    }
    return { mood: 'neutral', intensity: 0, lastShift: Date.now(), lastDecay: Date.now() };
  }

  _save(): void {
    try {
      if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
      writeFileSync(MOOD_FILE, JSON.stringify(this.state, null, 2));
    } catch (_err) {
      console.error('Failed to save mood state');
    }
  }

  /**
   * Get current mood after applying decay.
   */
  getMood(): { mood: MoodType; intensity: number } {
    this._applyDecay();
    if (this.state.intensity <= 0) {
      this.state.mood = 'neutral';
      this.state.intensity = 0;
    }
    return { mood: this.state.mood, intensity: this.state.intensity };
  }

  /**
   * Get the mood-specific addition to the system prompt.
   */
  getMoodPrompt(): string {
    const { mood, intensity } = this.getMood();
    if (mood === 'neutral' || intensity <= 10) return '';
    return MOOD_PROMPTS[mood] || '';
  }

  /**
   * Get the temperature adjustment for the current mood.
   */
  getMoodTemperature(): number {
    const { mood, intensity } = this.getMood();
    if (mood === 'neutral' || intensity <= 10) return 1.2; // default
    // Blend between neutral temp and mood temp based on intensity
    const moodTemp = MOOD_TEMPERATURES[mood] || 1.2;
    const blend = Math.min(intensity, 100) / 100;
    return 1.2 + (moodTemp - 1.2) * blend;
  }

  /**
   * Shift mood based on an event.
   */
  shift(event: MoodEvent): void {
    const shifts: Record<MoodEvent, MoodShiftConfig> = {
      complimented: { mood: 'soft', delta: 25 },
      insulted: { mood: 'petty', delta: 30 },
      chaos: { mood: 'chaotic', delta: 20 },
      boring: { mood: 'bored', delta: 15 },
      nice_to_each_other: { mood: 'chill', delta: 15 },
      fighting: { mood: 'unhinged', delta: 25 },
      begged_back: { mood: 'petty', delta: 20 },
    };

    const config = shifts[event];
    if (!config) return;

    // If mood is changing to something new, reset intensity
    if (this.state.mood !== config.mood && this.state.mood !== 'neutral') {
      // Competing moods — reduce old intensity, add new
      this.state.intensity = Math.max(0, this.state.intensity - 20);
      if (this.state.intensity <= 10) {
        this.state.mood = config.mood;
        this.state.intensity = config.delta;
      }
    } else {
      this.state.mood = config.mood;
      this.state.intensity = Math.min(100, this.state.intensity + config.delta);
    }

    this.state.lastShift = Date.now();
    this._save();
  }

  /**
   * Apply time-based decay toward neutral.
   */
  _applyDecay(): void {
    const now = Date.now();
    const elapsed = now - (this.state.lastDecay || now);
    const ticks = Math.floor(elapsed / MOOD_DECAY_MS);

    if (ticks > 0) {
      this.state.intensity = Math.max(0, this.state.intensity - ticks * DECAY_AMOUNT);
      this.state.lastDecay = now;
      if (this.state.intensity <= 0) {
        this.state.mood = 'neutral';
      }
      this._save();
    }
  }

  /**
   * Get a human-readable mood status for display.
   */
  getStatus(): MoodStatus {
    const { mood, intensity } = this.getMood();
    const labels: Record<MoodType, string> = {
      neutral: '\u{1F610} neutral \u2014 just vibing',
      chaotic: '\u{1F92A} chaotic \u2014 gremlin mode activated',
      chill: '\u{1F60E} chill \u2014 almost friendly (don\'t get used to it)',
      petty: '\u{1F485} petty \u2014 holding grudges and names',
      bored: '\u{1F611} bored \u2014 couldn\'t care less',
      unhinged: '\u{1F525} UNHINGED \u2014 no filter, no mercy',
      soft: '\u{1F97A} soft \u2014 (don\'t tell anyone)',
    };
    return { mood, intensity, label: labels[mood] || labels.neutral };
  }
}

export const mood = new MoodSystem();
