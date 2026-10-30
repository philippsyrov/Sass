import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { mentionsSass, stripSassMentions, stripSassCommandAddress } from '../dist/shared/sassMention.js';

const bot = '1000000000000000001', role = '1000000000000000002';
const target = '1000000000000000003', guild = '1000000000000000004';
const roles = new Set([role, guild]);

test('direct account and assigned-role mentions address Sass at any position', () => {
  for (const text of [`<@${bot}> hello`, `hello <@!${bot}>`, `<@&${role}> tell me a joke`]) {
    assert.equal(mentionsSass(text, bot, roles, guild), true);
    assert.equal(stripSassMentions(text, bot, roles, guild).includes('<@'), false);
  }
});

test('broadcasts, unrelated roles, another bot and reply-only metadata are not direct addresses', () => {
  for (const text of ['@everyone hello', '@here hello', `<@&${guild}> hello`, `<@&${target}> hello`, `<@${target}> hello`, 'reply without an explicit ping']) {
    assert.equal(mentionsSass(text, bot, roles, guild), false);
    assert.equal(stripSassMentions(text, bot, roles, guild), text);
  }
  assert.equal(mentionsSass(`<@&${role}> hello`, bot, undefined, guild), false);
  assert.equal(mentionsSass(`<@${bot}> hello`, bot, undefined, guild), true);
});

test('role addressing preserves command target IDs and removes repeated leading addresses', () => {
  const raw = `<@&${role}> <@${bot}> remember <@!${target}> likes tea`;
  assert.equal(stripSassCommandAddress(raw, bot, roles, guild), `remember <@!${target}> likes tea`);
  assert.equal(stripSassCommandAddress(`<@${bot}> remember <@${bot}> likes tea`, bot, roles, guild), `remember <@${bot}> likes tea`);
});

test('trailing account and role addresses are removed from remembered facts without losing targets', () => {
  for (const address of [`<@${bot}>`, `<@&${role}>`]) {
    assert.equal(stripSassCommandAddress(`remember I like tea ${address}`, bot, roles, guild), 'remember I like tea');
    assert.equal(stripSassCommandAddress(`remember <@${target}> likes tea ${address}`, bot, roles, guild), `remember <@${target}> likes tea`);
    assert.equal(stripSassCommandAddress(`<@${bot}> remember <@${bot}> likes tea ${address}`, bot, roles, guild), `remember <@${bot}> likes tea`);
  }
  assert.equal(stripSassCommandAddress(`<@&${role}> ship <@${target}> <@${bot}>`, bot, roles, guild), `ship <@${target}> <@${bot}>`);
});

test('message routing sends role mentions through the same cooldown as account mentions', async () => {
  let receive;
  const calls = [];
  const source = readFileSync(new URL('../src/events/messageCreate.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const deps = {
    '../database/userDataGuard.js': { withUserDataContext: async (_guild, _user, work) => work() },
    '../handlers/mention/index.js': { handleMention: async () => calls.push('mention') },
    '../handlers/autoSass.js': { handleAutoSass: async () => calls.push('auto') },
    '../commands/index.js': { handleBattleMessage: async () => false },
    '../messageBuffer.js': { messageBuffer: { add: () => {} } },
    '../userMemory.js': { seen: () => {} },
    '../shipScore.js': {},
    '../shared/commandUtils.js': {},
    '../shared/sassMention.js': { mentionsSass },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'setInterval', compiled)(
    name => { assert.ok(deps[name], name); return deps[name]; }, module, module.exports, () => {},
  );
  module.exports.setupMessageHandler({ user: { id: bot }, on: (_event, handler) => { receive = handler; } });
  const base = { author: { id: target, username: 'Example', bot: false }, guild: { id: guild, members: { me: { roles: { cache: roles } } } }, channel: { id: 'example-channel' } };
  await receive({ ...base, id: 'message-one', content: `<@&${role}> tell me a joke` });
  await receive({ ...base, id: 'message-two', content: `<@${bot}> a different question` });
  assert.deepEqual(calls, ['mention']);
  await receive({ ...base, id: 'message-three', content: `<@&${bot}> hello` });
  assert.deepEqual(calls, ['mention', 'auto']);
});

test('the actual remember handler attributes role-addressed facts to the target, not the author', async () => {
  const writes = [], replies = [];
  const source = readFileSync(new URL('../src/handlers/mention/memoryOps.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const deps = {
    '../../userMemory.js': { remember: async (...args) => writes.push(['raw', ...args]) },
    '../../vectorMemory.js': { storeMemory: async (...args) => writes.push(['vector', ...args]) },
    './spamDetection.js': { setRememberCooldown: () => {} },
    '../../emoji.js': { SASS_EMOJI: {} },
    '../../shared/commandUtils.js': { pickRandom: values => values[0] },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => { assert.ok(deps[name], name); return deps[name]; }, module, module.exports);
  const message = { reply: async text => { replies.push(text); } };
  const command = stripSassCommandAddress(`<@&${role}> remember <@${target}> likes tea`, bot, roles, guild);
  assert.equal(await module.exports.handleRemember(message, { user: { id: bot } }, guild, '1000000000000000005', command), true);
  assert.deepEqual(writes, [['raw', guild, target, 'likes tea'], ['vector', guild, target, 'fact', 'likes tea']]);
  writes.length = 0;
  const selfTarget = stripSassCommandAddress(`<@${bot}> remember <@${bot}> likes tea`, bot, roles, guild);
  await module.exports.handleRemember(message, { user: { id: bot } }, guild, target, selfTarget);
  assert.deepEqual(writes, []);
  assert.match(replies.at(-1), /not storing dirt on myself/);
});
