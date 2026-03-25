import { Ollama, type Message as OllamaMessage } from 'ollama';
import OpenAI from 'openai';
import type { QueryAIOptions } from '../types.js';
import { SASS_SYSTEM_PROMPT, fixCustomEmoji } from './prompts.js';

type UserContent = string | OpenAI.ChatCompletionContentPart[];

let openaiClient: OpenAI | null = null;
export function getOpenAI(): OpenAI {
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openaiClient;
}

/**
 * Send a prompt to the configured AI provider and get a response.
 */
export async function queryAI(prompt: string, { systemPrompt = SASS_SYSTEM_PROMPT, imageUrl = null, maxTokens, temperature }: QueryAIOptions = {}): Promise<string | null> {
  const provider = process.env.AI_PROVIDER || 'ollama';

  let result: string | null;
  switch (provider) {
    case 'ollama':
      result = await queryOllama(prompt, systemPrompt);
      break;
    case 'openai':
      result = await queryOpenAI(prompt, systemPrompt, imageUrl ?? null, maxTokens, temperature);
      break;
    default:
      return "girl whoever set me up didn't even configure my brain properly, I literally can't think rn";
  }

  // Fix hallucinated custom emoji IDs
  if (result) result = fixCustomEmoji(result);
  return result;
}

// --- Provider implementations ---

async function queryOllama(prompt: string, systemPrompt: string): Promise<string | null> {
  const ollama = new Ollama({
    host: process.env.OLLAMA_HOST || 'http://localhost:11434',
  });

  const messages: OllamaMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt },
  ];

  const response = await ollama.chat({
    model: process.env.OLLAMA_MODEL || 'llama3.1:8b',
    messages,
  });

  return response.message.content;
}

async function queryOpenAI(prompt: string, systemPrompt: string, imageUrl: string | null = null, maxTokens?: number, overrideTemperature?: number): Promise<string | null> {
  // Guard against empty user content — API rejects empty messages
  if (!prompt?.trim() && !imageUrl) {
    console.error('queryOpenAI called with empty prompt and no image');
    return null;
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

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-5.4-mini',
    messages,
    max_completion_tokens: maxTokens ?? 100,
    temperature,
  });

  return response.choices[0]?.message?.content ?? null;
}
