// Guards against prompt wording that primes the model into phrases we don't want.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'tsx/esm/api';

register();
const prompts = await import('../src/ai/prompts.ts');
const all = {
  SASS_SYSTEM_PROMPT: prompts.SASS_SYSTEM_PROMPT,
  SASS_LITE_PROMPT: prompts.SASS_LITE_PROMPT,
  CREATOR_SYSTEM_PROMPT: prompts.CREATOR_SYSTEM_PROMPT,
};

test('prompts only mention "bit" in the banned words list', () => {
  for (const [name, text] of Object.entries(all)) {
    const banned = text.split('\n').find((line) => line.includes('"unprecedented,"')) ?? '';
    const rest = text.replace(banned, '');
    assert.doesNotMatch(rest, /\bbit\b/i, `${name} uses "bit" outside the banned words list`);
  }
  assert.match(prompts.SASS_SYSTEM_PROMPT, /"bit," "doing a bit," "starting a bit"/);
});

test('the creator prompt does not address the creator as a pair', () => {
  assert.doesNotMatch(prompts.CREATOR_SYSTEM_PROMPT, /\byou two\b/i);
});

test('group address ("you two", "both of you") is limited to several people talking', () => {
  assert.match(prompts.SASS_SYSTEM_PROMPT, /When SEVERAL people are being chaotic/);
  assert.match(prompts.SASS_SYSTEM_PROMPT, /If it's just one person, talk to them alone/);
});
