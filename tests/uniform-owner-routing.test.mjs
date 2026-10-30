import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const owner = '1000000000000000001', other = '1000000000000000002', bot = '1000000000000000003';
process.env.CREATOR_ID = owner;

function load(path, deps, random = Math.random) {
  const source = readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  const math = Object.create(Math); math.random = random;
  new Function('require', 'module', 'exports', 'setInterval', 'Math', compiled)(
    name => { assert.ok(deps[name], `missing mock: ${name}`); return deps[name]; }, module, module.exports, () => {}, math,
  );
  return module.exports;
}

function message(userId, channelId = userId) {
  return {
    id: `message-${userId}`, content: 'hello there everyone today',
    author: { id: userId, username: 'Example', bot: false },
    guild: { id: 'guild', members: { me: { roles: { cache: new Set() } }, cache: new Map() } },
    channel: { id: channelId, sendTyping: async () => {} },
    mentions: { users: new Map() }, attachments: { find: () => null }, reply: async () => {},
  };
}

test('configured owner and another user receive the same mention context and pipeline treatment', async () => {
  const calls = [];
  const deps = {
    '../../ai/index.js': { getSassResponse: async (text, options) => { calls.push(['ai', text, options]); return { text: 'hello there' }; } },
    '../../userMemory.js': { getContext: async (...args) => { calls.push(['memory', args]); return 'memory'; }, getColdShoulder: async () => null },
    '../../shared/contextBuilder.js': { buildBaseContext: async () => ({ recentContext: '', peopleContext: '' }) },
    '../../shared/responsePipeline.js': { handleResponse: async options => calls.push(['pipeline', options]) },
    '../../cooldown.js': { isOnMentionCooldown: () => false, setMentionCooldown: () => {}, trackMentionEscalation: () => 'normal', getEscalationCount: () => 1 },
    '../../vectorMemory.js': { searchMemories: async () => [] },
    '../../mood.js': { shift: async () => {} },
    '../../caughtIn4k.js': { extractStatement: async () => null },
    '../../database/index.js': { getAffinity: async () => 50, updateAffinity: async () => {} },
    '../../responseMemory.js': { getRecentResponses: () => '' },
    './spamDetection.js': { isSpamPing: () => false, isSensitiveTopic: async () => null, isOnRememberCooldown: () => false, getSensitiveHint: () => '' },
    './personality.js': { buildPersonalityContext: () => 'personality' },
    './memoryOps.js': { handleRemember: async () => false },
    '../../emoji.js': { SASS_EMOJI: {} },
    '../../shared/commandUtils.js': { pickRandom: values => values[0] },
    '../../shared/speaker.js': { speakerLabel: () => 'Example', resolveMentions: text => text },
    '../../shared/sassMention.js': { stripSassCommandAddress: text => text, stripSassMentions: text => text },
  };
  const { handleMention } = load('handlers/mention/index.ts', deps);
  for (const user of [owner, other]) await handleMention(message(user), { user: { id: bot } });
  const ai = calls.filter(([kind]) => kind === 'ai');
  assert.equal(ai.length, 2);
  for (const [, text, options] of ai) {
    assert.equal(text, 'Example says: hello there everyone today');
    assert.match(options.userContext, /personality/);
    assert.equal('isCreator' in options, false);
  }
  assert.deepEqual(calls.filter(([kind]) => kind === 'memory').map(([, args]) => args.length), [3, 3]);
  assert.deepEqual(calls.filter(([kind]) => kind === 'pipeline').map(([, options]) => options.trackRoast), [true, true]);
});

test('configured owner and another user pass the same auto-sass message and cooldown gates', async () => {
  const calls = [];
  let blocked = false;
  const deps = {
    '../ai/index.js': { getConversationJoin: async () => ({ text: 'a proper witty response' }), queryAI: async () => '9' },
    '../userMemory.js': {},
    '../shared/contextBuilder.js': { buildBaseContext: async () => ({ recentMessages: [{ authorId: other, author: 'Example', isBot: false }], recentContext: 'context', peopleContext: '' }) },
    '../cooldown.js': { isOnAutoSassCooldown: () => blocked, isOnGuildAutoSassCooldown: () => false, setGuildAutoSassCooldown: () => {} },
    '../shared/commandUtils.js': { pickRandom: values => values[0] },
    '../mood.js': {}, '../database/index.js': { getAffinity: async () => 50 },
    '../responseMemory.js': { getRecentResponses: () => '' }, '../ai/prompts.js': {},
    '../shared/responsePipeline.js': { handleResponse: async options => calls.push(options.event.userId) },
  };
  const { handleAutoSass } = load('handlers/autoSass.ts', deps, () => 0.5);
  const client = { user: { id: bot } };
  for (const user of [owner, other]) {
    await handleAutoSass(message(user), client);
    await handleAutoSass(message(user), client);
  }
  assert.deepEqual(calls, [owner, other]);
  blocked = true;
  for (const user of [owner, other]) {
    await handleAutoSass(message(user), client);
    await handleAutoSass(message(user), client);
  }
  assert.deepEqual(calls, [owner, other]);
});
