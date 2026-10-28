// Unit tests for the bundled avatar/banner uploader (src/profileAssets.ts) and the
// setup wizard's model-list check (src/setup/checks.ts). All network calls are mocked.
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { register } from 'tsx/esm/api';

register();
const profile = await import('../src/profileAssets.ts');
const checks = await import('../src/setup/checks.ts');

const token = 'MTIzNDU2Nzg5MDEyMzQ1Njc4.fake-test.signature';

async function artDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'sass-profile-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const avatarPath = join(dir, 'avatar.png');
  const bannerPath = join(dir, 'banner.png');
  await writeFile(avatarPath, 'avatar-bytes');
  await writeFile(bannerPath, 'banner-bytes');
  return { avatarPath, bannerPath };
}

/** A fake Discord /users/@me that records requests. */
function fakeMe(me, { failPatch = new Set(), rateLimitOnce = false } = {}) {
  const requests = [];
  let limited = false;
  const fetchImpl = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    requests.push({ url, method, body, auth: init.headers?.Authorization });
    const json = (status, value) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
    if (!url.endsWith('/users/@me')) return json(404, { message: 'Unknown' });
    if (method === 'GET') return json(200, { id: '1', ...me });
    if (method === 'PATCH') {
      if (rateLimitOnce && !limited) { limited = true; return json(429, { retry_after: 0.5 }); }
      const field = Object.keys(body)[0];
      if (failPatch.has(field)) return json(400, { message: 'Invalid Form Body' });
      me[field] = 'hash_' + field;
      return json(200, { id: '1', ...me });
    }
    return json(405, { message: 'unexpected method' });
  };
  return { fetchImpl, requests, me };
}

test('sets avatar and banner when the bot has neither, as PNG data URIs', async (t) => {
  const paths = await artDir(t);
  const api = fakeMe({ avatar: null, banner: null });
  const result = await profile.setMissingProfileImages({ token, ...paths, fetchImpl: api.fetchImpl, log: () => {} });
  assert.deepEqual(result, { set: ['avatar', 'banner'], kept: [], failed: [] });
  const patches = api.requests.filter((r) => r.method === 'PATCH');
  assert.equal(patches.length, 2);
  assert.equal(patches[0].body.avatar, `data:image/png;base64,${Buffer.from('avatar-bytes').toString('base64')}`);
  assert.equal(patches[1].body.banner, `data:image/png;base64,${Buffer.from('banner-bytes').toString('base64')}`);
  assert.ok(api.requests.every((r) => r.auth === `Bot ${token}`));
  assert.match(profile.summarizeProfile(result), /set avatar and banner/);
});

test('never replaces an existing avatar or banner; a second run changes nothing', async (t) => {
  const paths = await artDir(t);
  const api = fakeMe({ avatar: 'custom_hash', banner: null });
  const first = await profile.setMissingProfileImages({ token, ...paths, fetchImpl: api.fetchImpl, log: () => {} });
  assert.deepEqual(first.set, ['banner']);
  assert.deepEqual(first.kept, ['avatar']);
  assert.equal(api.me.avatar, 'custom_hash');
  const second = await profile.setMissingProfileImages({ token, ...paths, fetchImpl: api.fetchImpl, log: () => {} });
  assert.deepEqual(second, { set: [], kept: ['avatar', 'banner'], failed: [] });
  assert.equal(api.requests.filter((r) => r.method === 'PATCH').length, 1);
});

test('a failed or missing image is reported and the other one is still set', async (t) => {
  const paths = await artDir(t);
  const api = fakeMe({ avatar: null, banner: null }, { failPatch: new Set(['avatar']) });
  const result = await profile.setMissingProfileImages({ token, avatarPath: paths.avatarPath, bannerPath: '/nonexistent/banner.png', fetchImpl: api.fetchImpl, log: () => {} });
  assert.deepEqual(result.set, []);
  assert.equal(result.failed.length, 2);
  assert.match(result.failed[0].error, /HTTP 400.*Invalid Form Body/);
  assert.match(result.failed[1].error, /not found/);

  const api2 = fakeMe({ avatar: null, banner: null }, { failPatch: new Set(['avatar']) });
  const result2 = await profile.setMissingProfileImages({ token, ...paths, fetchImpl: api2.fetchImpl, log: () => {} });
  assert.deepEqual(result2.set, ['banner']);
  assert.match(profile.summarizeProfile(result2), /avatar failed/);
});

test('waits and retries on a rate limit', async (t) => {
  const paths = await artDir(t);
  const api = fakeMe({ avatar: null, banner: 'x' }, { rateLimitOnce: true });
  const waits = [];
  const result = await profile.setMissingProfileImages({ token, ...paths, fetchImpl: api.fetchImpl, log: () => {}, sleep: async (ms) => { waits.push(ms); } });
  assert.deepEqual(result.set, ['avatar']);
  assert.deepEqual(waits, [500]);
});

test('throws without leaking the token when the profile cannot be read', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ message: '401: Unauthorized' }), { status: 401 });
  await assert.rejects(profile.setMissingProfileImages({ token, fetchImpl, log: () => {} }), (err) => {
    assert.match(err.message, /rejected the bot token/);
    assert.ok(!err.message.includes(token));
    return true;
  });
  await assert.rejects(profile.setMissingProfileImages({ token: '' }), /DISCORD_TOKEN/);
});

test('the bundled avatar and banner are PNGs of a sensible size', () => {
  const size = (path) => {
    const png = readFileSync(path);
    assert.equal(png.subarray(1, 4).toString(), 'PNG', path);
    assert.ok(png.length < 2 * 1024 * 1024, `${path} is under 2 MB`);
    return [png.readUInt32BE(16), png.readUInt32BE(20)];
  };
  const [aw, ah] = size(profile.AVATAR_PATH);
  assert.equal(aw, ah, 'avatar is square');
  const [bw, bh] = size(profile.BANNER_PATH);
  assert.ok(Math.abs(bw / bh - 17 / 6) < 0.05, 'banner is about 17:6');
});

test('model check uses x-api-key for Anthropic and Bearer elsewhere', () => {
  assert.deepEqual(checks.modelListHeaders('https://api.anthropic.com/v1', 'k'), { 'x-api-key': 'k', 'anthropic-version': '2023-06-01' });
  assert.deepEqual(checks.modelListHeaders('https://api.openai.com/v1', 'k'), { Authorization: 'Bearer k' });
  assert.equal(checks.isAnthropicBaseUrl('not a url'), false);
});

test('model check treats 400/404 as "could not verify" and 401 as a bad key', async () => {
  for (const status of [400, 404]) {
    const result = await checks.listOpenAIModels('https://example.test/v1', 'k', async () => new Response('{}', { status }));
    assert.equal(result.ok, false);
    assert.match(result.error, /Couldn't verify the model list.*continuing/);
  }
  const bad = await checks.listOpenAIModels('https://example.test/v1', 'k', async () => new Response('{}', { status: 401 }));
  assert.match(bad.error, /rejected the key/);
  const ok = await checks.listOpenAIModels('https://api.anthropic.com/v1', 'k', async (_url, init) => {
    assert.equal(init.headers['x-api-key'], 'k');
    return new Response(JSON.stringify({ data: [{ id: 'claude-haiku-4-5-20251001' }] }), { status: 200 });
  });
  assert.deepEqual(ok, { ok: true, data: ['claude-haiku-4-5-20251001'] });
});
