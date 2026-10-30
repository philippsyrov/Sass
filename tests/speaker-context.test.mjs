// The chat log Sass reads must label one person consistently, so a single user
// never reads as two different speakers.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'tsx/esm/api';

register();
const PERSON = '1000000000000000001';
const SELF = '1000000000000000002';
process.env.CREATOR_ID = PERSON;
delete process.env.DATABASE_URL;

const { speakerLabel, resolveMentions } = await import('../src/shared/speaker.ts');
const { messageBuffer } = await import('../src/messageBuffer.ts');
const { buildBaseContext } = await import('../src/shared/contextBuilder.ts');
const { getSassResponse } = await import('../src/ai/responses.ts');
const { resetOpenAIClientsForTests } = await import('../src/ai/providers.ts');

const users = {
  [SELF]: { id: SELF, username: 'Sass Test', displayName: 'Sass Test', bot: true },
  [PERSON]: { id: PERSON, username: 'creator', displayName: 'Creator', bot: false },
  '42': { id: '42', username: 'friend', displayName: 'Friend', bot: false },
};
let n = 0;
function fakeMessage(channelId, authorId, content) {
  n += 1;
  return {
    id: `m${n}`,
    content,
    createdTimestamp: n,
    channel: { id: channelId },
    author: users[authorId],
    client: { user: users[SELF] },
    mentions: { users: new Map([...content.matchAll(/<@!?(\d+)>/g)].map((m) => [m[1], users[m[1]]])) },
  };
}

test('speakerLabel puts the id in every human label and marks Sass', () => {
  assert.equal(speakerLabel({ authorId: PERSON, author: 'Creator', isBot: false }), `Creator (id ${PERSON})`);
  assert.equal(speakerLabel({ authorId: '42', author: 'Friend', isBot: false }), 'Friend (id 42)');
  assert.equal(speakerLabel({ authorId: SELF, author: 'Sass Test', isBot: true, isSelf: true }), 'Sass (you)');
  assert.equal(speakerLabel({ authorId: '7', author: 'Other', isBot: true }), 'Other [BOT]');
});

test('resolveMentions names Sass and other users instead of raw ids', () => {
  assert.equal(resolveMentions(`<@${SELF}> hi <@!42> and <@9>`, SELF, [users['42']]), '@Sass hi @Friend and <@9>');
});

test('the message being answered is not repeated in the log (one user message = one speaker)', async () => {
  // Reproduces the live bug: the only message in the buffer is the one being answered.
  const msg = fakeMessage('c1', PERSON, `<@${SELF}> Sass Test hello there`);
  messageBuffer.add(msg);
  const ctx = await buildBaseContext('g', 'c1', 25, { excludeMessageId: msg.id });
  assert.equal(ctx.recentContext, '');
  assert.equal(ctx.peopleContext, '');
  const saved = { ...process.env };
  const originalFetch = globalThis.fetch;
  let request;
  try {
    Object.assign(process.env, { AI_PROVIDER: 'openai', OPENAI_BASE_URL: 'https://example.invalid/v1', OPENAI_API_KEY: 'synthetic-key', OPENAI_MODEL: 'synthetic-model' });
    globalThis.fetch = async (_url, options) => {
      request = JSON.parse(options.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'reply' } }] }), { headers: { 'content-type': 'application/json' } });
    };
    resetOpenAIClientsForTests();
    await getSassResponse('Sass Test hello there', ctx);
    const prompt = request.messages[1].content;
    assert.equal(prompt.match(/hello there/g).length, 1);
    assert.doesNotMatch(prompt, /<@\d+>/);
  } finally {
    globalThis.fetch = originalFetch;
    process.env = saved;
    resetOpenAIClientsForTests();
  }
});

test('earlier lines, Sass replies and the current message all use one label', async () => {
  messageBuffer.add(fakeMessage('c2', PERSON, `<@${SELF}> hello there`));
  messageBuffer.add(fakeMessage('c2', SELF, "yo what's good"));
  const current = fakeMessage('c2', PERSON, `<@${SELF}> Sass Test hello there`);
  messageBuffer.add(current);
  const ctx = await buildBaseContext('g', 'c2', 25, { excludeMessageId: current.id });
  const label = `Creator (id ${PERSON})`;
  assert.equal(ctx.recentContext, `${label}: @Sass hello there\nSass (you): yo what's good`);
  assert.equal(ctx.peopleContext.split('\n').filter((l) => l.startsWith('- ')).length, 1, ctx.peopleContext);
  assert.match(ctx.peopleContext, new RegExp(`^- Creator \\(id ${PERSON}\\):`, 'm'));

});

test('two different people stay two speakers', async () => {
  messageBuffer.add(fakeMessage('c3', PERSON, 'hello'));
  messageBuffer.add(fakeMessage('c3', '42', 'hello'));
  const ctx = await buildBaseContext('g', 'c3', 25);
  assert.equal(ctx.peopleContext.split('\n').filter((l) => l.startsWith('- ')).length, 2);
  assert.match(ctx.recentContext, /Friend \(id 42\): hello/);
});
