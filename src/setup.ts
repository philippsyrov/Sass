/**
 * `npm run setup`: interactive first-time setup. Asks for the Discord and AI settings,
 * checks them, writes .env (after confirming, with a backup of any existing file) and
 * can build, register slash commands and start the bot.
 *
 * Secrets are read without echo and never printed. Answers can also be piped in,
 * one per line, which is how the prompts are tested without a terminal.
 */
import { copyFileSync, chmodSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { spawn } from 'child_process';
import readline from 'readline';
import { Writable } from 'stream';
import dotenv from 'dotenv';
import {
  PROVIDERS,
  type Check,
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
  inviteUrl,
  isPlaceholder,
  normalizeBaseUrl,
  normalizeHost,
  renderEnv,
} from './setup/validate.js';
import { fetchDiscordApp, hasOllamaModel, listOllamaModels, listOpenAIModels } from './setup/checks.js';

const ENV_PATH = '.env';
const EXAMPLE_PATH = '.env.example';
const EMBEDDING_MODEL = 'text-embedding-3-small';

class InputEnded extends Error {}

/** Line-based prompts that work both in a terminal and with piped input. */
class Prompter {
  private readonly rl: readline.Interface;
  private readonly queue: string[] = [];
  private readonly waiting: Array<(line: string | null) => void> = [];
  private closed = false;
  private muted = false;
  readonly interactive = Boolean(process.stdin.isTTY);

  constructor() {
    const output = new Writable({
      write: (chunk: Buffer, _encoding, callback) => {
        if (!this.muted) process.stdout.write(chunk);
        callback();
      },
    });
    this.rl = readline.createInterface({ input: process.stdin, output, terminal: this.interactive });
    this.rl.on('line', (line) => {
      const next = this.waiting.shift();
      if (next) next(line);
      else this.queue.push(line);
    });
    this.rl.on('close', () => {
      this.closed = true;
      for (const next of this.waiting.splice(0)) next(null);
    });
    this.rl.on('SIGINT', () => {
      this.muted = false;
      console.log('\n\nSetup cancelled. Nothing was written.');
      process.exit(130);
    });
  }

  private nextLine(): Promise<string | null> {
    const line = this.queue.shift();
    if (line !== undefined) return Promise.resolve(line);
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  async ask(question: string, options: { fallback?: string; secret?: boolean } = {}): Promise<string> {
    const { fallback, secret = false } = options;
    const hint = fallback ? (secret ? ' [Enter keeps the current value]' : ` [${fallback}]`) : '';
    this.rl.setPrompt(`${question}${hint}: `);
    this.rl.prompt();
    if (secret && this.interactive) this.muted = true;
    const line = await this.nextLine();
    if (this.muted) {
      this.muted = false;
      process.stdout.write('\n');
    } else if (!this.interactive) {
      process.stdout.write('\n');
    }
    if (line === null) throw new InputEnded();
    const value = line.trim();
    return value || fallback || '';
  }

  /** Ask until `check` accepts the answer; prints warnings and errors. */
  async askValid(question: string, check: (raw: string) => Check, options: { fallback?: string; secret?: boolean } = {}): Promise<string> {
    for (;;) {
      const result = check(await this.ask(question, options));
      if (result.ok) {
        if (result.warning) warn(result.warning);
        return result.value;
      }
      warn(result.error);
    }
  }

  async confirm(question: string, defaultYes: boolean): Promise<boolean> {
    for (;;) {
      const answer = (await this.ask(`${question} ${defaultYes ? '[Y/n]' : '[y/N]'}`)).toLowerCase();
      if (!answer) return defaultYes;
      if (['y', 'yes'].includes(answer)) return true;
      if (['n', 'no'].includes(answer)) return false;
      warn('Please answer y or n.');
    }
  }

  async choose(question: string, labels: string[], defaultIndex: number): Promise<number> {
    labels.forEach((label, i) => console.log(`  ${i + 1}) ${label}`));
    for (;;) {
      const answer = await this.ask(question, { fallback: String(defaultIndex + 1) });
      const n = Number(answer);
      if (Number.isInteger(n) && n >= 1 && n <= labels.length) return n - 1;
      warn(`Enter a number from 1 to ${labels.length}.`);
    }
  }

  close(): void {
    this.rl.close();
  }
}

function heading(text: string): void {
  console.log(`\n── ${text} ${'─'.repeat(Math.max(0, 50 - text.length))}`);
}

function warn(text: string): void {
  console.log(`  ! ${text}`);
}

function note(text: string): void {
  console.log(`  ${text}`);
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
  if (!base) return 0;
  const match = PROVIDERS.findIndex((p) => p.baseUrl === base);
  return match >= 0 ? match : PROVIDERS.findIndex((p) => p.key === 'other');
}

function runStep(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    console.log(`\n$ ${command} ${args.join(' ')}`);
    const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', (err) => {
      console.error(`Could not run ${command}: ${err.message}`);
      resolve(false);
    });
    child.on('exit', (code) => resolve(code === 0));
  });
}

async function setupDiscord(p: Prompter, env: Record<string, string>, values: Record<string, string | undefined>): Promise<boolean> {
  heading('Discord');
  note('Create an app at https://discord.com/developers/applications, then:');
  note('  Bot → Reset Token gives the bot token (shown once).');
  note('  Bot → Privileged Gateway Intents: turn on Presence Intent and Message Content Intent.');
  note('Your input is hidden while you paste the token.');
  const token = await p.askValid('Bot token', checkDiscordToken, { fallback: env.DISCORD_TOKEN, secret: true });
  values.DISCORD_TOKEN = token;

  const botId = botIdFromToken(token);
  note('Application ID: Developer Portal → General Information → Application ID.');
  const clientId = await p.askValid('Application ID (CLIENT_ID)', (raw) => checkSnowflake(raw, 'The Application ID'), {
    fallback: env.CLIENT_ID ?? botId ?? undefined,
  });
  if (botId && clientId !== botId) {
    warn(`The token belongs to bot ${botId}, but CLIENT_ID is ${clientId}. For most apps they are the same number; check you copied both from the same app.`);
  }
  values.CLIENT_ID = clientId;

  note('Your own user ID: Discord Settings → Advanced → Developer Mode, then right-click your name → Copy User ID.');
  note('That user gets friend mode and is never roasted.');
  const creatorId = await p.askValid('Your Discord user ID (CREATOR_ID)', (raw) => {
    const result = checkSnowflake(raw, 'Your user ID');
    if (result.ok && (result.value === clientId || result.value === botId)) {
      return { ok: false, error: 'That is the bot\'s ID. CREATOR_ID is your own account\'s ID.' };
    }
    return result;
  }, { fallback: env.CREATOR_ID });
  values.CREATOR_ID = creatorId;

  let intentsConfirmed = false;
  if (await p.confirm('Check the token with Discord now?', true)) {
    const result = await fetchDiscordApp(token);
    if (!result.ok) {
      warn(result.error);
    } else {
      const app = result.data;
      note(`Token works: app "${app.name}" (${app.id}).`);
      if (app.id && app.id !== clientId) {
        warn(`This token's application ID is ${app.id}, not ${clientId}.`);
        if (await p.confirm(`Use ${app.id} as CLIENT_ID?`, true)) values.CLIENT_ID = app.id;
      }
      if (!app.presenceIntent || !app.messageContentIntent) {
        const missing = [!app.presenceIntent && 'Presence Intent', !app.messageContentIntent && 'Message Content Intent'].filter(Boolean).join(' and ');
        warn(`${missing} is off. Turn it on under Bot → Privileged Gateway Intents, or the bot will fail to log in ("Used disallowed intents").`);
      } else {
        intentsConfirmed = true;
        note('Presence and Message Content intents are on.');
      }
    }
  }
  return intentsConfirmed;
}

async function checkOpenAIModel(p: Prompter, baseUrl: string, apiKey: string, model: string): Promise<void> {
  if (!(await p.confirm('Check the key and model name against the API now?', true))) return;
  const result = await listOpenAIModels(baseUrl, apiKey);
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

async function setupOpenAICompatible(p: Prompter, preset: ProviderPreset, env: Record<string, string>, sameProvider: boolean, values: Record<string, string | undefined>): Promise<void> {
  let baseUrl = preset.baseUrl ?? '';
  if (preset.askBaseUrl) {
    baseUrl = await p.askValid('Base URL (for example https://host/v1)', normalizeBaseUrl, { fallback: sameProvider ? env.OPENAI_BASE_URL : undefined });
  }
  values.OPENAI_BASE_URL = baseUrl;

  let apiKey: string;
  if (preset.localKey) {
    apiKey = preset.localKey;
    note(`${preset.label} ignores the API key; using "${apiKey}".`);
  } else {
    apiKey = await p.askValid(`${preset.label} API key`, (raw) => checkApiKey(raw, preset.key), {
      fallback: sameProvider ? env.OPENAI_API_KEY : undefined,
      secret: true,
    });
  }
  values.OPENAI_API_KEY = apiKey;

  // gpt-4o-mini is the example in .env.example; other hosts name models differently.
  const fallbackModel = sameProvider ? env.OPENAI_MODEL : preset.key === 'openai' ? 'gpt-4o-mini' : undefined;
  if (preset.key !== 'openai') note('Use the model name exactly as your provider lists it.');
  const model = await p.askValid('Chat model (OPENAI_MODEL)', checkModel, { fallback: fallbackModel });
  values.OPENAI_MODEL = model;
  await checkOpenAIModel(p, baseUrl || 'https://api.openai.com/v1', apiKey, model);
}

async function setupOllama(p: Prompter, env: Record<string, string>, values: Record<string, string | undefined>): Promise<void> {
  note('Install Ollama from https://ollama.com and keep `ollama serve` running.');
  const host = await p.askValid('Ollama URL (OLLAMA_HOST)', normalizeHost, { fallback: env.OLLAMA_HOST ?? 'http://localhost:11434' });
  values.OLLAMA_HOST = host;
  const installed = await listOllamaModels(host);
  if (installed.ok) {
    note(installed.data.length > 0 ? `Installed models: ${installed.data.join(', ')}` : 'Ollama is running but has no models yet.');
  } else {
    warn(installed.error);
  }
  note('The repo\'s Modelfile adds tuned sampling: `ollama create sass -f Modelfile`, then use the name "sass".');
  const model = await p.askValid('Chat model (OLLAMA_MODEL)', checkModel, { fallback: env.OLLAMA_MODEL ?? 'llama3.1:8b' });
  values.OLLAMA_MODEL = model;
  if (installed.ok && !hasOllamaModel(installed.data, model)) {
    warn(`"${model}" is not installed yet. Run: ollama pull ${model}`);
  }
}

async function setupVision(p: Prompter, preset: ProviderPreset, values: Record<string, string | undefined>): Promise<void> {
  heading('Images (optional)');
  note('When someone @\'s Sass with an image, it goes to the same chat model. There is no separate');
  note('vision setting, so for image roasts the chat model itself has to accept images.');
  note('With a text-only model she still replies, she just can\'t see the picture.');
  if (!(await p.confirm('Do you want image roasts?', false))) return;

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

async function setupMemory(p: Prompter, preset: ProviderPreset, env: Record<string, string>, values: Record<string, string | undefined>): Promise<void> {
  heading('Database and memory (optional)');
  note('Without Postgres the bot runs, but memory, affinity, /forgetme and most persistence are off.');
  note('Tables are created on first start.');
  const databaseUrl = await p.askValid('Postgres URL (DATABASE_URL, Enter to skip)', checkDatabaseUrl, { fallback: env.DATABASE_URL });
  values.DATABASE_URL = databaseUrl;
  if (!databaseUrl) return;

  note(`Vector memory embeds text with the model "${EMBEDDING_MODEL}" through the OpenAI settings.`);
  if (preset.aiProvider === 'openai') {
    if (preset.servesEmbeddings) {
      note('Your OpenAI key covers this. Nothing else to set.');
    } else {
      warn(`Embeddings go to the same host as chat. If ${preset.label} doesn't serve "${EMBEDDING_MODEL}", memory fails while chat keeps working. \`npm run doctor\` tests it.`);
    }
    return;
  }

  const choice = await p.choose('How should memory embeddings run?', [
    'Locally through Ollama (free, needs one extra model)',
    'Through OpenAI (needs an OpenAI API key)',
    'Skip for now (memory lookups will fail until this is set)',
  ], 0);
  if (choice === 0) {
    values.OPENAI_BASE_URL = `${values.OLLAMA_HOST ?? 'http://localhost:11434'}/v1`;
    values.OPENAI_API_KEY = 'ollama';
    note('Run these once so Ollama serves an embedding model under that name:');
    note('  ollama pull nomic-embed-text');
    note(`  ollama cp nomic-embed-text ${EMBEDDING_MODEL}`);
    note('Don\'t switch embedding models later on a database that already has memories.');
  } else if (choice === 1) {
    values.OPENAI_BASE_URL = '';
    values.OPENAI_API_KEY = await p.askValid('OpenAI API key', (raw) => checkApiKey(raw, 'openai'), {
      fallback: env.OPENAI_API_KEY !== 'ollama' && !env.OPENAI_BASE_URL ? env.OPENAI_API_KEY : undefined,
      secret: true,
    });
  }
}

async function setupAdvanced(p: Prompter, env: Record<string, string>, values: Record<string, string | undefined>): Promise<void> {
  heading('Auto-sass (optional)');
  note('Sass sometimes jumps into busy channels unprompted.');
  if (!(await p.confirm('Change how often?', false))) return;
  values.AUTO_SASS_CHANCE = await p.askValid('Chance to jump in, 0 to 1 (AUTO_SASS_CHANCE)', checkChance, { fallback: env.AUTO_SASS_CHANCE ?? '0.4' });
  values.AUTO_SASS_MIN_MESSAGES = await p.askValid('Recent messages needed first (AUTO_SASS_MIN_MESSAGES)', checkPositiveInt, { fallback: env.AUTO_SASS_MIN_MESSAGES ?? '2' });
}

function printSummary(values: Record<string, string | undefined>): void {
  heading('Summary');
  const secret = new Set(['DISCORD_TOKEN', 'OPENAI_API_KEY', 'DATABASE_URL']);
  const order = ['DISCORD_TOKEN', 'CLIENT_ID', 'CREATOR_ID', 'AI_PROVIDER', 'OPENAI_BASE_URL', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'OLLAMA_HOST', 'OLLAMA_MODEL', 'DATABASE_URL', 'AUTO_SASS_CHANCE', 'AUTO_SASS_MIN_MESSAGES'];
  for (const key of order) {
    const value = values[key];
    if (value === undefined) continue;
    const empty = key === 'OPENAI_BASE_URL' ? '(OpenAI default)' : '(empty)';
    const shown = secret.has(key) ? describeSecret(value) : value || empty;
    note(`${key.padEnd(24)} ${shown}`);
  }
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
  chmodSync(ENV_PATH, 0o600);
  note('Wrote .env (readable only by you).');
}

async function main(): Promise<void> {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) {
    console.error(`Sass needs Node.js 20 or newer; this is ${process.version}.`);
    process.exit(1);
  }
  if (!existsSync('package.json') || !existsSync('src/index.ts')) {
    console.error('Run this from the Sass repo folder: npm run setup');
    process.exit(1);
  }

  const p = new Prompter();
  console.log('Sass setup. Press Ctrl+C at any time to quit without writing anything.');

  const env = readExistingEnv();
  if (existsSync(ENV_PATH)) {
    note('A .env file already exists. Its values are offered as defaults, and it is backed up before anything is written.');
    if (!(await p.confirm('Go through setup and update it?', false))) {
      note('Left .env unchanged. Start the bot with: npm run build && npm start');
      p.close();
      return;
    }
  }

  // Keep values from an existing .env that this wizard doesn't ask about.
  const values: Record<string, string | undefined> = { ...env };
  const intentsConfirmed = await setupDiscord(p, env, values);

  heading('AI model');
  note('Sass works with any OpenAI-compatible API or with a local model through Ollama.');
  const defaultPreset = presetFromEnv(env);
  const preset = PROVIDERS[await p.choose('Provider', PROVIDERS.map((x) => x.label), defaultPreset)] ?? PROVIDERS[0];
  if (!preset) throw new Error('No providers configured');
  const sameProvider = PROVIDERS.indexOf(preset) === defaultPreset && Object.keys(env).length > 0;
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

  await setupVision(p, preset, values);
  await setupMemory(p, preset, env, values);
  await setupAdvanced(p, env, values);

  printSummary(values);
  if (!(await p.confirm(existsSync(ENV_PATH) ? 'Back up the old .env and write the new one?' : 'Write .env?', true))) {
    note('Nothing was written.');
    p.close();
    return;
  }
  writeEnv(values);

  heading('Next steps');
  const clientId = values.CLIENT_ID ?? '';
  note('1. Invite the bot to your server:');
  note(`   ${inviteUrl(clientId)}`);
  if (!intentsConfirmed) note('2. Make sure Presence Intent and Message Content Intent are on (Developer Portal → Bot).');
  note(`${intentsConfirmed ? '2' : '3'}. Build, register slash commands once, and start:`);
  note('   npm run build && node dist/register-commands.js && npm start');
  note('   `npm run doctor` checks the config, database and embeddings.');
  note('   To keep her running 24/7, see "Keep it running 24/7" in AGENTS.md.');

  const startNow = await p.confirm('Build, register slash commands and start Sass now?', p.interactive);
  p.close();
  if (!startNow) return;
  if (!(await runStep('npm', ['run', 'build']))) return;
  if (!(await runStep('node', ['dist/register-commands.js']))) return;
  await runStep('npm', ['start']);
}

main().catch((err: unknown) => {
  if (err instanceof InputEnded) {
    console.log('\nInput ended before setup finished. Nothing was written.');
    process.exit(1);
  }
  console.error('Setup failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
