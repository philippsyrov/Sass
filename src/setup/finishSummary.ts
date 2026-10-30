/**
 * Privacy lines and setup recap shown at the end of the wizard.
 */

import type { ProviderPreset } from './validate.js';
import { inviteUrl } from './validate.js';
import { describeDatabaseSummary } from './databaseStep.js';
import { describeApiEndpoint, resolveChatOpenAIConfig, resolveEmbeddingOpenAIConfig } from '../ai/clientConfig.js';
import { success, warn, note, summaryBox, blank } from './terminal.js';
import { mascotPlan, printMascot } from './mascot.js';

export interface FinishContext {
  preset: ProviderPreset;
  values: Record<string, string | undefined>;
  intentsConfirmed: boolean;
  skipped: string[];
  wroteEnv: boolean;
  startedNow: boolean;
}

function chatPrivacyLine(preset: ProviderPreset, values: Record<string, string | undefined>): string {
  if (preset.aiProvider === 'ollama') {
    const model = values.OLLAMA_MODEL ?? 'llama3.1:8b';
    return `Chat: local Ollama (${model}) — not sent to the cloud`;
  }
  const chat = resolveChatOpenAIConfig({
    OPENAI_BASE_URL: values.OPENAI_BASE_URL ?? '',
    OPENAI_API_KEY: values.OPENAI_API_KEY ?? '',
  } as unknown as NodeJS.ProcessEnv);
  const host = describeApiEndpoint(chat.baseURL, 'api.openai.com');
  if (preset.key === 'lmstudio') {
    return `Chat: local LM Studio (${values.OPENAI_MODEL ?? 'loaded model'}) — not sent to the cloud`;
  }
  const label = preset.key === 'anthropic' ? 'Anthropic' : preset.label.replace(/ \(.*\)$/, '');
  return `Chat: ${label} — messages go to ${host}`;
}

function embeddingPrivacyLine(values: Record<string, string | undefined>): string | null {
  if (!values.DATABASE_URL && values.SASS_EMBEDDED_PG !== '1') return null;
  if (values.SASS_EMBEDDING_PROVIDER === 'local') {
    return 'Memory search: on this Mac';
  }
  if (values.SASS_EMBEDDING_PROVIDER === 'off') {
    return 'Memory search: off until configured';
  }
  const embed = resolveEmbeddingOpenAIConfig({
    EMBEDDING_OPENAI_BASE_URL: values.EMBEDDING_OPENAI_BASE_URL ?? '',
    EMBEDDING_OPENAI_API_KEY: values.EMBEDDING_OPENAI_API_KEY ?? '',
    OPENAI_BASE_URL: values.OPENAI_BASE_URL ?? '',
    OPENAI_API_KEY: values.OPENAI_API_KEY ?? '',
  } as unknown as NodeJS.ProcessEnv);
  if (!embed.apiKey) return 'Embeddings: not set — vector memory will fail until configured';
  const host = describeApiEndpoint(embed.baseURL, 'api.openai.com');
  if (embed.apiKey === 'ollama' || host.includes('11434')) {
    return 'Embeddings: local Ollama — not sent to the cloud';
  }
  if (host.includes('1234')) {
    return 'Embeddings: local LM Studio';
  }
  return `Embeddings: cloud (${host})`;
}

function databasePrivacyLine(values: Record<string, string | undefined>): string {
  if (values.SASS_EMBEDDED_PG === '1') {
    return 'Memory DB: this machine (.sass-data/)';
  }
  if (values.DATABASE_URL) {
    return 'Memory DB: hosted Postgres (DATABASE_URL)';
  }
  return 'Memory DB: off — affinity and vector memory disabled';
}

function configuredSummary(values: Record<string, string | undefined>, preset: ProviderPreset): string[] {
  const lines: string[] = [];
  lines.push(`Discord app ${values.CLIENT_ID ?? '(missing)'}`);
  lines.push(`AI: ${preset.label}`);
  lines.push(`Database: ${describeDatabaseSummary(values)}`);
  if (values.OPENAI_MODEL) lines.push(`Chat model: ${values.OPENAI_MODEL}`);
  if (values.OLLAMA_MODEL) lines.push(`Chat model: ${values.OLLAMA_MODEL}`);
  return lines;
}

export function printPrivacyAndRecap(ctx: FinishContext): void {
  const { preset, values, intentsConfirmed, skipped } = ctx;
  note('Summary');
  for (const line of configuredSummary(values, preset)) success(line);
  blank();
  note('Privacy');
  success(databasePrivacyLine(values));
  const chat = chatPrivacyLine(preset, values);
  if (chat.includes('local') || chat.includes('not sent')) success(chat);
  else note(chat);
  const emb = embeddingPrivacyLine(values);
  if (emb) {
    if (emb.includes('local') || emb.includes('not sent')) success(emb);
    else if (emb.includes('not set')) warn(emb);
    else note(emb);
  }
  const still = [...skipped];
  if (!intentsConfirmed) still.push('Discord Presence + Message Content intents');
  if (still.length > 0) warn(`Still missing or skipped: ${still.join('; ')}`);
}

export async function printFinalScreen(ctx: FinishContext): Promise<void> {
  printPrivacyAndRecap(ctx);
  const clientId = ctx.values.CLIENT_ID ?? '';
  const invite = clientId ? inviteUrl(clientId) : '(set CLIENT_ID in .env first)';
  const lines = [
    'Next:    sass start',
    'Stop:    Ctrl+C in that terminal',
    'Change:  sass setup',
    'Health:  sass doctor',
    'Remove:  sass uninstall',
    '',
    'Slash commands (once): node dist/register-commands.js',
    '',
    'Invite Sass to a server:',
    invite,
  ];
  if (!ctx.intentsConfirmed) {
    lines.splice(6, 0, 'Discord: turn on Presence + Message Content intents (Bot tab).');
  }
  if (!ctx.wroteEnv) {
    lines[0] = 'Next:    sass setup  (no .env was written this run)';
  } else if (ctx.startedNow) {
    lines[0] = 'Next:    Sass is starting (or run sass start)';
  }
  summaryBox(lines);
  if (ctx.wroteEnv) {
    await printMascot(mascotPlan(false));
    note('She\'s ready.');
  }
}
