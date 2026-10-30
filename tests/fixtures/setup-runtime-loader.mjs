export async function load(url, context, next) {
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
