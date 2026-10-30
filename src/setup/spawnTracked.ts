/**
 * Spawn subprocesses in their own process group so setup can kill them on cancel.
 */

import { spawn, type SpawnOptions, type ChildProcess } from 'child_process';
import { isInkSessionActive, pushInkMessage } from './tui/prompterBridge.js';
import { registerChildProcess } from './cancelRegistry.js';

export interface TrackedSpawnOptions extends SpawnOptions {
  register?: boolean;
}

export function spawnTracked(
  command: string,
  args: string[],
  options: TrackedSpawnOptions = {},
): ChildProcess {
  const { register = true, ...spawnOpts } = options;
  const detached = process.platform !== 'win32';
  const child = spawn(command, args, {
    stdio: spawnOpts.stdio ?? 'inherit',
    shell: spawnOpts.shell,
    cwd: spawnOpts.cwd,
    env: spawnOpts.env,
    detached,
  });
  if (register) registerChildProcess(child);
  return child;
}

export function runTrackedCommand(command: string, args: string[], options: TrackedSpawnOptions = {}): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawnTracked(command, args, options);
    if (isInkSessionActive()) {
      child.stdout?.on('data', chunk => pushInkMessage(String(chunk)));
      child.stderr?.on('data', chunk => pushInkMessage(String(chunk)));
    }
    child.on('error', () => resolve(127));
    child.on('exit', (code, signal) => {
      resolve(signal ? 128 : code);
    });
  });
}
