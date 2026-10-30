import { spawn } from 'child_process';

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
    const interrupt = (): void => forward('SIGINT');
    const terminate = (): void => forward('SIGTERM');
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    child.once('error', (error: Error) => {
      failed = true;
      console.error(`Could not run Sass: ${error.message}`);
    });
    child.once('close', (code, signal) => {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
      resolve(failed ? 127 : code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1));
    });
  });
}
