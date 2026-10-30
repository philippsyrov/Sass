/**
 * Interactive setup prompter using @clack/prompts (arrow keys, masked secrets, guide line).
 */
import * as clack from '@clack/prompts';
import { isCancel } from '@clack/prompts';
import type { ProviderMenuEntry, LocalDetection } from './providerPick.js';
import { toProviderSelectOptions } from './providerPick.js';
import type { Check } from './validate.js';
import { warn } from './terminal.js';
import type { AskOptions, SetupPrompter } from './linePrompter.js';
import { InputEnded } from './linePrompter.js';

function handleCancel<T>(value: T | symbol, onCancel: () => void): T {
  if (isCancel(value)) {
    onCancel();
    throw new InputEnded();
  }
  return value as T;
}

export class ClackSetupPrompter implements SetupPrompter {
  readonly interactive = true;
  readonly usesClack = true;

  constructor(private readonly onCancel: () => void) {}

  async ask(question: string, options: AskOptions = {}): Promise<string> {
    const { fallback, secret = false } = options;
    const hint = fallback ? (secret ? ' (Enter = keep current)' : ` (default: ${fallback})`) : '';
    const message = `${question}${hint}`;
    const prompt = secret
      ? clack.password({ message, validate: () => undefined })
      : clack.text({ message, validate: () => undefined });
    const raw = handleCancel<string>(await prompt, this.onCancel);
    const value = raw.trim();
    return value || fallback || '';
  }

  async askValid(question: string, check: (raw: string) => Check, options: AskOptions = {}): Promise<string> {
    const { fallback, secret = false } = options;
    const hint = fallback ? (secret ? ' (Enter = keep current)' : ` (default: ${fallback})`) : '';
    const message = `${question}${hint}`;

    for (;;) {
      const prompt = secret
        ? clack.password({
            message,
            validate: (value) => {
              const trimmed = (value ?? '').trim() || fallback || '';
              const result = check(trimmed);
              if (result.ok) return undefined;
              return result.error;
            },
          })
        : clack.text({
            message,
            validate: (value) => {
              const trimmed = (value ?? '').trim() || fallback || '';
              const result = check(trimmed);
              if (result.ok) {
                if (result.warning) warn(result.warning);
                return undefined;
              }
              return result.error;
            },
          });
      const raw = handleCancel<string>(await prompt, this.onCancel);
      const trimmed = raw.trim() || fallback || '';
      const result = check(trimmed);
      if (result.ok) {
        if (result.warning) warn(result.warning);
        return result.value;
      }
    }
  }

  async confirm(question: string, defaultYes: boolean): Promise<boolean> {
    return handleCancel<boolean>(
      await clack.confirm({ message: question, initialValue: defaultYes }),
      this.onCancel,
    );
  }

  async choose(question: string, labels: string[], defaultIndex: number): Promise<number> {
    const options = labels.map((label, i) => ({
      value: String(i),
      label,
    }));
    const picked = handleCancel(
      await clack.select({
        message: question,
        options,
        initialValue: String(defaultIndex),
      }),
      this.onCancel,
    );
    return Number(picked);
  }

  async chooseProvider(entries: ProviderMenuEntry[], defaultIndex: number, _localDet: LocalDetection): Promise<number> {
    const selectOptions = toProviderSelectOptions(entries);
    const defaultKey = entries[defaultIndex]?.preset.key ?? entries[0]?.preset.key ?? 'anthropic';
    const picked = handleCancel(
      await clack.select({
        message: 'Who powers Sass’s replies?',
        options: selectOptions,
        initialValue: defaultKey,
      }),
      this.onCancel,
    );
    const idx = entries.findIndex((e) => e.preset.key === picked);
    if (idx < 0) throw new InputEnded();
    return idx;
  }

  close(): void {
    // outro() or process exit handles the terminal; avoid a false "cancel" line.
  }
}

export function shouldUseClackPrompter(): boolean {
  const tty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!tty) return false;
  if (process.env.SASS_TEST_TERMINAL === '1') return false;
  if (process.env.CI) return false;
  return true;
}
