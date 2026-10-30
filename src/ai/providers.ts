import { Ollama, type Message as OllamaMessage } from 'ollama';
import OpenAI from 'openai';
import { resolveChatOpenAIConfig, resolveEmbeddingOpenAIConfig } from './clientConfig.js';
import { replyTokenBudget, isReasoningChatModel } from './replyBudget.js';
import type { QueryAIOptions, AIResponse } from '../types.js';
import { SASS_SYSTEM_PROMPT, fixCustomEmoji } from './prompts.js';

type UserContent = string | OpenAI.ChatCompletionContentPart[];

let openaiClient: OpenAI | null = null;
let embeddingOpenaiClient: OpenAI | null = null;

function buildOpenAIClient(config: ReturnType<typeof resolveChatOpenAIConfig>): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    ...(config.anthropicVersionHeader ? { defaultHeaders: { 'anthropic-version': '2023-06-01' } } : {}),
  });
}

/** OpenAI SDK client for chat when AI_PROVIDER=openai (OpenAI, Anthropic, LM Studio, …). */
export function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = buildOpenAIClient(resolveChatOpenAIConfig());
  }
  return openaiClient;
}

/** OpenAI SDK client for vector-memory embeddings (may differ from chat host). */
export function getEmbeddingOpenAI(): OpenAI {
  if (!embeddingOpenaiClient) {
    embeddingOpenaiClient = buildOpenAIClient(resolveEmbeddingOpenAIConfig());
  }
  return embeddingOpenaiClient;
}

/** @internal Test hook — reset cached clients after env changes. */
export function resetOpenAIClientsForTests(): void {
  openaiClient = null;
  embeddingOpenaiClient = null;
}

/**
 * Send a prompt to the configured AI provider and get a response with token usage.
 */
export class UnsupportedAIProviderError extends Error {
  constructor(provider: string) {
    super(`Unsupported AI provider: ${provider}`);
    this.name = 'UnsupportedAIProviderError';
  }
}

export async function queryAIWithUsage(prompt: string, options: QueryAIOptions = {}): Promise<AIResponse> {
  const { systemPrompt = SASS_SYSTEM_PROMPT, imageUrl = null, maxTokens, temperature, signal, timeoutMs } = options;
  const signals = [signal, timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs)].filter((s): s is AbortSignal => s !== undefined);
  const requestSignal = signals.length ? AbortSignal.any(signals) : undefined;
  const provider = process.env.AI_PROVIDER || 'ollama';

  let result: AIResponse;
  switch (provider) {
    case 'ollama':
      result = { text: await queryOllama(prompt, systemPrompt, imageUrl ?? null, maxTokens, temperature, requestSignal) };
      break;
    case 'openai':
      result = await queryOpenAIWithUsage(prompt, systemPrompt, imageUrl ?? null, maxTokens, temperature, requestSignal, timeoutMs);
      break;
    default:
      throw new UnsupportedAIProviderError(provider);
  }

  // Fix hallucinated custom emoji IDs
  if (result.text) result.text = fixCustomEmoji(result.text);
  return result;
}

/**
 * Send a prompt to the configured AI provider and get a response (text only).
 * Convenience wrapper — use queryAIWithUsage when you need token counts.
 */
export async function queryAI(prompt: string, options: QueryAIOptions = {}): Promise<string | null> {
  const result = await queryAIWithUsage(prompt, options);
  return result.text;
}

// --- Provider implementations ---

async function queryOllama(prompt: string, systemPrompt: string, imageUrl: string | null, maxTokens?: number, temperature?: number, signal?: AbortSignal): Promise<string | null> {
  try {
    return await chatOllama(systemPrompt, prompt, imageUrl, { maxTokens, temperature, signal });
  } catch (err) {
    if (signal?.aborted) throw signal.reason;
    console.error('Ollama query failed:', (err as Error).message);
    return null;
  }
}

/**
 * Chat with Ollama's native API. It takes image bytes rather than URLs, so an attached
 * image is downloaded first. Text-only models can reject images, so that retries once without it.
 */
export async function chatOllama(systemPrompt: string, prompt: string, imageUrl: string | null = null, options: QueryAIOptions = {}): Promise<string> {
  const { signal, maxTokens, temperature } = options;
  signal?.throwIfAborted();
  const ollama = new Ollama({
    host: process.env.OLLAMA_HOST || 'http://localhost:11434',
    fetch: (input, init) => fetch(input, { ...init, signal }),
  });
  const model = process.env.OLLAMA_MODEL || 'llama3.1:8b';

  const ask = async (images?: Uint8Array[]): Promise<string> => {
    const messages: OllamaMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt, ...(images ? { images } : {}) },
    ];
    const request = ollama.chat({ model, messages, options: { num_predict: replyTokenBudget(model, false, maxTokens), ...(temperature === undefined ? {} : { temperature }) } });
    if (!signal) return (await request).message.content;
    signal.throwIfAborted();
    let onAbort: () => void = () => undefined;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try { return (await Promise.race([request, aborted])).message.content; }
    finally { signal.removeEventListener('abort', onAbort); }
  };

  const image = imageUrl ? await fetchImageBytes(imageUrl, signal) : null;
  if (!image) return ask();
  try {
    return await ask([image]);
  } catch (err) {
    if (signal?.aborted) throw signal.reason;
    console.error(`Ollama image input failed (is ${model} a vision model?), retrying without it:`, (err as Error).message);
    return ask();
  }
}

async function fetchImageBytes(url: string, signal?: AbortSignal): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    if (signal?.aborted) throw signal.reason;
    console.error('Image download failed:', (err as Error).message);
    return null;
  }
}

async function queryOpenAIWithUsage(prompt: string, systemPrompt: string, imageUrl: string | null = null, maxTokens?: number, overrideTemperature?: number, signal?: AbortSignal, timeoutMs?: number): Promise<AIResponse> {
  // Guard against empty user content — API rejects empty messages
  if (!prompt?.trim() && !imageUrl) {
    console.error('queryOpenAI called with empty prompt and no image');
    return { text: null };
  }

  const openai = getOpenAI();

  // Build user content — text only or text + image
  let userContent: UserContent;
  if (imageUrl) {
    userContent = [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } },
    ];
  } else {
    userContent = prompt;
  }

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];

  // Use mood-adjusted temperature if provided, otherwise default
  const temperature = overrideTemperature ?? 1.2;

  const anthropic = resolveChatOpenAIConfig().anthropicVersionHeader;
  const model = process.env.OPENAI_MODEL || 'gpt-5.4-mini';
  const completionLimit = replyTokenBudget(model, anthropic, maxTokens);
  const fixedSampling = anthropic || /(?:^|\/)claude-/.test(model) || isReasoningChatModel(model);
  const response = await openai.chat.completions.create({
    model,
    messages,
    max_completion_tokens: completionLimit,
    // Current Claude models reject sampling overrides below their fixed default.
    ...(fixedSampling ? {} : { temperature }),
  }, { signal, ...(timeoutMs === undefined ? {} : { timeout: timeoutMs, maxRetries: 0 }) });

  const promptTokens = response.usage?.prompt_tokens;
  const completionTokens = response.usage?.completion_tokens;
  if (promptTokens != null || completionTokens != null) {
    console.log(`[TOKENS] prompt=${promptTokens} completion=${completionTokens}`);
  } else {
    console.log('[TOKENS] usage data missing from OpenAI response');
  }

  const choice = response.choices[0];
  const content = choice?.message?.content;
  const text = typeof content === 'string' && content.trim() ? content : null;
  if (!text) {
    const reason = choice?.finish_reason ?? 'unknown';
    const finish = ['stop', 'length', 'tool_calls', 'content_filter', 'function_call'].includes(reason) ? reason : 'unknown';
    const reasoning = response.usage?.completion_tokens_details?.reasoning_tokens;
    console.warn(`[AI] No reply text: finish=${finish}; completion=${typeof completionTokens === 'number' ? completionTokens : 'unknown'}; reasoning=${typeof reasoning === 'number' ? reasoning : 'unknown'}; limit=${completionLimit}`);
  }
  return {
    text,
    promptTokens,
    completionTokens,
  };
}
