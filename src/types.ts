import type { Message, User, TextChannel } from 'discord.js';

// --- Environment ---
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    interface ProcessEnv {
      DISCORD_TOKEN: string;
      CLIENT_ID: string;
      AI_PROVIDER?: string;
      OPENAI_API_KEY?: string;
      OPENAI_BASE_URL?: string;
      OPENAI_MODEL?: string;
      OLLAMA_HOST?: string;
      OLLAMA_MODEL?: string;
      CREATOR_ID?: string;
      DATABASE_URL?: string;
      AUTO_SASS_CHANCE?: string;
      AUTO_SASS_MIN_MESSAGES?: string;
    }
  }
}

// --- Surface Adapter ---
// Clean parcel of data built once in messageCreate, passed to all handlers.
export interface SassEvent {
  guildId: string;
  channelId: string;
  userId: string;
  displayName: string;
  content: string;        // raw message content (mentions NOT stripped — handlers strip as needed)
  isCreator: boolean;
  message: Message;       // original Discord message
  channel: TextChannel;   // cast guild text channel
}

// --- Message Buffer ---
export interface BufferEntry {
  authorId: string;
  author: string;
  content: string;
  timestamp: number;
  isBot: boolean;
}

// --- User Memory ---
export interface UserData {
  name: string;
  roasts: string[];
  lastSeen: number;
  messageCount: number;
  timesRoasted: number;
  facts?: string[];
  coldShoulder?: ColdShoulderState;
  gender?: 'male' | 'female' | 'nonbinary' | null;
}

export interface ColdShoulderState {
  active: boolean;
  attemptsNeeded: number;
  attemptsMade: number;
}

export interface ColdShoulderStatus {
  phase: 'icy' | 'warming' | 'forgiven';
  attemptsMade?: number;
  attemptsNeeded?: number;
}

export interface WildQuote {
  userId: string;
  name: string;
  quote: string;
  timestamp: number;
}

export interface BeefRecord {
  incidents: number;
  firstBeef: number;
  lastBeef: number;
  lastTopic: string | null;
}

export interface LeaderboardEntry {
  id: string;
  name: string;
  timesRoasted: number;
}

export interface ServerStats {
  users: Record<string, UserData>;
  totalMessages: number;
  mostActive: UserData | null;
  mostRoasted: UserData | null;
}

// --- Mood ---
export type MoodType = 'neutral' | 'chaotic' | 'chill' | 'petty' | 'bored' | 'unhinged' | 'soft';
export type MoodEvent = 'complimented' | 'insulted' | 'chaos' | 'boring' | 'nice_to_each_other' | 'fighting' | 'begged_back';

export interface MoodState {
  mood: MoodType;
  intensity: number;
  lastShift: number;
  lastDecay: number;
}

export interface MoodStatus {
  mood: MoodType;
  intensity: number;
  label: string;
}

// --- AI ---
export interface QueryAIOptions {
  systemPrompt?: string;
  imageUrl?: string | null;
  maxTokens?: number;
  temperature?: number;
}

export interface AIResponse {
  text: string | null;
  promptTokens?: number;
  completionTokens?: number;
}

export interface GetSassResponseOptions {
  guildId?: string;
  recentContext?: string;
  userContext?: string;
  peopleContext?: string;
  isCreator?: boolean;
  mentionsCreator?: boolean;
  creatorName?: string | null;
  imageUrl?: string | null;
}

// --- Database ---
export interface InteractionLog {
  serverId?: string;
  serverName?: string;
  channelId: string;
  channelName?: string;
  userId: string;
  username: string;
  triggerType: string;
  commandName: string | null;
  userMessage: string;
  sassResponse: string;
  mood: string;
  moodIntensity: number;
  context?: string;
  promptTokens?: number;
  completionTokens?: number;
  affinity?: number;
}

export interface MoodLog {
  serverId?: string;
  oldMood: string;
  newMood: string;
  intensity: number;
  reason: string;
}

export interface CommandLog {
  serverId?: string;
  userId: string;
  commandName: string;
  commandType: 'slash' | 'mention';
}

export interface StatsResult {
  totalInteractions: number;
  last24h: number;
  byTrigger: Array<{ trigger_type: string; count: string }>;
  topUsers: Array<{ username: string; count: string }>;
  topCommands: Array<{ command_name: string; count: string }>;
}

export interface TrainingDataRow {
  user_message: string;
  sass_response: string;
  trigger_type: string;
  mood: string;
}

export interface ReactionLog {
  serverId?: string;
  channelId: string;
  messageId: string;
  sassResponse: string;
  reactorId: string;
  reactorName: string;
  emoji: string;
  emojiId?: string;
  isPositive: boolean;
}

// --- Context Compaction ---
export interface ChannelSummary {
  text: string;
  messageCount: number;
  timestamp: number;
}

// --- Vector Memory ---
export type MemoryType = 'roast' | 'fact' | 'statement' | 'quote';

export interface SearchResult {
  content: string;
  type: string;
  userId: string;
  score: number;
}

export interface MemoryRow {
  content: string;
  type: string;
}

// --- Contradiction Detection ---
export interface ContradictionResult {
  oldStatement: string;
  newStatement: string;
}

// --- Commands ---
export interface BattleState {
  challenger: User;
  opponent: User;
  threadId: string;
  round: number;
  maxRounds: number;
  scores: Record<string, number[]>;
  phase: 'waiting' | 'active';
  currentTurn: string | null;
  timeout: ReturnType<typeof setTimeout> | null;
  turnTimeout: ReturnType<typeof setTimeout> | null;
  startedAt: number;
}

// Re-export Message for convenience
export type { Message };
