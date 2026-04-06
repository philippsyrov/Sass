import * as mood from '../mood.js';
import * as userMemory from '../userMemory.js';
import { extractRoastTopic } from '../ai/index.js';
import { storeMemory } from '../vectorMemory.js';
import { validateResponse } from '../responseFilter.js';
import { setAutoSassCooldown } from '../cooldown.js';
import { recordResponse } from '../responseMemory.js';
import { logInteraction, updateAffinity, getAffinity } from '../database/index.js';
import { affinityGainCooldowns, AFFINITY_GAIN_COOLDOWN_MS } from '../handlers/mention/spamDetection.js';
import type { SassEvent, AIResponse } from '../types.js';
import { pickRandom } from './commandUtils.js';

const SAFE_FALLBACKS = ['no', 'anyway', "i'll pass", 'moving on'];

/**
 * Shared post-response pipeline for all AI response paths.
 *
 * Handles: validation → typing delay → send → record → log → affinity → roast tracking.
 * Returns true if response was sent, false if filtered/skipped.
 */
export interface ResponseOptions {
  event: SassEvent;
  response: string;
  aiResult?: AIResponse;
  userMessage: string;            // original user message (for DB logging)
  triggerType: string;            // 'mention' | 'auto-sass' | 'auto-sass-join' | 'auto-sass-activity'
  commandName?: string | null;
  onFiltered: 'skip' | 'fallback';
  sendMode: 'reply' | 'channel';
  trackRoast: boolean;
  updateAffinity: boolean;
  context?: string;               // full context string for DB logging
  affinity?: number;              // pre-fetched affinity (avoids re-query if already known)
}

export async function handleResponse(options: ResponseOptions): Promise<boolean> {
  const {
    event, aiResult, userMessage,
    triggerType, commandName = null,
    onFiltered, sendMode, trackRoast, updateAffinity: shouldUpdateAffinity,
    context,
  } = options;
  let { response } = options;

  // Step 1: Validate response
  if (!event.isCreator) {
    const validation = validateResponse(response);
    if (!validation.valid) {
      console.log(`[FILTER] ${triggerType} response filtered: ${validation.reason}`);
      if (onFiltered === 'skip') return false;
      // Fallback — replace response with safe one-liner, continue through pipeline
      response = pickRandom(SAFE_FALLBACKS) ?? 'no';
    }
  }

  // Step 2: Typing delay — feel more human
  await event.channel.sendTyping().catch((err) => console.error('sendTyping failed:', (err as Error).message));
  const delay = sendMode === 'reply'
    ? Math.min(1500 + response.length * 20, 4000)   // mention: length-based
    : 1000 + Math.random() * 2000;                    // auto-sass: random 1-3s
  await new Promise((resolve) => setTimeout(resolve, delay));

  // Step 3: Send response
  if (sendMode === 'reply') {
    await event.message.reply(response).catch((err) => console.error('Reply failed:', (err as Error).message));
  } else {
    await event.channel.send(response).catch((err) => console.error('Channel send failed:', (err as Error).message));
  }

  // Step 4: Record response for dedup
  recordResponse(event.channelId, response);

  // Step 5: Set auto-sass cooldown (prevents double-response in channel)
  setAutoSassCooldown(event.channelId);

  // Step 6: Log to database
  const moodStatus = await mood.getStatus(event.guildId);
  const logAffinity = options.affinity ?? await getAffinity(event.guildId, event.userId);
  logInteraction({
    serverId: event.guildId, serverName: event.message.guild?.name,
    channelId: event.channelId, channelName: event.channel.name,
    userId: event.userId, username: event.displayName,
    triggerType, commandName,
    userMessage, sassResponse: response,
    mood: moodStatus.mood, moodIntensity: moodStatus.intensity,
    context,
    affinity: logAffinity,
    promptTokens: aiResult?.promptTokens,
    completionTokens: aiResult?.completionTokens,
  }).catch((err) => console.error('Log interaction failed:', (err as Error).message));

  // Step 7: Affinity bump (+0.5, max once per 10 min)
  if (shouldUpdateAffinity) {
    const affinityKey = `${event.guildId}:${event.userId}`;
    const lastGain = affinityGainCooldowns.get(affinityKey) ?? 0;
    if (Date.now() - lastGain > AFFINITY_GAIN_COOLDOWN_MS) {
      affinityGainCooldowns.set(affinityKey, Date.now());
      updateAffinity(event.guildId, event.userId, 0.5).catch((err) => console.error('Affinity update failed:', (err as Error).message));
    }
  }

  // Step 8: Roast tracking
  if (trackRoast) {
    userMemory.recordRoast(event.guildId, event.userId).catch((err) => console.error('Record roast failed:', (err as Error).message));
    extractRoastTopic(userMessage).then((topic) => {
      if (topic) {
        userMemory.addRoast(event.guildId, event.userId, topic).catch((err) => console.error('Add roast failed:', (err as Error).message));
        storeMemory(event.guildId, event.userId, 'roast', topic).catch((err) => console.error('Store memory failed:', (err as Error).message));
      }
    }).catch((err) => console.error('Extract roast topic failed:', (err as Error).message));
  }

  return true;
}
