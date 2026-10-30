import { spawn } from 'child_process';
import { registerShutdownSignals } from '../shared/shutdownSignals.js';

/** Keep the terminal's foreground parent alive until the bot finishes shutdown. */
export function runRuntimeCommand(command: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    // The bot owns its database shutdown. Forward to the bot alone, once.
    const child = spawn(command, args, { detached: process.platform !== 'win32', stdio: 'inherit' });
    let stopping = false;
    let failed = false;
    const forward = (signal: NodeJS.Signals): void => {
      if (stopping) return;
      stopping = true;
      child.kill(signal);
    };
    const removeSignals = registerShutdownSignals(forward);
    child.once('error', (error: Error) => {
      failed = true;
      console.error(`Could not run Sass: ${error.message}`);
    });
    child.once('close', (code, signal) => {
      removeSignals();
      resolve(failed ? 127 : code ?? (signal === 'SIGHUP' ? 129 : signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1));
    });
  });
}
