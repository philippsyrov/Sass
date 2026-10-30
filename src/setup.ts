import { usesSimpleSetup, prepareLocalMemory } from './setup/localFirstRun.js';
import { startAfterSetup } from './setup/startAfterSetup.js';
/**
 * `npm run setup`: interactive first-time setup. Asks for the Discord and AI settings,
 * checks them, writes .env (after confirming, with a backup of any existing file) and
 * can build, register slash commands and start the bot.
 *
 * Secrets are read without echo and never printed. Answers can also be piped in,
 * one per line, which is how the prompts are tested without a terminal.
 */
import { copyFileSync, chmodSync, existsSync, readFileSync, writeFileSync } from 'fs';
import * as clack from '@clack/prompts';
import dotenv from 'dotenv';
import {
  PROVIDERS,
  type ProviderPreset,
  botIdFromToken,
  checkApiKey,
  checkChance,
  checkDatabaseUrl,
  checkDiscordToken,
  checkModel,
  checkPositiveInt,
  checkSnowflake,
  describeSecret,
  isPlaceholder,
  normalizeBaseUrl,
  normalizeHost,
  renderEnv,
} from './setup/validate.js';
import { fetchDiscordApp, hasOllamaModel, listAnthropicModels, listOpenAIModels } from './setup/checks.js';
import {
  applyEmbeddedDatabase,
  applyHostedDatabase,
  applySkipDatabase,
  DATABASE_CHOICE_LABELS,
  describeDatabaseSummary,
  SKIP_DATABASE_LINES,
} from './setup/databaseStep.js';
import { provisionExternalPostgres } from './setup/externalPostgres.js';
import { verifyDatabaseConnection } from './setup/verifyDatabase.js';
import { ensureEmbeddedPostgresRunning } from './database/embeddedPostgres.js';
import { connectPool, setConnected } from './database/pool.js';
import { createSchema } from './database/schema.js';
import {
  discordAppBotLink,
  discordAppBotUrl,
  discordApplicationsLink,
  DISCORD_APPLICATIONS_URL,
  discordAppInformationUrl,
  ollamaDownloadPageLink,
  providerKeyUrl,
} from './setup/links.js';
import {
  defaultOllamaChatModelIndex,
  lmStudioChatModels,
  ollamaChatModels,
  RECOMMENDED_OLLAMA_CHAT_PULL,
} from './setup/ollamaModels.js';
import {
  ollamaPullSizeHint,
  probeLmStudio,
  probeOllama,
} from './setup/localBootstrap.js';
import {
  cancelAllActiveWork,
  installSetupCancelHandlers,
  partialOllamaDownloadHint,
  SetupCancelledError,
} from './setup/cancelRegistry.js';
import { ollamaPullHttpWithProgress } from './setup/ollamaHttp.js';
import {
  buildProviderMenu,
  defaultProviderIndex,
  detectLocalRuntimes,
  menuIndexForEnvPreset,
} from './setup/providerPick.js';
import { printWelcomeBanner, pickGreeting } from './setup/banner.js';
import { createSetupPrompter, InputEnded, shouldUseClackPrompter, type SetupPrompter } from './setup/createPrompter.js';
import { printFinalScreen, type FinishContext } from './setup/finishSummary.js';
import { shouldUseInkTui } from './setup/shouldUseInkTui.js';
import { setInkStep } from './setup/tui/prompterBridge.js';
import {
  DEFAULT_ANTHROPIC_SONNET_MODEL,
  pickDefaultAnthropicModel,
  sortAnthropicModelsForSelect,
} from './setup/anthropicModels.js';
import { pickDefaultOpenAIModel } from './setup/openaiModels.js';
import { setupMemorySearch } from './setup/memorySearchStep.js';
import { runWithSpinner } from './setup/spinner.js';
import { isInkSessionActive } from './setup/tui/prompterBridge.js';
import { runTrackedCommand } from './setup/spawnTracked.js';
import {
  blank,
  explain,
  fieldHelp,
  note,
  printWrapped,
  sectionStep,
  success,
  summaryBox,
  warn,
} from './setup/terminal.js';
import { EMOJI_DIR, listEmojiFiles, summarizeUpload, uploadMissingEmoji } from './emojiUpload.js';
import { AVATAR_PATH, BANNER_PATH, setMissingProfileImages, summarizeProfile } from './profileAssets.js';

const ENV_PATH = '.env';
const EXAMPLE_PATH = '.env.example';

/** Set once .env has been written, so cancel messages stay truthful. */
let envWritten = false;
let cancelExitStarted = false;

function nothingWrittenNote(): string {
  return envWritten ? 'The new .env was already written.' : 'Nothing was written.';
}

function exitSetupCancelled(): void {
  if (cancelExitStarted) return;
  cancelExitStarted = true;
  cancelAllActiveWork();
  if (process.env.SASS_INSTALL_FRAME === '1') process.stdout.write('\u001b[H\u001b[2J');
  console.log(`\n\nSetup cancelled. ${nothingWrittenNote()}`);
  note(partialOllamaDownloadHint('<model>'));
  note('List models with: ollama list');
  process.exit(130);
}

function readExistingEnv(): Record<string, string> {
  if (!existsSync(ENV_PATH)) return {};
  try {
    const parsed = dotenv.parse(readFileSync(ENV_PATH));
    // Placeholders from .env.example are not useful defaults.
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => value.trim() !== '' && !isPlaceholder(value)));
  } catch (err) {
    warn(`Could not read the existing .env (${(err as Error).message}); starting fresh.`);
    return {};
  }
}

function presetFromEnv(env: Record<string, string>): number {
  if (env.AI_PROVIDER === 'ollama') return PROVIDERS.findIndex((p) => p.key === 'ollama');
  const base = env.OPENAI_BASE_URL?.replace(/\/+$/, '');
  if (!base) {
    return env.AI_PROVIDER === 'openai'
      ? PROVIDERS.findIndex((p) => p.key === 'openai')
      : PROVIDERS.findIndex((p) => p.key === 'anthropic');
  }
  const match = PROVIDERS.findIndex((p) => p.baseUrl === base);
  return match >= 0 ? match : PROVIDERS.findIndex((p) => p.key === 'other');
}

function skipLocalBootstrap(): boolean {
  return process.env.SASS_TEST_SKIP_LOCAL_BOOTSTRAP === '1' || process.env.SASS_TEST_SKIP_EMBEDDED === '1';
}

async function runStep(command: string, args: string[]): Promise<boolean> {
  console.log(`\n$ ${command} ${args.join(' ')}`);
  try {
    const code = await runTrackedCommand(command, args, { stdio: isInkSessionActive() ? ['ignore', 'pipe', 'pipe'] : 'inherit', shell: process.platform === 'win32' });
    return code === 0;
  } catch (err) {
    console.error(`Could not run ${command}: ${(err as Error).message}`);
    return false;
  }
}

async function pullOllamaModel(host: string, model: string): Promise<boolean> {
  try {
    return await ollamaPullHttpWithProgress(host, model);
  } catch (err) {
    if (err instanceof SetupCancelledError) throw err;
    return false;
  }
}

function beginStep(step: number, title: string): void {
  if (shouldUseInkTui()) setInkStep(step, title);
  else sectionStep(step, title);
}

async function setupDiscord(p: SetupPrompter, env: Record<string, string>, values: Record<string, string | undefined>): Promise<boolean> {
  beginStep(1, 'Discord bot');
  if (usesSimpleSetup()) {
    note('Create your Discord bot and enable Presence and Message Content intents.');
    note(DISCORD_APPLICATIONS_URL);
    for (;;) {
      const token = await p.askValid('Discord bot token', checkDiscordToken, { fallback: env.DISCORD_TOKEN, secret: true });
      const checked = await runWithSpinner('Connecting Discord', () => fetchDiscordApp(token));
      if (!checked.ok) { warn(checked.error); continue; }
      if (!checked.data.presenceIntent || !checked.data.messageContentIntent) {
        warn('Enable Presence and Message Content intents in your Discord bot settings, then retry.');
        await p.ask('Press Enter after enabling both intents');
        continue;
      }
      const identity = checkSnowflake(checked.data.id, 'Application ID');
      if (!identity.ok) throw new Error('Discord did not return a valid Application ID.');
      values.DISCORD_TOKEN = token;
      values.CLIENT_ID = checked.data.id;
      values.CREATOR_ID = env.CREATOR_ID || checked.data.ownerId;
      if (!values.CREATOR_ID) values.CREATOR_ID = await p.askValid('Your Discord user ID', raw => checkSnowflake(raw, 'Your user ID'));
      return true;
    }
  }


  printWrapped('Sass needs a Discord bot app and your personal Discord user ID. Create one in the Developer Portal if you do not have one yet.');
  note(`  ${discordApplicationsLink()}`);
  blank();

  fieldHelp('Application ID — the number Discord shows for your app.', {
    url: env.CLIENT_ID ? discordAppInformationUrl(env.CLIENT_ID) : DISCORD_APPLICATIONS_URL,
    text: 'Open Application ID',
  });
  let clientId = await p.askValid('Application ID (CLIENT_ID)', (raw) => checkSnowflake(raw, 'The Application ID'), {
    fallback: env.CLIENT_ID,
  });
  values.CLIENT_ID = clientId;

  fieldHelp('Bot token — shown once when you reset it. Your typing stays hidden.', {
    url: discordAppBotUrl(clientId),
    text: 'Reset bot token',
  });
  const token = await p.askValid('Bot token (DISCORD_TOKEN)', checkDiscordToken, { fallback: env.DISCORD_TOKEN, secret: true });
  values.DISCORD_TOKEN = token;

  const botId = botIdFromToken(token);
  if (botId && clientId !== botId) {
    warn(`The token belongs to app ${botId}, but CLIENT_ID is ${clientId}. They should usually match.`);
    if (await p.confirm(`Use ${botId} as CLIENT_ID?`, true)) {
      clientId = botId;
      values.CLIENT_ID = botId;
    }
  }

  fieldHelp('Your Discord user ID — friend mode; Sass never roasts you.', {
    url: 'https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID',
    text: 'How to copy your user ID',
  });
  const creatorId = await p.askValid('Your Discord user ID (CREATOR_ID)', (raw) => {
    const result = checkSnowflake(raw, 'Your user ID');
    if (result.ok && (result.value === clientId || result.value === botId)) {
      return { ok: false, error: 'That is the bot\'s ID. CREATOR_ID is your own account\'s ID.' };
    }
    return result;
  }, { fallback: env.CREATOR_ID });
  values.CREATOR_ID = creatorId;

  let intentsConfirmed = false;
  blank();
  if (await p.confirm('Check the token with Discord now?', true)) {
    const result = await runWithSpinner('Checking token with Discord', () => fetchDiscordApp(token));
    if (!result.ok) {
      warn(result.error);
    } else {
      const app = result.data;
      success(`Token works for "${app.name}".`);
      if (app.id && app.id !== clientId) {
        warn(`This token's application ID is ${app.id}, not ${clientId}.`);
        if (await p.confirm(`Use ${app.id} as CLIENT_ID?`, true)) values.CLIENT_ID = app.id;
      }
      if (!app.presenceIntent || !app.messageContentIntent) {
        const missing = [!app.presenceIntent && 'Presence Intent', !app.messageContentIntent && 'Message Content Intent'].filter(Boolean).join(' and ');
        warn(`${missing} is off. Enable under Bot → Privileged Gateway Intents.`);
        note(discordAppBotLink(values.CLIENT_ID ?? clientId));
      } else {
        intentsConfirmed = true;
        success('Presence and Message Content intents are on.');
      }
    }
  }
  return intentsConfirmed;
}

async function checkOpenAIModel(p: SetupPrompter, preset: ProviderPreset, baseUrl: string, apiKey: string, model: string): Promise<void> {
  if (!usesSimpleSetup() && !(await p.confirm('Check the key and model name against the API now?', true))) return;
  const label = preset.key === 'anthropic' ? 'Checking Anthropic key and models' : 'Checking API key and models';
  const result = await runWithSpinner(label, () => (preset.key === 'anthropic'
    ? listAnthropicModels(apiKey)
    : listOpenAIModels(baseUrl, apiKey)));
  if (!result.ok) {
    warn(result.error);
    return;
  }
  const ids = result.data;
  if (ids.length === 0 || ids.includes(model)) {
    note(ids.length === 0 ? 'The API answered but listed no models.' : `Key works and "${model}" is available.`);
    return;
  }
  warn(`Key works, but "${model}" is not in the provider's model list.`);
  const needle = model.toLowerCase().split(/[/:]/).pop() ?? model.toLowerCase();
  const similar = ids.filter((id) => id.toLowerCase().includes(needle.slice(0, 6))).slice(0, 10);
  if (similar.length > 0) note(`Similar names: ${similar.join(', ')}`);
}

async function setupOpenAICompatible(p: SetupPrompter, preset: ProviderPreset, env: Record<string, string>, sameProvider: boolean, values: Record<string, string | undefined>): Promise<void> {
  if (preset.key === 'lmstudio') {
    explain('LM Studio serves an OpenAI-compatible API on this machine — no cloud API key.');
    const probe = await probeLmStudio(preset.baseUrl ?? 'http://127.0.0.1:1234/v1');
    if (!probe.running) {
      warn('LM Studio is not responding on http://127.0.0.1:1234 — open LM Studio, load a chat model, and start the local server.');
    } else {
      const chat = lmStudioChatModels(probe.models);
      if (chat.length > 0) {
        note(`Loaded chat models: ${chat.slice(0, 8).join(', ')}${chat.length > 8 ? '…' : ''}`);
      } else if (probe.models.length > 0) {
        note('Only embedding models are loaded — load a chat model in LM Studio.');
      } else {
        note('LM Studio answered but listed no models — load one in the app first.');
      }
    }
    blank();
  }

  let baseUrl = preset.baseUrl ?? '';
  if (preset.askBaseUrl) {
    blank();
    explain('API base URL for your OpenAI-compatible host (usually ends in /v1).');
    baseUrl = await p.askValid('Base URL', normalizeBaseUrl, { fallback: sameProvider ? env.OPENAI_BASE_URL : undefined });
  }
  values.OPENAI_BASE_URL = baseUrl;

  let apiKey: string;
  if (preset.localKey) {
    apiKey = preset.localKey;
    note(`${preset.label} ignores the API key; using "${apiKey}".`);
  } else {
    blank();
    const keyUrl = providerKeyUrl(preset.key);
    if (keyUrl) {
      fieldHelp(`${preset.label} API key for chat.`, { url: keyUrl, text: 'Create API key' });
    } else {
      explain(`${preset.label} API key for chat (and memory embeddings when supported).`);
    }
    apiKey = await p.askValid(preset.askBaseUrl ? 'API key' : `${preset.label} API key`, (raw) => checkApiKey(raw, preset.key), {
      fallback: sameProvider ? env.OPENAI_API_KEY : undefined,
      secret: true,
    });
  }
  values.OPENAI_API_KEY = apiKey;

  const defaultModels: Record<string, string> = {
    openai: 'gpt-4o-mini',
    anthropic: DEFAULT_ANTHROPIC_SONNET_MODEL,
    lmstudio: '',
  };
  let fallbackModel = sameProvider ? env.OPENAI_MODEL : defaultModels[preset.key];
  if (preset.key === 'lmstudio' && !fallbackModel) {
    const probe = await probeLmStudio(baseUrl || 'http://127.0.0.1:1234/v1');
    fallbackModel = probe.models[0];
  }
  blank();
  const skipApiList = process.env.SASS_TEST_SKIP_EMBEDDED === '1' || process.env.SASS_TEST_SKIP_API_CHECKS === '1';
  let model: string;
  if (preset.key === 'anthropic') {
    if (skipApiList) {
      model = usesSimpleSetup() ? (fallbackModel ?? DEFAULT_ANTHROPIC_SONNET_MODEL) : await p.askValid('Claude model', checkModel, { fallback: fallbackModel ?? env.OPENAI_MODEL });
      values.OPENAI_MODEL = model;
      note('Change later with sass setup or edit ~/Sass/.env (OPENAI_MODEL).');
      return;
    }
    const listResult = await runWithSpinner('Checking your Anthropic key', () => listAnthropicModels(apiKey));
    if (listResult.ok && listResult.data.length > 0) {
      const models = sortAnthropicModelsForSelect(listResult.data);
      const def = pickDefaultAnthropicModel(models) ?? models[0] ?? '';
      const defIdx = Math.max(0, models.indexOf(def));
      model = usesSimpleSetup() ? (sameProvider && env.OPENAI_MODEL && models.includes(env.OPENAI_MODEL) ? env.OPENAI_MODEL : def) : models.length === 1
        ? (models[0] ?? def)
        : (models[await p.choose('Claude model', models, defIdx)] ?? def);
    } else {
      if (!listResult.ok) { if (usesSimpleSetup()) throw new Error(listResult.error); warn(listResult.error); }
      model = usesSimpleSetup() ? (fallbackModel ?? DEFAULT_ANTHROPIC_SONNET_MODEL) : await p.askValid('Claude model', checkModel, { fallback: fallbackModel ?? env.OPENAI_MODEL });
    }
  } else if (preset.key === 'openai') {
    if (skipApiList) {
      model = usesSimpleSetup() ? (fallbackModel ?? 'gpt-4o-mini') : await p.askValid('Chat model', checkModel, { fallback: fallbackModel });
      values.OPENAI_MODEL = model;
      note('Change later with sass setup or edit ~/Sass/.env (OPENAI_MODEL).');
      return;
    }
    const listResult = await runWithSpinner('Checking your OpenAI key', () => listOpenAIModels(baseUrl || 'https://api.openai.com/v1', apiKey));
    if (listResult.ok && listResult.data.length > 0) {
      const models = [...listResult.data].sort();
      const def = pickDefaultOpenAIModel(models) ?? models[0] ?? '';
      const defIdx = Math.max(0, models.indexOf(def));
      model = usesSimpleSetup() ? (sameProvider && env.OPENAI_MODEL && models.includes(env.OPENAI_MODEL) ? env.OPENAI_MODEL : def) : models.length === 1
        ? (models[0] ?? def)
        : (models[await p.choose('Chat model', models, defIdx)] ?? def);
    } else {
      if (!listResult.ok) { if (usesSimpleSetup()) throw new Error(listResult.error); warn(listResult.error); }
      model = usesSimpleSetup() ? (fallbackModel ?? 'gpt-4o-mini') : await p.askValid('Chat model', checkModel, { fallback: fallbackModel });
    }
  } else {
    if (preset.key !== 'openai') explain('Use the model name exactly as your provider lists it.');
    model = await p.askValid('Chat model', checkModel, { fallback: fallbackModel });
    await checkOpenAIModel(p, preset, baseUrl || 'https://api.openai.com/v1', apiKey, model);
  }
  values.OPENAI_MODEL = model;
  note('Change later with sass setup or edit ~/Sass/.env (OPENAI_MODEL).');
}

async function pickOllamaChatModel(
  p: SetupPrompter,
  chatModels: string[],
  envModel: string | undefined,
): Promise<string> {
  if (chatModels.length === 0) {
    throw new Error('pickOllamaChatModel requires at least one installed chat model');
  }
  if (chatModels.length === 1) {
    const only = chatModels[0];
    if (!only) throw new Error('pickOllamaChatModel requires at least one installed chat model');
    note(`Chat model: ${only}`);
    return only;
  }
  const defaultIdx = defaultOllamaChatModelIndex(chatModels, envModel);
  const idx = await p.choose('Chat model (OLLAMA_MODEL)', chatModels, defaultIdx);
  const picked = chatModels[idx] ?? chatModels[defaultIdx];
  if (!picked) throw new Error('pickOllamaChatModel requires at least one installed chat model');
  return picked;
}

async function setupOllama(p: SetupPrompter, env: Record<string, string>, values: Record<string, string | undefined>): Promise<void> {
  let host = env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
  values.OLLAMA_HOST = host;

  let probe = await probeOllama(host);
  if (!skipLocalBootstrap()) {
    while (!probe.running) {
      if (!probe.onPath) warn('The `ollama` command is not on your PATH.');
      note(`Open the Ollama app (${ollamaDownloadPageLink()}), then press Enter to retry.`);
      await p.ask('Press Enter when Ollama is running', { fallback: '' });
      probe = await probeOllama(host);
      if (!probe.running && (await p.confirm('Use a custom Ollama URL (advanced)?', false))) {
        host = await p.askValid('Ollama URL (OLLAMA_HOST)', normalizeHost, { fallback: host });
        values.OLLAMA_HOST = host;
        probe = await probeOllama(host);
      }
      if (probe.running) break;
      if (!(await p.confirm('Keep waiting for Ollama?', true))) break;
    }
  }

  let chatModels = ollamaChatModels(probe.running ? probe.models : []);

  if (probe.running && chatModels.length > 0) {
    const preview = chatModels.slice(0, 4).join(', ');
    success(`Ollama is running · ${preview}${chatModels.length > 4 ? '…' : ''}`);
    values.OLLAMA_MODEL = await pickOllamaChatModel(p, chatModels, env.OLLAMA_MODEL);
  } else if (probe.running && !skipLocalBootstrap()) {
    note('Ollama is running but no chat models are installed yet (embedding-only models do not count).');
    const pullName = RECOMMENDED_OLLAMA_CHAT_PULL;
    const size = ollamaPullSizeHint(pullName);
    if (await p.confirm(`Download chat model ${pullName} (${size})?`, true)) {
      try {
        if (!(await pullOllamaModel(host, pullName))) throw new Error('pull failed');
        probe = await probeOllama(host);
        chatModels = ollamaChatModels(probe.models);
        if (chatModels.length > 0) {
          values.OLLAMA_MODEL = await pickOllamaChatModel(p, chatModels, env.OLLAMA_MODEL);
        } else {
          values.OLLAMA_MODEL = pullName;
          warn(`Pull finished but no chat model appeared — set OLLAMA_MODEL manually if needed.`);
        }
      } catch (err) {
        if (err instanceof SetupCancelledError) throw err;
        warn('Download failed — install a model in Ollama or run `ollama pull` later.');
        values.OLLAMA_MODEL = await p.askValid('Chat model (OLLAMA_MODEL)', checkModel, {
          fallback: env.OLLAMA_MODEL ?? pullName,
        });
      }
    } else {
      warn('Skipped download — Sass needs a chat model in Ollama before she can reply.');
      values.OLLAMA_MODEL = await p.askValid('Chat model (OLLAMA_MODEL)', checkModel, {
        fallback: env.OLLAMA_MODEL ?? pullName,
      });
      if (!hasOllamaModel(probe.models, values.OLLAMA_MODEL)) {
        note(`When ready: ollama pull ${values.OLLAMA_MODEL}`);
      }
    }
  } else if (!probe.running) {
    warn(probe.onPath ? `Could not reach Ollama at ${host}.` : 'Install Ollama to run models locally.');
    values.OLLAMA_MODEL = await p.askValid('Chat model (OLLAMA_MODEL)', checkModel, {
      fallback: env.OLLAMA_MODEL ?? RECOMMENDED_OLLAMA_CHAT_PULL,
    });
  }

  if (probe.running && values.OLLAMA_MODEL && !hasOllamaModel(probe.models, values.OLLAMA_MODEL)) {
    warn(`"${values.OLLAMA_MODEL}" is not installed yet. Run: ollama pull ${values.OLLAMA_MODEL}`);
  }
}

async function setupVision(
  p: SetupPrompter,
  preset: ProviderPreset,
  values: Record<string, string | undefined>,
  skipped: string[],
): Promise<void> {
  beginStep(4, 'Look and emoji');

  explain('Optional: roast images when someone @\'s Sass with a picture attached.');
  note('Uses the same chat model — it must accept images. Text-only models still reply without seeing the picture.');
  note('Custom emoji for ship cards are optional; see docs/CONFIGURATION.md if you want your own.');
  blank();
  if (!(await p.confirm('Enable image roasts?', false))) {
    skipped.push('Image roasts');
    return;
  }

  if (preset.aiProvider === 'openai' && !preset.fetchesImageUrls) {
    warn(`${preset.label} only takes inline images, so it can't see Discord image URLs. For local vision, rerun setup and pick Ollama (native API) with a vision model.`);
    return;
  }
  const key = preset.aiProvider === 'ollama' ? 'OLLAMA_MODEL' : 'OPENAI_MODEL';
  const current = values[key] ?? '';
  if (preset.aiProvider === 'ollama') note('Vision models on Ollama include llama3.2-vision, gemma3, qwen2.5vl and llava.');
  if (preset.key === 'other') note('This only works if your host fetches image URLs itself.');
  const model = await p.askValid('Vision-capable chat model', checkModel, { fallback: current });
  values[key] = model;
  if (preset.aiProvider === 'ollama' && model !== current) note(`If it isn't installed yet: ollama pull ${model}`);
}

async function setupDatabaseAndMemory(
  p: SetupPrompter,
  preset: ProviderPreset,
  env: Record<string, string>,
  values: Record<string, string | undefined>,
  skipped: string[],
): Promise<void> {
  beginStep(3, 'Memory (database)');

  explain('Memory, affinity, mood, and /forgetme need Postgres. Default: local database with no extra install.');
  note('Data stays in .sass-data/ here. Starts with sass / npm start, stops on Ctrl+C.');
  blank();

  const defaultChoice = env.SASS_EMBEDDED_PG === '1'
    ? 0
    : env.DATABASE_URL
      ? 1
      : 0;

  const choice = await p.choose('How should Postgres run?', [...DATABASE_CHOICE_LABELS], defaultChoice);

  if (choice === 0) {
    applyEmbeddedDatabase(values);
    success('Local Postgres — starts automatically when you run sass.');
  } else if (choice === 1) {
    applyHostedDatabase(values, '');
    note('Your input is hidden; the URL usually contains a password.');
    const databaseUrl = await p.askValid(
      env.DATABASE_URL ? 'Postgres URL (DATABASE_URL, "none" removes it)' : 'Postgres URL (DATABASE_URL)',
      checkDatabaseUrl,
      { fallback: env.DATABASE_URL, secret: true },
    );
    applyHostedDatabase(values, databaseUrl);
    if (!databaseUrl) return;
    const verified = await verifyDatabaseConnection(databaseUrl);
    if (!verified.ok) warn(`Could not connect yet: ${verified.error}`);
    else success('Connection check passed.');
  } else if (choice === 2) {
    applyHostedDatabase(values, '');
    note('Trying Docker first, then Postgres on 127.0.0.1:5432…');
    let result = await provisionExternalPostgres();
    while (!result.ok) {
      warn(result.detail);
      note(result.installHint);
      if (!(await p.confirm('Retry?', true))) {
        if (await p.confirm('Continue without a database instead?', false)) {
          applySkipDatabase(values);
          return;
        }
        continue;
      }
      result = await provisionExternalPostgres();
    }
    note(result.detail);
    applyHostedDatabase(values, result.databaseUrl);
    const verified = await verifyDatabaseConnection(result.databaseUrl);
    if (!verified.ok) warn(`Could not connect yet: ${verified.error}`);
    else success('Connection check passed.');
  } else {
    for (const line of SKIP_DATABASE_LINES) note(line);
    if (!(await p.confirm('Run without Postgres anyway?', false))) {
      await setupDatabaseAndMemory(p, preset, env, values, skipped);
      return;
    }
    applySkipDatabase(values);
    skipped.push('Postgres memory');
    return;
  }

  if (!values.DATABASE_URL && values.SASS_EMBEDDED_PG !== '1') return;

  await setupMemorySearch(p, preset, env, values, skipped);
}

async function setupAdvanced(p: SetupPrompter, env: Record<string, string>, values: Record<string, string | undefined>): Promise<void> {
  explain('Auto-sass: Sass sometimes jumps into busy channels on her own.');
  blank();
  if (!(await p.confirm('Customize auto-sass frequency?', false))) return;
  values.AUTO_SASS_CHANCE = await p.askValid('Chance to jump in, 0 to 1 (AUTO_SASS_CHANCE)', checkChance, { fallback: env.AUTO_SASS_CHANCE ?? '0.4' });
  values.AUTO_SASS_MIN_MESSAGES = await p.askValid('Recent messages needed first (AUTO_SASS_MIN_MESSAGES)', checkPositiveInt, { fallback: env.AUTO_SASS_MIN_MESSAGES ?? '2' });
}

function printSummary(values: Record<string, string | undefined>): void {
  const secret = new Set(['DISCORD_TOKEN', 'OPENAI_API_KEY', 'EMBEDDING_OPENAI_API_KEY', 'DATABASE_URL']);
  const order = ['DISCORD_TOKEN', 'CLIENT_ID', 'CREATOR_ID', 'AI_PROVIDER', 'OPENAI_BASE_URL', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'EMBEDDING_OPENAI_BASE_URL', 'EMBEDDING_OPENAI_API_KEY', 'OLLAMA_HOST', 'OLLAMA_MODEL', 'SASS_EMBEDDED_PG', 'DATABASE_URL', 'AUTO_SASS_CHANCE', 'AUTO_SASS_MIN_MESSAGES'];
  const lines: string[] = ['Configured (secrets hidden):'];
  for (const key of order) {
    const value = values[key];
    if (value === undefined) continue;
    const empty = key === 'OPENAI_BASE_URL' ? '(OpenAI default)' : '(empty)';
    let shown: string;
    if (key === 'DATABASE_URL') {
      shown = describeDatabaseSummary(values);
    } else if (secret.has(key)) {
      shown = describeSecret(value);
    } else {
      shown = value || empty;
    }
    lines.push(`  ${key}: ${shown}`);
  }
  summaryBox(lines);
}

async function prepareDatabaseAfterWrite(values: Record<string, string | undefined>): Promise<void> {
  if (process.env.SASS_TEST_SKIP_EMBEDDED === '1') {
    note('Skipping local Postgres boot (test mode). Tables are created on npm start.');
    return;
  }
  if (values.SASS_EMBEDDED_PG === '1') {
    try {
      process.env.SASS_EMBEDDED_PG = '1';
      await runWithSpinner('Starting local Postgres and creating tables', async () => {
        const pgUrl = await ensureEmbeddedPostgresRunning();
        process.env.DATABASE_URL = pgUrl;
        const connected = await connectPool();
        if (!connected) throw new Error('Could not connect');
        await createSchema();
        setConnected(true);
      });
      note('Local Postgres is ready; tables are in place.');
    } catch (err) {
      if (usesSimpleSetup()) throw err;
      warn(`Local Postgres setup failed: ${(err as Error).message}`);
    } finally {
      await closeDatabaseAfterSetup();
    }
    return;
  }

  const url = values.DATABASE_URL?.trim();
  if (!url) return;

  explain('Checking Postgres and creating tables if needed…');
  const verified = await verifyDatabaseConnection(url);
  if (!verified.ok) {
    warn(`Could not connect: ${verified.error}`);
    return;
  }
  process.env.DATABASE_URL = url;
  const connected = await connectPool();
  if (!connected) {
    warn('Connection check passed but the pool could not connect.');
    return;
  }
  try {
    await createSchema();
    setConnected(true);
    success('Database connected; tables are ready.');
  } catch (err) {
    warn(`Schema setup failed: ${(err as Error).message}`);
  } finally {
    await closeDatabaseAfterSetup();
  }
}

async function closeDatabaseAfterSetup(): Promise<void> {
  const { closeDatabase } = await import('./database/pool.js');
  await closeDatabase();
}

function writeEnv(values: Record<string, string | undefined>): void {
  const template = existsSync(EXAMPLE_PATH) ? readFileSync(EXAMPLE_PATH, 'utf8') : '';
  const content = renderEnv(template, values);
  if (existsSync(ENV_PATH)) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const backup = `${ENV_PATH}.backup-${stamp}`;
    copyFileSync(ENV_PATH, backup);
    chmodSync(backup, 0o600);
    note(`Old .env saved as ${backup}`);
  }
  writeFileSync(ENV_PATH, content, { mode: 0o600 });
  envWritten = true;
  chmodSync(ENV_PATH, 0o600);
  success('Wrote .env (readable only by you).');
}

async function runSetupCore(p: SetupPrompter): Promise<FinishContext | null> {
  const env = readExistingEnv();
  const skipped: string[] = [];
  if (existsSync(ENV_PATH)) {
    if (!shouldUseInkTui()) {
      note('A .env file already exists. Defaults come from it; it is backed up before anything is written.');
      blank();
    }
    if (!(await p.confirm('Go through setup and update it?', false))) {
      if (!shouldUseInkTui()) note('Left .env unchanged. Start with: sass start');
      p.close();
      return null;
    }
  }

  const values: Record<string, string | undefined> = { ...env };
  const intentsConfirmed = await setupDiscord(p, env, values);

  beginStep(2, 'AI model');
  const localDet = await detectLocalRuntimes();
  const menuEntries = buildProviderMenu(localDet);
  const envMenuIdx = menuIndexForEnvPreset(menuEntries, env);
  const defaultMenuIdx = defaultProviderIndex(menuEntries, localDet, envMenuIdx);
  const pickedIdx = await p.chooseProvider(menuEntries, defaultMenuIdx, localDet);
  const preset = menuEntries[pickedIdx]?.preset ?? PROVIDERS[0];
  if (!preset) throw new Error('No providers configured');
  const envPresetKey = PROVIDERS[presetFromEnv(env)]?.key;
  const sameProvider = preset.key === envPresetKey && Object.keys(env).length > 0;
  values.AI_PROVIDER = preset.aiProvider;
  if (preset.aiProvider === 'openai') {
    await setupOpenAICompatible(p, preset, env, sameProvider, values);
  } else {
    // Embedding settings are decided in the memory step.
    if (!sameProvider) {
      values.OPENAI_BASE_URL = env.OPENAI_BASE_URL;
      values.OPENAI_API_KEY = env.OPENAI_API_KEY ?? '';
    }
    await setupOllama(p, env, values);
  }

  if (usesSimpleSetup()) {
    beginStep(3, 'Prepare Sass');
    await runWithSpinner('Checking included local memory', () => prepareLocalMemory(values));
  } else {
    await setupDatabaseAndMemory(p, preset, env, values, skipped);
    await setupVision(p, preset, values, skipped);
  }

  beginStep(5, 'Start Sass');
  if (!usesSimpleSetup()) await setupAdvanced(p, env, values);

  if (!shouldUseInkTui()) {
    printSummary(values);
    blank();
  }
  if (!usesSimpleSetup() && !(await p.confirm(existsSync(ENV_PATH) ? 'Back up the old .env and write the new one?' : 'Write .env?', true))) {
    if (!shouldUseInkTui()) note('Nothing was written.');
    p.close();
    return null;
  }
  writeEnv(values);
  await offerAssetUpload(p, values);
  dotenv.config({ path: ENV_PATH, quiet: true, override: true });
  await prepareDatabaseAfterWrite(values);

  const installerFrame = usesSimpleSetup() || process.env.SASS_INSTALL_FRAME === '1';
  let startNow = false;
  if (installerFrame) {
    if (usesSimpleSetup() || await p.confirm('Build and register commands now? (Start later: sass start)', p.interactive)) {
      if ((!existsSync('bundle-manifest.json') && !await runStep('npm', ['run', 'build'])) || !await runStep(process.execPath, ['dist/register-commands.js'])) {
        throw new Error('Build or command registration failed. Run sass setup to retry.');
      }
    } else skipped.push('Build and register slash commands');
  } else {
    startNow = usesSimpleSetup() ? false : await p.confirm('Build, register slash commands, and start Sass now?', p.interactive);
  }
  if (usesSimpleSetup() && !shouldUseInkTui() && p.interactive) {
    await p.ask('Setup is ready. Press Enter to start Sass. Ctrl+C keeps her stopped.');
    startNow = true;
  }
  if (!startNow && !installerFrame) skipped.push('Build, register commands, and start (run sass start)');

  const finishCtx: FinishContext = {
    preset,
    values,
    intentsConfirmed,
    skipped,
    wroteEnv: true,
    startedNow: startNow,
  };
  p.close();
  return finishCtx;
}

/**
 * Offer to put the bundled art on the app: the custom emoji (when assets/emoji has files)
 * and the avatar and banner (only where the bot has none, so custom images are kept).
 * A failure is a warning: the bot still works and falls back to Unicode emoji.
 */
async function offerAssetUpload(p: SetupPrompter, values: Record<string, string | undefined>): Promise<void> {
  let count: number;
  try {
    count = existsSync(EMOJI_DIR) ? listEmojiFiles(EMOJI_DIR).length : 0;
  } catch {
    count = 0;
  }
  const hasProfileArt = existsSync(AVATAR_PATH) || existsSync(BANNER_PATH);
  if (count === 0 && !hasProfileArt) return;
  note('Custom emoji, avatar and banner');
  if (count > 0) note(`Sass ships ${count} custom emoji in ${EMOJI_DIR}. They need to be on your Discord app to show up.`);
  if (hasProfileArt) note('She also ships an avatar and a banner. They are only set if the bot has none yet; your own images are kept.');
  note('Nothing is deleted or replaced.');
  if (!usesSimpleSetup() && !(await p.confirm('Upload them to your app now?', true))) {
    note('Skipped. Run `sass setup` any time. Until then she uses Unicode emoji.');
    return;
  }
  const token = values.DISCORD_TOKEN ?? '';
  if (count > 0) {
    try {
      const result = await uploadMissingEmoji({ token, appId: values.CLIENT_ID ?? '' });
      note(summarizeUpload(result));
      if (result.failed.length > 0) warn('Some emoji were not uploaded. Run `sass setup` to retry; she uses Unicode for those.');
    } catch (err) {
      warn(`Emoji upload failed: ${err instanceof Error ? err.message : String(err)}`);
      warn('Setup continues. Run `sass setup` later; until then she uses Unicode emoji.');
    }
  }
  if (hasProfileArt) {
    try {
      const result = await setMissingProfileImages({ token });
      note(summarizeProfile(result));
      if (result.failed.length > 0) warn('Setup continues. Run `sass setup` later, or set them in the Developer Portal → Bot.');
    } catch (err) {
      warn(`Avatar/banner check failed: ${err instanceof Error ? err.message : String(err)}`);
      warn('Setup continues. Run `sass setup` later, or set them in the Developer Portal → Bot.');
    }
  }
}

async function main(): Promise<void> {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) {
    console.error(`Sass needs Node.js 20 or newer; this is ${process.version}.`);
    process.exit(1);
  }
  if (!existsSync('package.json') || (!existsSync('src/index.ts') && !existsSync('dist/index.js'))) {
    console.error('Run this from the Sass repo folder: npm run setup');
    process.exit(1);
  }

  installSetupCancelHandlers(exitSetupCancelled);

  if (shouldUseInkTui()) {
    const { runInkSetup } = await import('./setup/tui/runInkSetup.js');
    const inkFinish = await runInkSetup((p) => runSetupCore(p), exitSetupCancelled);
    if (inkFinish?.startedNow && process.env.SASS_INSTALL_FRAME === '1' && (usesSimpleSetup() || process.env.SASS_SOURCE_INSTALL === '1')) {
      process.exitCode = 10;
      return;
    }
    if (inkFinish?.startedNow) {
      const ok = await startAfterSetup(runStep, usesSimpleSetup(), existsSync('bundle-manifest.json'));
      if (!ok) process.exit(1);
    }
    return;
  }

  const p = createSetupPrompter(exitSetupCancelled);
  if (shouldUseClackPrompter()) {
    const { mascotPlan, printMascot } = await import('./setup/mascot.js');
    await printMascot(mascotPlan(true));
    clack.intro('Sass · Discord roast bot');
    clack.note(`${pickGreeting()}\n\nSecrets stay hidden. Ctrl+C quits without saving.`, 'Setup');
  } else {
    await printWelcomeBanner();
  }

  const finish = await runSetupCore(p);
  if (!finish) return;
  await printFinalScreen(finish);
  if (shouldUseClackPrompter()) {
    clack.outro(finish.startedNow ? 'Sass is starting — Ctrl+C to stop.' : 'Run sass start when you are ready.');
  }
  if (!finish.startedNow) return;
  if (process.env.SASS_INSTALL_FRAME === '1' && (usesSimpleSetup() || process.env.SASS_SOURCE_INSTALL === '1')) {
    process.exitCode = 10;
    return;
  }
  const ok = await startAfterSetup(runStep, usesSimpleSetup(), existsSync('bundle-manifest.json'));
  if (!ok) process.exit(1);
}

main().catch((err: unknown) => {
  if (process.env.SASS_INSTALL_FRAME === '1') process.stdout.write('\u001b[H\u001b[2J');
  if (err instanceof SetupCancelledError) {
    exitSetupCancelled();
    return;
  }
  if (err instanceof InputEnded) {
    console.log(`\nInput ended before setup finished. ${nothingWrittenNote()}`);
    process.exit(1);
  }
  console.error('Setup failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
