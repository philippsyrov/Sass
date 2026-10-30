/**
 * Database choice labels and env updates for `npm run setup`.
 * Kept separate from I/O so tests can assert on copy and behaviour without a terminal.
 */

export const DATABASE_CHOICE_LABELS = [
  'Local database on this computer (recommended; no extra install, data in .sass-data/)',
  'I have a Postgres URL (Railway, Neon, etc.)',
  'Use Docker or Postgres already installed on this machine (advanced)',
  'Skip (no memory)',
] as const;

export const SKIP_DATABASE_LINES = [
  'Without Postgres, Sass still roasts, but you lose:',
  '  • vector memory and @Sass remember',
  '  • affinity and per-server mood',
  '  • cold shoulder and escalation memory',
  '  • background dreaming (memory cleanup every 6 hours)',
  '  • /forgetme',
] as const;

export type DatabaseChoice = 0 | 1 | 2 | 3;

export function applyEmbeddedDatabase(values: Record<string, string | undefined>): void {
  values.SASS_EMBEDDED_PG = '1';
  values.DATABASE_URL = '';
}

export function applyHostedDatabase(values: Record<string, string | undefined>, url: string): void {
  values.SASS_EMBEDDED_PG = '';
  values.DATABASE_URL = url;
}

export function applySkipDatabase(values: Record<string, string | undefined>): void {
  values.SASS_EMBEDDED_PG = '';
  values.DATABASE_URL = '';
}

export function describeDatabaseSummary(values: Record<string, string | undefined>): string {
  if (values.SASS_EMBEDDED_PG === '1') {
    return 'local embedded (.sass-data/, starts with npm start)';
  }
  if (values.DATABASE_URL) {
    return `set (${values.DATABASE_URL.length} characters, hidden)`;
  }
  return 'not set (memory off)';
}
