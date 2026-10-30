import './env.js';
import { inviteInstructions } from './shared/discordInvite.js';

try {
  console.log(inviteInstructions(process.env.CLIENT_ID?.trim() ?? ''));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Could not generate the invite. Run sass setup.');
  process.exitCode = 1;
}
