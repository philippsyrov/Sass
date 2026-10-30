/**
 * Grouped AI provider menu — cloud recommended, local lite.
 */

import type { ProviderPreset } from './validate.js';
import { PROVIDERS } from './validate.js';
import { probeLmStudio, probeOllama } from './localBootstrap.js';
import { blank, note } from './terminal.js';
import { wrapPlain } from './wrap.js';

export interface LocalDetection {
  ollama: Awaited<ReturnType<typeof probeOllama>>;
  lmStudio: Awaited<ReturnType<typeof probeLmStudio>>;
}

export interface ProviderMenuEntry {
  preset: ProviderPreset;
  label: string;
}

const CLOUD_ORDER = ['anthropic', 'openai', 'openrouter', 'groq', 'xai', 'together', 'other'] as const;
const LITE_ORDER = ['ollama', 'lmstudio'] as const;

export async function detectLocalRuntimes(): Promise<LocalDetection> {
  const ollama = await probeOllama('http://127.0.0.1:11434');
  const lmStudio = await probeLmStudio('http://127.0.0.1:1234/v1');
  return { ollama, lmStudio };
}

function presetByKey(key: string): ProviderPreset | undefined {
  return PROVIDERS.find((p) => p.key === key);
}

function liteLabel(preset: ProviderPreset, det: LocalDetection): string {
  if (preset.key === 'ollama') {
    if (det.ollama.running) {
      const sample = det.ollama.models[0];
      return sample ? `Ollama${det.ollama.onPath ? '' : ' (app not on PATH)'} · ${sample}` : 'Ollama · running';
    }
    return 'Ollama · not detected';
  }
  if (det.lmStudio.running) {
    const sample = det.lmStudio.models[0];
    return sample ? `LM Studio · ${sample}` : 'LM Studio · running';
  }
  return 'LM Studio · not detected';
}

function cloudLabel(preset: ProviderPreset): string {
  if (preset.key === 'anthropic') return 'Anthropic (Claude)';
  if (preset.key === 'openai') return 'OpenAI';
  if (preset.key === 'other') return 'Other OpenAI-compatible API';
  return preset.label.replace(/ \(.*\)$/, '');
}

export function buildProviderMenu(det: LocalDetection): ProviderMenuEntry[] {
  const entries: ProviderMenuEntry[] = [];
  for (const key of CLOUD_ORDER) {
    const preset = presetByKey(key);
    if (preset) entries.push({ preset, label: cloudLabel(preset) });
  }
  for (const key of LITE_ORDER) {
    const preset = presetByKey(key);
    if (preset) entries.push({ preset, label: liteLabel(preset, det) });
  }
  return entries;
}

export function envPresetIndex(env: Record<string, string>): number {
  if (env.AI_PROVIDER === 'ollama') {
    return PROVIDERS.findIndex((p) => p.key === 'ollama');
  }
  const base = env.OPENAI_BASE_URL?.replace(/\/+$/, '');
  if (!base) {
    return env.AI_PROVIDER === 'openai'
      ? PROVIDERS.findIndex((p) => p.key === 'openai')
      : PROVIDERS.findIndex((p) => p.key === 'anthropic');
  }
  const match = PROVIDERS.findIndex((p) => p.baseUrl === base);
  return match >= 0 ? match : PROVIDERS.findIndex((p) => p.key === 'other');
}

export function menuIndexForEnvPreset(entries: ProviderMenuEntry[], env: Record<string, string>): number {
  const key = PROVIDERS[envPresetIndex(env)]?.key;
  if (!key) return 0;
  const idx = entries.findIndex((e) => e.preset.key === key);
  return idx >= 0 ? idx : 0;
}

export function defaultProviderIndex(
  entries: ProviderMenuEntry[],
  _det: LocalDetection,
  envMenuIndex: number,
): number {
  if (envMenuIndex >= 0 && envMenuIndex < entries.length) return envMenuIndex;
  const anthropic = entries.findIndex((e) => e.preset.key === 'anthropic');
  return anthropic >= 0 ? anthropic : 0;
}

export interface ProviderSelectOption {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
}

/** Options for @clack/prompts select (group headers are disabled). */
export function toProviderSelectOptions(entries: ProviderMenuEntry[]): ProviderSelectOption[] {
  const cloudCount = CLOUD_ORDER.reduce((n, key) => (presetByKey(key) ? n + 1 : n), 0);
  const options: ProviderSelectOption[] = [
    { value: '_recommended', label: 'Recommended · best Sass', disabled: true, hint: 'cloud API key' },
  ];
  for (let i = 0; i < cloudCount; i += 1) {
    const entry = entries[i];
    if (!entry) continue;
    options.push({ value: entry.preset.key, label: entry.label, hint: 'Cloud' });
  }
  options.push({
    value: '_lite',
    label: 'Lite · free & private',
    disabled: true,
    hint: 'local · rougher replies',
  });
  for (let i = cloudCount; i < entries.length; i += 1) {
    const entry = entries[i];
    if (!entry) continue;
    options.push({ value: entry.preset.key, label: entry.label, hint: 'Local' });
  }
  return options;
}

export function printProviderMenu(_entries: ProviderMenuEntry[], det: LocalDetection): void {
  blank();
  for (const line of wrapPlain('Pick who powers Sass’s replies.', '  ')) note(line);
  blank();
  note('  Recommended · best Sass (cloud API key)');
  let n = 1;
  for (const key of CLOUD_ORDER) {
    const preset = presetByKey(key);
    if (!preset) continue;
    note(`  ${n}) ${cloudLabel(preset)}`);
    n += 1;
  }
  note('  Lite · free & private (rougher replies)');
  for (const line of wrapPlain(
    'Small local models may drift from Sass’s personality and ignore some instructions — fine for trying her out.',
    '    ',
  )) note(line);
  for (const key of LITE_ORDER) {
    const preset = presetByKey(key);
    if (!preset) continue;
    const mark = (key === 'ollama' && det.ollama.running) || (key === 'lmstudio' && det.lmStudio.running) ? ' ✓' : '';
    note(`  ${n}) ${liteLabel(preset, det)}${mark}`);
    n += 1;
  }
  blank();
}
