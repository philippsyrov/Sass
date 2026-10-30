import { inviteUrl } from '../setup/validate.js';

export function inviteInstructions(clientId: string): string {
  if (!/^\d{17,20}$/.test(clientId)) {
    throw new Error('Application ID is missing or invalid. Run sass setup to set CLIENT_ID.');
  }
  return [
    '',
    '=== Invite Sass to your server ===',
    'Open or copy this complete link:',
    '',
    inviteUrl(clientId),
    '',
    'Choose your Discord server and authorize Sass.',
    'Then mention her in a channel where she can read and send messages.',
    'Already added her? You can skip the invite.',
    'Show this link again: sass invite',
    '',
  ].join('\n');
}
