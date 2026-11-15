import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fakeEntry, startTestHub, type TestHub } from './helpers.ts';

let t: TestHub;
before(async () => { t = await startTestHub([fakeEntry('one', 'One')]); });
after(() => t.close());

test('health needs no sign-in', async () => {
  assert.deepEqual((await t.raw('GET', '/api/health')).body, { ok: true });
});

test('a foreign Host header is refused', async () => {
  const response = await t.raw('GET', '/api/health', { host: `evil.example:${t.hub.port}` });
  assert.equal(response.status, 403);
});

test('API calls without the session cookie get 401', async () => {
  const response = await t.raw('GET', '/api/state');
  assert.equal(response.status, 401);
  assert.ok(response.body.error);
});

test('the key buys a one-time code that signs the browser in once', async () => {
  assert.equal((await t.raw('POST', '/auth/code', { authorization: 'Bearer wrong' })).status, 401);
  const { body: { code } } = await t.raw('POST', '/auth/code', { authorization: `Bearer ${t.hub.key}` });
  const first = await t.raw('GET', `/auth?code=${code}`);
  assert.equal(first.status, 302);
  assert.equal(first.headers.location, '/');
  const cookie = String(first.headers['set-cookie']);
  assert.match(cookie, /^agentry_session=[0-9a-f]+; HttpOnly; SameSite=Strict; Path=\/; Max-Age=31536000$/);
  assert.equal((await t.raw('GET', '/api/state', { cookie: cookie.split(';')[0] })).status, 200);
  assert.equal((await t.raw('GET', `/auth?code=${code}`)).status, 401);
});

test('a mutating request from another origin is refused', async () => {
  const response = await t.raw('POST', '/api/agents/rescan', { cookie: t.cookie, origin: 'https://evil.example' });
  assert.equal(response.status, 403);
  assert.equal((await t.raw('POST', '/api/agents/rescan', { cookie: t.cookie, origin: t.hub.url })).status, 200);
});
