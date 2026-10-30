import { MASCOT_45_256, MASCOT_45_TRUECOLOR } from './mascotData.generated.js';

/** Keep the original 45×23 artwork intact beside the setup controls. */
export function setupMascotLines(): readonly string[] {
  return process.env.SASS_COLOR_DEPTH === '256' ? MASCOT_45_256 : MASCOT_45_TRUECOLOR;
}
