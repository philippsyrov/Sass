type RunStep = (command: string, args: string[]) => Promise<boolean>;

export async function startAfterSetup(runStep: RunStep, simple: boolean, bundled: boolean): Promise<boolean> {
  if (!simple) {
    if (!bundled && !await runStep('npm', ['run', 'build'])) return false;
    if (!await runStep(process.execPath, ['dist/register-commands.js'])) return false;
  }
  return runStep(process.execPath, ['dist/index.js']);
}
