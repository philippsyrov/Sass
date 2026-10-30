// Unit tests for custom emoji lookup (src/emoji.ts), AI-output emoji fixing
// (src/ai/prompts.ts) and the bundled emoji uploader (src/emojiUpload.ts).
// All Discord API calls are mocked; nothing here touches the network.
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { register } from 'tsx/esm/api';

register();
const emoji = await import('../src/emoji.ts');
const { fixCustomEmoji } = await import('../src/ai/prompts.ts');
const upload = await import('../src/emojiUpload.ts');
const { SASS_EMOJI, SASS_EMOJI_NAMES, UNICODE_FALLBACK } = emoji;

const token = 'MTIzNDU2Nzg5MDEyMzQ1Njc4.fake-test.signature';
const appId = '123456789012345678';

function appEmoji(name, id, animated = false) {
  return { id, name, animated };
}

function resetEmoji() {
  emoji.applySassEmoji([]);
}

test('resolveSassEmoji builds <:sass_name:id> strings by name', () => {
  const resolved = emoji.resolveSassEmoji([
    appEmoji('sass_fire', '111111111111111111'),
    appEmoji('sass_clown', '222222222222222222', true),
    appEmoji('not_sass', '333333333333333333'),
    appEmoji('sass_unknown', '444444444444444444'),
  ]);
  assert.equal(resolved.fire, '<:sass_fire:111111111111111111>');
  assert.equal(resolved.clown, '<a:sass_clown:222222222222222222>');
  assert.equal(resolved.mid, UNICODE_FALLBACK.mid, 'missing names fall back to Unicode');
  assert.deepEqual(Object.keys(resolved).sort(), [...SASS_EMOJI_NAMES].sort());
});

test('every Sass emoji has a Unicode fallback', () => {
  for (const name of SASS_EMOJI_NAMES) {
    assert.ok(UNICODE_FALLBACK[name] && !UNICODE_FALLBACK[name].startsWith('<'), name);
  }
  assert.equal(UNICODE_FALLBACK.fire, '🔥');
  assert.equal(UNICODE_FALLBACK.clown, '🤡');
});

test('applySassEmoji updates SASS_EMOJI in place and reports what fell back', (t) => {
  t.after(resetEmoji);
  const missing = emoji.applySassEmoji([appEmoji('sass_fire', '111111111111111111'), appEmoji('sass_mid', '555555555555555555')]);
  assert.equal(SASS_EMOJI.fire, '<:sass_fire:111111111111111111>');
  assert.equal(SASS_EMOJI.mid, '<:sass_mid:555555555555555555>');
  assert.ok(!missing.includes('fire'));
  assert.ok(missing.includes('yawn'));
  assert.equal(missing.length, SASS_EMOJI_NAMES.length - 2);
  // Score helpers read the current values.
  assert.equal(emoji.getScoreEmoji(9), '<:sass_fire:111111111111111111>');
  assert.equal(emoji.getScoreEmoji(5), '<:sass_mid:555555555555555555>');
  assert.equal(emoji.getScoreEmoji(1), '🥱');
  assert.equal(emoji.getScoreBar(2), '🥱🥱' + '💨'.repeat(8));
});

test('loadSassEmoji fetches the application emoji (mocked client)', async (t) => {
  t.after(resetEmoji);
  let calls = 0;
  const fetched = new Map([['1', appEmoji('sass_stare', '666666666666666666')]]);
  const client = { application: { emojis: { fetch: async () => { calls++; return fetched; } } } };
  await emoji.loadSassEmoji(client);
  assert.equal(calls, 1);
  assert.equal(SASS_EMOJI.stare, '<:sass_stare:666666666666666666>');
  assert.equal(SASS_EMOJI.pout, '😤');
});

test('loadSassEmoji keeps Unicode fallbacks when the fetch fails', async (t) => {
  t.after(resetEmoji);
  const client = { application: { emojis: { fetch: async () => { throw new Error('boom'); } } } };
  await emoji.loadSassEmoji(client);
  await emoji.loadSassEmoji({ application: null });
  assert.deepEqual({ ...SASS_EMOJI }, { ...UNICODE_FALLBACK });
});

test('pickCustomReaction returns a custom or Unicode value usable by message.react()', (t) => {
  t.after(resetEmoji);
  assert.equal(emoji.pickCustomReaction('you are such a clown'), '🤡');
  assert.equal(emoji.pickCustomReaction('nothing matches here'), null);
  emoji.applySassEmoji([appEmoji('sass_clown', '777777777777777777')]);
  assert.equal(emoji.pickCustomReaction('you are such a clown'), '<:sass_clown:777777777777777777>');
  assert.equal(emoji.pickCustomReaction('this is so boring'), '😴');
});

test('fixCustomEmoji maps shortcodes and wrong IDs to the current value', (t) => {
  t.after(resetEmoji);
  assert.equal(fixCustomEmoji('ok :sass_stare:'), 'ok 😶');
  assert.equal(fixCustomEmoji('ok <:sass_judge:123>'), 'ok 🤨');
  assert.equal(fixCustomEmoji('bye <:made_up:999>'), 'bye ');
  assert.equal(fixCustomEmoji('time 10:30:45 stays'), 'time 10:30:45 stays');
  emoji.applySassEmoji([appEmoji('sass_judge', '888888888888888888')]);
  assert.equal(fixCustomEmoji('ok <:sass_judge:123>'), 'ok <:sass_judge:888888888888888888>');
  assert.equal(fixCustomEmoji(':sass_judge:'), '<:sass_judge:888888888888888888>');
  assert.equal(fixCustomEmoji('<:sass_judge:888888888888888888>'), '<:sass_judge:888888888888888888>');
});

async function emojiDir(t, names) {
  const dir = await mkdtemp(join(tmpdir(), 'sass-emoji-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const name of names) await writeFile(join(dir, `${name}.png`), Buffer.from(`png-${name}`));
  await writeFile(join(dir, 'README.txt'), 'not an emoji');
  return dir;
}

/** A fake Discord API that records requests and keeps an emoji list. */
function fakeDiscord(existing = [], { failPost = new Set(), listStatus = 200 } = {}) {
  const items = existing.map((name, i) => ({ id: String(1000000000000000000n + BigInt(i)), name }));
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    requests.push({ url, method, body, auth: init.headers?.Authorization });
    const json = (status, value) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
    if (!url.endsWith(`/applications/${appId}/emojis`)) return json(404, { message: 'Unknown' });
    if (method === 'GET') return listStatus === 200 ? json(200, { items }) : json(listStatus, { message: 'nope' });
    if (method === 'POST') {
      if (failPost.has(body.name)) return json(400, { message: 'Invalid Form Body' });
      items.push({ id: String(1000000000000000000n + BigInt(items.length)), name: body.name });
      return json(201, items.at(-1));
    }
    return json(405, { message: 'unexpected method' });
  };
  return { fetchImpl, requests, items };
}

test('uploader only uploads missing emoji, as base64 PNG data URIs', async (t) => {
  const dir = await emojiDir(t, ['sass_fire', 'sass_mid', 'sass_yawn']);
  const api = fakeDiscord(['sass_fire', 'someone_elses']);
  const result = await upload.uploadMissingEmoji({ token, appId, dir, fetchImpl: api.fetchImpl, log: () => {} });
  assert.deepEqual(result.uploaded, ['sass_mid', 'sass_yawn']);
  assert.deepEqual(result.skipped, ['sass_fire']);
  assert.deepEqual(result.failed, []);
  const posts = api.requests.filter((r) => r.method === 'POST');
  assert.equal(posts.length, 2);
  assert.equal(posts[0].body.name, 'sass_mid');
  assert.equal(posts[0].body.image, `data:image/png;base64,${Buffer.from('png-sass_mid').toString('base64')}`);
  assert.ok(api.requests.every((r) => r.auth === `Bot ${token}`));
  assert.ok(api.requests.every((r) => r.method === 'GET' || r.method === 'POST'), 'never deletes or edits');
});

test('uploader is idempotent: a second run uploads nothing', async (t) => {
  const dir = await emojiDir(t, ['sass_fire', 'sass_mid']);
  const api = fakeDiscord([]);
  const first = await upload.uploadMissingEmoji({ token, appId, dir, fetchImpl: api.fetchImpl, log: () => {} });
  assert.equal(first.uploaded.length, 2);
  const second = await upload.uploadMissingEmoji({ token, appId, dir, fetchImpl: api.fetchImpl, log: () => {} });
  assert.deepEqual(second.uploaded, []);
  assert.deepEqual(second.skipped, ['sass_fire', 'sass_mid']);
});

test('uploader reports per-file failures and keeps going', async (t) => {
  const dir = await emojiDir(t, ['sass_fire', 'sass_mid']);
  const api = fakeDiscord([], { failPost: new Set(['sass_fire']) });
  const result = await upload.uploadMissingEmoji({ token, appId, dir, fetchImpl: api.fetchImpl, log: () => {} });
  assert.deepEqual(result.uploaded, ['sass_mid']);
  assert.equal(result.failed[0].name, 'sass_fire');
  assert.match(result.failed[0].error, /HTTP 400/);
  assert.match(upload.summarizeUpload(result), /1 uploaded, 0 already there, 1 failed/);
});

test('uploader waits and retries on a rate limit', async (t) => {
  const dir = await emojiDir(t, ['sass_fire']);
  const api = fakeDiscord([]);
  let limited = false;
  const waits = [];
  const fetchImpl = async (url, init = {}) => {
    if (init.method === 'POST' && !limited) {
      limited = true;
      return new Response(JSON.stringify({ retry_after: 0.25 }), { status: 429 });
    }
    return api.fetchImpl(url, init);
  };
  const result = await upload.uploadMissingEmoji({ token, appId, dir, fetchImpl, log: () => {}, sleep: async (ms) => { waits.push(ms); } });
  assert.deepEqual(result.uploaded, ['sass_fire']);
  assert.deepEqual(waits, [250]);
});

test('uploader stops before uploading if the emoji list cannot be read, without leaking the token', async (t) => {
  const dir = await emojiDir(t, ['sass_fire']);
  const api = fakeDiscord([], { listStatus: 401 });
  await assert.rejects(
    upload.uploadMissingEmoji({ token, appId, dir, fetchImpl: api.fetchImpl, log: () => {} }),
    (err) => /401/.test(err.message) && !err.message.includes(token),
  );
  assert.ok(api.requests.every((r) => r.method === 'GET'));
  await assert.rejects(upload.uploadMissingEmoji({ token, appId: 'nope', dir, fetchImpl: api.fetchImpl }), /CLIENT_ID/);
});

test('the bundled assets cover every Sass emoji name', () => {
  const names = upload.listEmojiFiles('assets/emoji').map((f) => f.name).sort();
  assert.deepEqual(names, SASS_EMOJI_NAMES.map((n) => `sass_${n}`).sort());
});
