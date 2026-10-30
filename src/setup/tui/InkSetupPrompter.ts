import type { Check } from '../validate.js';
import type { LocalDetection, ProviderMenuEntry } from '../providerPick.js';
import { toProviderSelectOptions } from '../providerPick.js';
import type { SetupPrompter } from '../linePrompter.js';
import { InputEnded } from '../linePrompter.js';
import {
  formatSecretDisplay,
  inkAskText,
  inkConfirm,
  inkSelect,
  pushDoneLine,
  submitInkPrompt,
} from './prompterBridge.js';

export class InkSetupPrompter implements SetupPrompter {
  readonly interactive = true;
  readonly usesClack = false;

  constructor(private readonly onCancel: () => void) {}

  async ask(question: string, options: { fallback?: string; secret?: boolean } = {}): Promise<string> {
    const raw = await inkAskText(question, options);
    const value = raw.trim() || options.fallback || '';
    if (!options.secret) pushDoneLine(question, value);
    else pushDoneLine(question, formatSecretDisplay(value));
    return value;
  }

  async askValid(
    question: string,
    check: (raw: string) => Check,
    options: { fallback?: string; secret?: boolean } = {},
  ): Promise<string> {
    for (;;) {
      const raw = await inkAskText(question, options);
      const trimmed = raw.trim() || options.fallback || '';
      const result = check(trimmed);
      if (result.ok) {
        if (!options.secret) pushDoneLine(question, result.value);
        else pushDoneLine(question, formatSecretDisplay(result.value));
        return result.value;
      }
      pushDoneLine(question, `! ${result.error}`);
    }
  }

  async confirm(question: string, defaultYes: boolean): Promise<boolean> {
    const ok = await inkConfirm(question, defaultYes);
    pushDoneLine(question, ok ? 'yes' : 'no');
    return ok;
  }

  async choose(question: string, labels: string[], defaultIndex: number): Promise<number> {
    const idx = await inkSelect(question, labels, defaultIndex);
    const picked = labels[idx] ?? labels[defaultIndex] ?? '';
    pushDoneLine(question, picked);
    return idx;
  }

  async chooseProvider(entries: ProviderMenuEntry[], defaultIndex: number, _localDet: LocalDetection): Promise<number> {
    const options = toProviderSelectOptions(entries).filter((o) => !o.disabled);
    const labels = options.map((o) => o.label);
    const defaultKey = entries[defaultIndex]?.preset.key ?? 'anthropic';
    const defIdx = Math.max(0, options.findIndex((o) => o.value === defaultKey));
    const idx = await inkSelect('Who powers my replies?', labels, defIdx);
    const key = options[idx]?.value;
    const entryIdx = entries.findIndex((e) => e.preset.key === key);
    if (entryIdx < 0) throw new InputEnded();
    pushDoneLine('Provider', labels[idx] ?? '');
    return entryIdx;
  }

  close(): void {
    submitInkPrompt(-1, null);
  }
}
