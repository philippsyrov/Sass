import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'tsx/esm/api';
register();
const { chatProviderLabel } = await import('../src/ai/clientConfig.ts');

test('startup label names the configured chat provider independently of embeddings', () => {
  assert.equal(chatProviderLabel({AI_PROVIDER:'openai', OPENAI_BASE_URL:'https://api.anthropic.com/v1', EMBEDDING_OPENAI_BASE_URL:'http://localhost:11434/v1'}), 'Anthropic (Claude)');
  assert.equal(chatProviderLabel({AI_PROVIDER:'openai'}), 'OpenAI');
  assert.equal(chatProviderLabel({AI_PROVIDER:'ollama'}), 'Ollama');
  assert.equal(chatProviderLabel({AI_PROVIDER:'openai', OPENAI_BASE_URL:'https://openrouter.ai/api/v1'}), 'OpenRouter');
});

test('startup label never prints URL credentials or treats a lookalike host as Anthropic', () => {
  const authenticated = new URL('https://private.example/v1?key=synthetic');
  authenticated.username = 'synthetic-user';
  authenticated.password = 'synthetic-secret';
  for (const url of [authenticated.href, 'https://api.anthropic.com.example/v1', 'not a URL containing api.anthropic.com']) {
    assert.equal(chatProviderLabel({AI_PROVIDER:'openai', OPENAI_BASE_URL:url}), 'OpenAI-compatible API');
  }
});
