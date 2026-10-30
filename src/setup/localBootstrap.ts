/**
 * Detect and bootstrap local AI runtimes during setup (Ollama, LM Studio).
 */

import { spawn } from 'child_process';

const TIMEOUT_MS = 10_000;

export interface OllamaProbe {
  onPath: boolean;
  host: string;
  running: boolean;
  models: string[];
}

export interface LmStudioProbe {
  running: boolean;
  models: string[];
}

function run(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (c: Buffer) => { stdout += c.toString(); });
    child.stderr?.on('data', (c: Buffer) => { stderr += c.toString(); });
    child.on('error', () => resolve({ code: 127, stdout, stderr }));
    child.on('exit', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export async function commandOnPath(name: string): Promise<boolean> {
  const check = process.platform === 'win32' ? 'where' : 'which';
  const result = await run(check, [name]);
  return result.code === 0;
}

export async function probeOllama(host = 'http://127.0.0.1:11434'): Promise<OllamaProbe> {
  const testModels = process.env.SASS_TEST_OLLAMA_MODELS;
  if (testModels !== undefined) {
    const models = testModels.split(',').map((s) => s.trim()).filter(Boolean);
    const running = testModels.length > 0 && (models.length > 0 || testModels === 'running');
    return { onPath: true, host, running, models };
  }
  const onPath = await commandOnPath('ollama');
  try {
    const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      return { onPath, host, running: false, models: [] };
    }
    const body = await res.json() as { models?: Array<{ name?: string }> };
    const models = (body.models ?? []).map((m) => m.name).filter((n): n is string => typeof n === 'string');
    return { onPath, host, running: true, models };
  } catch {
    return { onPath, host, running: false, models: [] };
  }
}

export async function probeLmStudio(baseUrl = 'http://127.0.0.1:1234/v1'): Promise<LmStudioProbe> {
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: 'Bearer lm-studio' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { running: false, models: [] };
    const body = await res.json() as { data?: Array<{ id?: string }> };
    const models = (body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string');
    return { running: true, models };
  } catch {
    return { running: false, models: [] };
  }
}

/** Approximate download size label for common Ollama models (for consent prompts). */
export function ollamaPullSizeHint(model: string): string {
  const base = model.split(':')[0]?.toLowerCase() ?? model;
  if (base.includes('llama3.1') && model.includes('8b')) return 'about 4.7 GB';
  if (base.includes('qwen3.5') && model.includes('4b')) return 'about 2.5 GB';
  if (base.includes('llama3.2') && model.includes('3b')) return 'about 2.0 GB';
  if (base.includes('nomic-embed')) return 'about 274 MB';
  return 'several hundred MB or more';
}

/** @deprecated Use ollamaPullHttpWithProgress from ollamaHttp.js */
export async function runOllamaPull(model: string, host = 'http://127.0.0.1:11434'): Promise<boolean> {
  const { ollamaPullHttpWithProgress } = await import('./ollamaHttp.js');
  return ollamaPullHttpWithProgress(host, model);
}

export async function runOllamaCp(from: string, to: string): Promise<boolean> {
  const result = await run('ollama', ['cp', from, to]);
  return result.code === 0;
}
