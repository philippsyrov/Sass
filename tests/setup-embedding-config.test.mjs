import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import test from 'node:test';
const root = fileURLToPath(new URL('../', import.meta.url));

async function importDist(relativePath) {
  const distPath = relativePath.replace(/^\.\/src\//, './dist/').replace(/\.ts$/, '.js');
  return import(pathToFileURL(join(root, distPath)).href);
}

function withEnv(overrides, fn) {
  const keys = Object.keys(overrides);
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, overrides);
  try {
    return fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test('Anthropic chat and Ollama embeddings use different hosts', async () => {
  const { resolveChatOpenAIConfig, resolveEmbeddingOpenAIConfig } = await importDist('./src/ai/clientConfig.ts');
  withEnv({
    AI_PROVIDER: 'openai',
    OPENAI_BASE_URL: 'https://api.anthropic.com/v1',
    OPENAI_API_KEY: 'sk-ant-chat',
    EMBEDDING_OPENAI_BASE_URL: 'http://127.0.0.1:11434/v1',
    EMBEDDING_OPENAI_API_KEY: 'ollama',
  }, () => {
    const chat = resolveChatOpenAIConfig();
    const embed = resolveEmbeddingOpenAIConfig();
    assert.equal(chat.baseURL, 'https://api.anthropic.com/v1');
    assert.equal(chat.apiKey, 'sk-ant-chat');
    assert.equal(embed.baseURL, 'http://127.0.0.1:11434/v1');
    assert.equal(embed.apiKey, 'ollama');
  });
});

test('LM Studio chat and Ollama embeddings stay separate', async () => {
  const { resolveChatOpenAIConfig, resolveEmbeddingOpenAIConfig } = await importDist('./src/ai/clientConfig.ts');
  withEnv({
    OPENAI_BASE_URL: 'http://127.0.0.1:1234/v1',
    OPENAI_API_KEY: 'lm-studio',
    EMBEDDING_OPENAI_BASE_URL: 'http://127.0.0.1:11434/v1',
    EMBEDDING_OPENAI_API_KEY: 'ollama',
  }, () => {
    const chat = resolveChatOpenAIConfig();
    const embed = resolveEmbeddingOpenAIConfig();
    assert.match(chat.baseURL ?? '', /1234/);
    assert.equal(chat.apiKey, 'lm-studio');
    assert.match(embed.baseURL ?? '', /11434/);
    assert.equal(embed.apiKey, 'ollama');
  });
});

test('OpenAI chat with dedicated embedding keys', async () => {
  const { resolveChatOpenAIConfig, resolveEmbeddingOpenAIConfig } = await importDist('./src/ai/clientConfig.ts');
  withEnv({
    OPENAI_API_KEY: 'sk-chat',
    EMBEDDING_OPENAI_API_KEY: 'sk-embed',
  }, () => {
    assert.equal(resolveChatOpenAIConfig().apiKey, 'sk-chat');
    assert.equal(resolveEmbeddingOpenAIConfig().apiKey, 'sk-embed');
  });
});
