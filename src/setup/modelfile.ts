/**
 * Read and adapt the bundled Ollama Modelfile (advanced / docs only — setup does not create by default).
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { ollamaCreateHttp } from './ollamaHttp.js';

export function parseModelfileFrom(repoRoot: string): string | null {
  const path = join(repoRoot, 'Modelfile');
  if (!existsSync(path)) return null;
  const content = readFileSync(path, 'utf8');
  const match = /^FROM\s+(\S+)/m.exec(content);
  return match?.[1] ?? null;
}

/** Same SYSTEM/parameters as Modelfile, but FROM the given installed model. */
export function modelfileContentWithFrom(repoRoot: string, fromModel: string): string | null {
  const path = join(repoRoot, 'Modelfile');
  if (!existsSync(path)) return null;
  const content = readFileSync(path, 'utf8');
  if (!/^FROM\s+\S+/m.test(content)) return null;
  return content.replace(/^FROM\s+\S+/m, `FROM ${fromModel}`);
}

export async function runOllamaCreateSass(
  repoRoot: string,
  host: string,
  fromModel?: string,
): Promise<boolean> {
  const bundled = join(repoRoot, 'Modelfile');
  if (!existsSync(bundled)) return false;
  const modelfile = fromModel
    ? modelfileContentWithFrom(repoRoot, fromModel)
    : readFileSync(bundled, 'utf8');
  if (!modelfile) return false;
  try {
    await ollamaCreateHttp(host, 'sass', modelfile);
    return true;
  } catch {
    return false;
  }
}
