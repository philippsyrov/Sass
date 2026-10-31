export async function load(url, context, next) {
  if (url.endsWith('/dist/setup/tui/prompterBridge.js')) return {
    format: 'module', shortCircuit: true,
    source: `import { act } from 'react';
      import * as real from ${JSON.stringify(url + '?real')};
      export * from ${JSON.stringify(url + '?real')};
      export function inkAction(message) {
        let response;
        act(() => { response = real.inkAction(message); });
        process.stdout.write('SASS_TEST_ACTION_READY');
        return response;
      }`,
  };
  if (process.env.SASS_TEST_RUNTIME_CANCEL !== '1' && url.endsWith('/dist/setup/tui/InkSetupPrompter.js')) return {
    format: 'module', shortCircuit: true,
    source: `import { InkSetupPrompter as Real } from ${JSON.stringify(url + '?real')};
      export class InkSetupPrompter extends Real {
        async askValid(question) { return question === 'Discord bot token' ? 'MTIzNDU2Nzg5MDEyMzQ1Njc4.fake-test.signature' : 'sk-ant-fake-test-not-a-credential'; }
        async chooseProvider() { return 0; }
      }`,
  };
  if (url.endsWith('/dist/embeddings/health.js')) return {
    format: 'module', shortCircuit: true,
    source: 'export async function checkEmbeddingHealth(){return {ok:true,detail:"synthetic cached model"}}',
  };
  if (url.endsWith('/dist/setup/spawnTracked.js')) return {
    format: 'module', shortCircuit: true,
    source: `import * as real from ${JSON.stringify(url + '?real')};
      export async function runTrackedCommand(command, args, options) {
        return args.includes('dist/index.js') ? real.runTrackedCommand(command, args, options) : 0;
      }`,
  };
  return next(url, context);
}
