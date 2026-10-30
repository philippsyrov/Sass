import { runInkSetup } from '../../dist/setup/tui/runInkSetup.js';
import { runWithSpinner } from '../../dist/setup/spinner.js';
await runInkSetup(async p => {
  await p.ask('HANDOFF_PROMPT');
  await runWithSpinner('Simulated setup', async () => {
    for (let i = 0; i < 100; i++) console.log(`SETUP_DETAIL_${i}`);
  });
  await p.confirm('HANDOFF_FINISH', true);
  return null;
}, () => process.exit(130));
