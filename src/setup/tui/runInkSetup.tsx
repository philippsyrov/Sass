import { format } from 'node:util';
import React from 'react';
import { render } from 'ink';
import { enterAlternateScreen, exitAlternateScreen } from './terminalMode.js';
import { SetupView } from './SetupView.js';
import { InkSetupPrompter } from './InkSetupPrompter.js';
import type { SetupPrompter } from '../linePrompter.js';
import { usesSimpleSetup } from '../localFirstRun.js';
import { inviteInstructions } from '../../shared/discordInvite.js';
import { inviteUrl } from '../validate.js';
import { printPrivacyAndRecap, type FinishContext } from '../finishSummary.js';
import { cancelInkPrompt, pushInkMessage, setInkSessionActive, inkAction } from './prompterBridge.js';
import { cancelAllActiveWork } from '../cancelRegistry.js';

export async function runInkSetup(
  runCore: (p: SetupPrompter) => Promise<FinishContext | null>,
  onCancel: () => void,
): Promise<FinishContext | null> {
  const ownsScreen = process.env.SASS_INSTALL_FRAME !== '1';
  if (ownsScreen) enterAlternateScreen();

  setInkSessionActive(true);
  const originalConsole = { log: console.log, warn: console.warn, error: console.error };
  const capture = (...args: unknown[]) => pushInkMessage(format(...args));
  console.log = capture;
  console.warn = capture;
  console.error = capture;
  const prompter = new InkSetupPrompter(onCancel);
  let cleaned = false;
  let app: ReturnType<typeof render> | undefined;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    app?.unmount();
    setInkSessionActive(false);
    Object.assign(console, originalConsole);
    if (ownsScreen) exitAlternateScreen();
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
  };
  const cancel = () => {
    if (cleaned) return;
    cancelAllActiveWork();
    cancelInkPrompt();
    cleanup();
    onCancel();
  };
  try {
    if (!ownsScreen) process.stdout.write('\u001b[H');
    app = render(<SetupView onCancel={cancel} />, { exitOnCtrlC: false, patchConsole: false });
    process.prependListener('SIGINT', cancel);
    process.prependListener('SIGTERM', cancel);
    const finish = await runCore(prompter);
    if (finish) {
      printPrivacyAndRecap(finish);
      if (finish.values.CLIENT_ID) pushInkMessage(`Invite Sass: ${inviteUrl(finish.values.CLIENT_ID)}`);
      if (usesSimpleSetup()) {
        await inkAction('Setup is ready. Enter to start Sass. Ctrl+C keeps her stopped.');
        finish.startedNow = true;
      } else {
        await prompter.confirm(finish.startedNow
          ? 'Setup saved. Enter to start Sass; Ctrl+C to stop.'
          : 'Setup saved. Start later with sass start. Enter to finish.', true);
      }
    }
    cleanup();
    if (ownsScreen && finish?.values.CLIENT_ID) console.log(inviteInstructions(finish.values.CLIENT_ID));
    return finish;
  } catch (err) {
    cleanup();
    throw err;
  }
}
