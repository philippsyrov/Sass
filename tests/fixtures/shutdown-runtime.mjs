import { appendFileSync } from 'node:fs';
import { createShutdownHandler } from '../../dist/events/shutdown.js';
import { registerShutdownSignals } from '../../dist/shared/shutdownSignals.js';
import { runRuntimeCommand } from '../../dist/setup/runRuntime.js';
const [mode, audit] = process.argv.slice(2);
const mark = text => appendFileSync(audit, text + '\n');
if (mode === 'parent') {
  const code = await runRuntimeCommand(process.execPath, [import.meta.filename, 'child', audit]);
  mark('parent-exit:' + code);
  process.exit(code);
}
const handler = createShutdownHandler({
  stopMaintenance: async () => { mark('maintenance'); },
  flushMemory: async () => { await new Promise(r => setTimeout(r, 80)); mark('memory'); },
  closeClient: async () => { mark('discord'); },
  closeEmbedder: async () => { mark('embedder'); },
  closeDatabase: async () => { mark('database'); },
  exit: code => { mark('exit:' + code); process.exit(code); },
  log: text => { mark(text.trim()); console.log(text); },
  error: text => mark('ERROR:' + text),
});
registerShutdownSignals(signal => { void handler(signal); });
mark('ready');
setInterval(() => {}, 1000);
