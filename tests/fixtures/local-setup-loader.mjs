export async function load(url, context, next) {
  if (url.endsWith('/dist/embeddings/health.js')) return { format: 'module', shortCircuit: true, source: 'export async function checkEmbeddingHealth(){return {ok:true,detail:"synthetic cached model"}}' };
  if (url.endsWith('/dist/setup/spawnTracked.js')) return { format: 'module', shortCircuit: true, source: 'export async function runTrackedCommand(){return 0}' };
  if (process.env.SASS_TEST_FINAL_ACTION === '1' && url.endsWith('/dist/setup/createPrompter.js')) return {
    format: 'module', shortCircuit: true,
    source: `import * as real from ${JSON.stringify(url + '?real')};
      export const InputEnded = real.InputEnded;
      export const shouldUseClackPrompter = real.shouldUseClackPrompter;
      export function createSetupPrompter(cancel) {
        const target = real.createSetupPrompter(cancel);
        return new Proxy(target, { get(target, key) {
          if (key === 'interactive') return true;
          const value = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        }});
      }`,
  };
  return next(url, context);
}
