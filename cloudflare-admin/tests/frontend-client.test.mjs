import test from 'node:test';
import assert from 'node:assert/strict';
import { PrivateAdminClient, AdminRequestError } from '../frontend/admin-client.js';

const email = 'conor@moreydigital.ie';
const vehicles = [{ id: 'porsche-911', make: 'Porsche', model: '911', description: 'Silver finish.', priceEUR: 49950, images: ['assets/porsche.jpg'] }];
const session = { authenticated: true, user: { email, name: 'Conor' }, publicSiteURL: 'https://performancevehicles.ie/', logoutURL: '/cdn-cgi/access/logout', publishingReady: true };
const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

test('default fetch preserves the native global receiver', async t => {
  const original = globalThis.fetch;
  const receivers = [];
  globalThis.fetch = function (resource, options) {
    receivers.push(this);
    assert.equal(this, globalThis, 'Native browser fetch must be called on its global object.');
    assert.equal(resource, '/api/session');
    assert.equal(options.credentials, 'same-origin');
    return Promise.resolve(jsonResponse(session));
  };
  t.after(() => { globalThis.fetch = original; });
  const client = new PrivateAdminClient();
  assert.equal((await client.session()).user.email, email);
  assert.deepEqual(receivers, [globalThis]);
});

test('session, inventory and publish use same-origin JSON without a browser publishing credential', async () => {
  const calls = [];
  const progress = [];
  const result = { vehicles, sha: 'new-stock', commitSha: 'new-commit', url: 'https://performancevehicles.ie/' };
  const uploads = { photo: { dataUrl: 'data:image/jpeg;base64,/9j/2Q==', name: 'photo.jpg', width: 1600, height: 900 } };
  const client = new PrivateAdminClient({
    onProgress: message => progress.push(message),
    fetchImpl: async (path, options) => {
      calls.push({ path, options });
      if (path === '/api/session') return jsonResponse(session);
      if (path === '/api/inventory') return jsonResponse({ vehicles, sha: 'old-stock' });
      if (path === '/api/publish') return jsonResponse(result);
      assert.fail(`Unexpected API path ${path}`);
    }
  });
  assert.deepEqual(await client.session(), session);
  assert.deepEqual(await client.load(), { vehicles, sha: 'old-stock' });
  assert.deepEqual(await client.publish({ vehicles, uploads, expectedSha: 'old-stock' }), result);
  assert.deepEqual(calls.map(call => call.path), ['/api/session', '/api/inventory', '/api/publish']);
  for (const { options } of calls) {
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.headers.Accept, 'application/json');
    assert.equal(options.headers['X-Requested-With'], 'XMLHttpRequest');
    assert.equal(options.signal instanceof AbortSignal, true);
    assert.equal(Object.keys(options.headers).some(key => key.toLowerCase() === 'authorization'), false);
    assert.equal(Object.keys(options.headers).some(key => key.toLowerCase().includes('token')), false);
  }
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[1].options.method, 'GET');
  assert.equal(calls[2].options.method, 'POST');
  assert.equal(calls[2].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[2].options.body), { vehicles, uploads, expectedSha: 'old-stock' });
  assert.equal(progress.length, 2);
});

test('session requires a verified identity and supports the server email shape', async () => {
  const valid = new PrivateAdminClient({ fetchImpl: async () => jsonResponse({ authenticated: true, email, publishingReady: true }) });
  assert.deepEqual((await valid.session()).user, { email, name: email });
  for (const value of [{ authenticated: false, user: { email } }, { authenticated: true }]) {
    const invalid = new PrivateAdminClient({ fetchImpl: async () => jsonResponse(value) });
    await assert.rejects(() => invalid.session(), error => error instanceof AdminRequestError && error.status === 401 && error.code === 'AUTH');
  }
});

test('401 JSON signals reauthentication without hiding the server error code', async () => {
  const client = new PrivateAdminClient({ fetchImpl: async () => jsonResponse({ error: { code: 'AUTH_REQUIRED', message: 'Sign in required.' } }, 401) });
  await assert.rejects(() => client.load(), error => error instanceof AdminRequestError && error.status === 401 && error.code === 'AUTH_REQUIRED' && error.message === 'Sign in required.');
});

test('a redirect or an HTML login response is treated as an expired session', async () => {
  const redirected = jsonResponse(session);
  Object.defineProperty(redirected, 'redirected', { value: true });
  const cases = [redirected, new Response('<!doctype html><title>Sign in</title>', { headers: { 'Content-Type': 'text/html' } })];
  for (const response of cases) {
    const client = new PrivateAdminClient({ fetchImpl: async () => response });
    await assert.rejects(() => client.session(), error => error instanceof AdminRequestError && error.code === 'AUTH' && error.status === 401);
  }
});

test('conflicts and unavailable publishing remain actionable service errors', async () => {
  for (const [status, code, message] of [[409, 'CONFLICT', 'Published stock changed.'], [503, 'PUBLISHING_NOT_READY', 'Publishing is not configured.']]) {
    const client = new PrivateAdminClient({ fetchImpl: async () => jsonResponse({ error: { code, message } }, status) });
    await assert.rejects(() => client.publish({ vehicles, expectedSha: 'old-stock' }), error => error instanceof AdminRequestError && error.status === status && error.code === code && error.message === message);
  }
});

test('an unconfirmed publish response requires verification before another publication', async () => {
  const client = new PrivateAdminClient({ fetchImpl: async () => jsonResponse({ ok: true }) });
  await assert.rejects(() => client.publish({ vehicles, expectedSha: 'old-stock' }), error => error instanceof AdminRequestError && error.code === 'VERIFY');
});

test('network failure does not expose underlying diagnostics', async () => {
  const diagnostic = 'provider diagnostic containing a credential-like secret';
  const client = new PrivateAdminClient({ fetchImpl: async () => { throw new Error(diagnostic); } });
  await assert.rejects(() => client.load(), error => error instanceof AdminRequestError && error.code === 'NETWORK' && !error.message.includes(diagnostic));
});
