import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'tsx/esm/api';
register();
const { replyTokenBudget, isReasoningChatModel } = await import('../src/ai/replyBudget.ts');

test('reasoning replies reserve space on direct and compatible API routes', () => {
  for (const model of ['claude-sonnet-5-5', 'anthropic/claude-sonnet-5-5', 'gpt-5.4-mini', 'openai/o3']) {
    assert.equal(replyTokenBudget(model, false, undefined, {}), 16384);
    assert.equal(replyTokenBudget(model, false, 60, {}), 16384);
  }
  assert.equal(replyTokenBudget('unknown-claude-alias', true, undefined, {}), 16384);
});

test('ordinary and local model replies no longer inherit the old 100-token cap', () => {
  assert.equal(replyTokenBudget('gpt-4o-mini', false, undefined, {}), 4096);
  assert.equal(replyTokenBudget('llama3.1:8b', false, undefined, {}), 4096);
  assert.equal(replyTokenBudget('gpt-4o-mini', false, 60, {}), 60);
  assert.equal(isReasoningChatModel('gpt-5-chat-latest'), false);
});

test('an explicit owner cost cap applies to every route and rejects invalid settings', () => {
  assert.equal(replyTokenBudget('claude-sonnet-5-5', true, 150, { SASS_REPLY_MAX_TOKENS: '8192' }), 8192);
  assert.equal(replyTokenBudget('llama3.1:8b', false, undefined, { SASS_REPLY_MAX_TOKENS: '1024' }), 1024);
  assert.equal(replyTokenBudget('llama3.1:8b', false, undefined, { SASS_REPLY_MAX_TOKENS: '8192' }), 8192);
  for (const value of ['0', '63', 'NaN', 'Infinity', '-2', '1e5', '200000']) {
    assert.throws(() => replyTokenBudget('model', false, undefined, { SASS_REPLY_MAX_TOKENS: value }), /SASS_REPLY_MAX_TOKENS/);
  }
});
