import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL_EMBED_LEGACY } from './localEmbedConfig.js';

export function resolveLocalModelCache(
  config: Record<string, string | undefined>,
  model: string,
  revision?: string,
  projectRoot = fileURLToPath(new URL('../../', import.meta.url)),
  userHome = homedir(),
): string {
  if (config.SASS_EMBED_CACHE_DIR?.trim()) return config.SASS_EMBED_CACHE_DIR.trim();
  const legacy = join(config.SASS_HOME?.trim() || join(userHome, '.sass'), 'models');
  const bundled = join(projectRoot, 'models');
  const modelPath = revision ? join(model, revision, 'config.json') : join(model, 'config.json');
  const hasBundle = existsSync(join(projectRoot, 'bundle-manifest.json'));
  if (hasBundle && existsSync(join(bundled, modelPath))) return bundled;
  // An existing selected model can live in the old default cache. Never change
  // its model ID to obtain a cache hit from the new bundle.
  if (existsSync(join(legacy, modelPath))) return legacy;
  return hasBundle ? bundled : legacy;
}


export function resolveLocalModelLocation(
  config: Record<string, string | undefined>,
  model: string,
  revision?: string,
  projectRoot = fileURLToPath(new URL('../../', import.meta.url)),
  userHome = homedir(),
): { cacheDir: string; revision: string | undefined } {
  const cacheDir = resolveLocalModelCache(config, model, revision, projectRoot, userHome);
  // Older explicit Gemma 1 selections can predate revision-named caches.
  // A supplied revision and the new Gemma 2 pin must never fall back.
  if (model === LOCAL_EMBED_LEGACY && !config.LOCAL_EMBED_REVISION?.trim()
    && revision && !existsSync(join(cacheDir, model, revision, 'config.json'))) {
    const unversioned = resolveLocalModelCache(config, model, undefined, projectRoot, userHome);
    if (existsSync(join(unversioned, model, 'config.json'))) return { cacheDir: unversioned, revision: undefined };
  }
  return { cacheDir, revision };
}
