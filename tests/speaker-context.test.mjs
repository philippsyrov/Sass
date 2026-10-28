// The chat log Sass reads must label one person consistently, so a single user
// (including the creator) never reads as two different speakers.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'tsx/esm/api';

register();
const CREATOR = '1000000000000000001';
const SELF = '1000000000000000002';
process.env.CREATOR_ID = CREATOR;
delete process.env.DATABASE_URL;

const { speakerLabel, resolveMentions } = await import('../src/shared/speaker.ts');
const { messageBuffer } = await import('../src/messageBuffer.ts');
const { buildBaseContext } = await import('../src/shared/contextBuilder.ts');
const { buildCreatorPrompt } = await import('../src/ai/responses.ts');

const users = {
  [SELF]: { id: SELF, username: 'Sass Test', displayName: 'Sass Test', bot: true },
  [CREATOR]: { id: CREATOR, username: 'example_user', displayName: 'ExampleUser', bot: false },
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

test('speakerLabel puts the id in every human label and marks the creator and Sass', () => {
  assert.equal(speakerLabel({ authorId: CREATOR, author: 'ExampleUser', isBot: false }), `ExampleUser (id ${CREATOR}, your creator)`);
  assert.equal(speakerLabel({ authorId: '42', author: 'Friend', isBot: false }), 'Friend (id 42)');
  assert.equal(speakerLabel({ authorId: SELF, author: 'Sass Test', isBot: true, isSelf: true }), 'Sass (you)');
  assert.equal(speakerLabel({ authorId: '7', author: 'Other', isBot: true }), 'Other [BOT]');
});

test('resolveMentions names Sass and other users instead of raw ids', () => {
  assert.equal(resolveMentions(`<@${SELF}> hi <@!42> and <@9>`, SELF, [users['42']]), '@Sass hi @Friend and <@9>');
});

test('the message being answered is not repeated in the log (one creator message = one speaker)', async () => {
  // Reproduces the live bug: the only message in the buffer is the one being answered.
  const msg = fakeMessage('c1', CREATOR, `<@${SELF}> Sass Test hello there`);
  messageBuffer.add(msg);
  const ctx = await buildBaseContext('g', 'c1', 25, { excludeMessageId: msg.id });
  assert.equal(ctx.recentContext, '');
  const prompt = buildCreatorPrompt('Sass Test hello there', ctx.recentContext, ctx.peopleContext, null,
    speakerLabel({ authorId: CREATOR, author: 'ExampleUser', isBot: false }));
  assert.equal(prompt.match(/hello there/g).length, 1, prompt);
  assert.doesNotMatch(prompt, /<@\d+>/);
});

test('creator earlier lines, Sass replies and the current message all use one label', async () => {
  messageBuffer.add(fakeMessage('c2', CREATOR, `<@${SELF}> hello there`));
  messageBuffer.add(fakeMessage('c2', SELF, "yo what's good"));
  const current = fakeMessage('c2', CREATOR, `<@${SELF}> Sass Test hello there`);
  messageBuffer.add(current);
  const ctx = await buildBaseContext('g', 'c2', 25, { excludeMessageId: current.id });
  const label = `ExampleUser (id ${CREATOR}, your creator)`;
  assert.equal(ctx.recentContext, `${label}: @Sass hello there\nSass (you): yo what's good`);
  assert.equal(ctx.peopleContext.split('\n').filter((l) => l.startsWith('- ')).length, 1, ctx.peopleContext);
  assert.match(ctx.peopleContext, new RegExp(`^- ExampleUser \\(id ${CREATOR}, your creator\\):`, 'm'));
  const prompt = buildCreatorPrompt('Sass Test hello there', ctx.recentContext, ctx.peopleContext, null, label);
  assert.match(prompt, new RegExp(`${label.replace(/[()]/g, '\\$&')} — same person as their lines above — just said to you: Sass Test hello there$`));
});

test('two different people stay two speakers', async () => {
  messageBuffer.add(fakeMessage('c3', CREATOR, 'hello'));
  messageBuffer.add(fakeMessage('c3', '42', 'hello'));
  const ctx = await buildBaseContext('g', 'c3', 25);
  assert.equal(ctx.peopleContext.split('\n').filter((l) => l.startsWith('- ')).length, 2);
  assert.match(ctx.recentContext, /Friend \(id 42\): hello/);
});
