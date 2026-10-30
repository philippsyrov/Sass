import { ClackSetupPrompter, shouldUseClackPrompter as clackTtyOk } from './clackSetupPrompter.js';
import { shouldUseInkTui } from './shouldUseInkTui.js';
import { LineSetupPrompter, type SetupPrompter } from './linePrompter.js';

export type { SetupPrompter } from './linePrompter.js';
export { InputEnded } from './linePrompter.js';

export function shouldUseClackPrompter(): boolean {
  if (shouldUseInkTui()) return false;
  return clackTtyOk();
}

export function createSetupPrompter(onCancel: () => void): SetupPrompter {
  if (shouldUseClackPrompter()) return new ClackSetupPrompter(onCancel);
  return new LineSetupPrompter(onCancel);
}
