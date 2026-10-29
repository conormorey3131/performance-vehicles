import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorker, LIMITS } from '../worker.mjs';
import { PublishingError } from '../lib/admin-publisher.js';

const ORIGIN = 'https://admin.performancevehicles.ie';
const EMAIL = 'conor@moreydigital.ie';
const SECRET = 'test-only-server-secret-never-returned';
const SHA = 'a'.repeat(40);
const car = () => ({ id: 'porsche-911', make: 'Porsche', model: '911', description: 'A confirmed vehicle description.', images: ['assets/car.jpg'], image: 'assets/car.jpg', status: 'available' });
const payload = () => ({ vehicles: [car()], uploads: {}, expectedSha: SHA });
const context = (email = EMAIL, extra = {}) => ({ access: { aud: 'admin-audience', getIdentity: async () => ({ email, name: 'Approved administrator' }), ...extra } });
const env = (extra = {}) => ({ ADMIN_EMAILS: EMAIL, PUBLIC_SITE_URL: 'https://performancevehicles.ie', GITHUB_PUBLISH_TOKEN: SECRET, ASSETS: { fetch: async request => new Response(`<h1>${new URL(request.url).pathname}</h1>`, { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'public,max-age=86400' } }) }, ...extra });
const request = (path, options = {}) => new Request(ORIGIN + path, options);
const post = (value = payload(), headers = {}) => request('/api/publish', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) });

function harness(overrides = {}) {
  const calls = [];
  const client = {
    load: async () => { calls.push('load'); return { vehicles: [car()], sha: SHA }; },
    publish: async data => { calls.push(['publish', data]); return { vehicles: data.vehicles, sha: SHA, commitSha: 'b'.repeat(40), url: 'https://old.example/' }; },
    disconnect: () => calls.push('disconnect'),
    ...overrides
  };
  const worker = createWorker({ createRepositoryClient: token => { calls.push(['client', token]); return client; } });
  return { worker, calls };
}

test('missing runtime identity blocks every route, even when a valid-looking Access header is forged', async () => {
  const { worker, calls } = harness();
  let served = 0;
  const bindings = env({ ASSETS: { fetch: async () => { served++; return new Response('private'); } } });
  for (const path of ['/', '/index.html', '/admin.js', '/assets/car.jpg', '/api/session', '/api/inventory', '/api/publish']) {
    const response = await worker.fetch(request(path, { headers: { 'Cf-Access-Jwt-Assertion': 'forged', 'Cf-Access-Authenticated-User-Email': EMAIL } }), bindings, {});
    assert.equal(response.status, 401, path);
    assert.match(response.headers.get('Cache-Control'), /no-store/);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  }
  assert.equal(served, 0);
  assert.deepEqual(calls, []);
});

test('unapproved identity and a missing allowlist fail closed before serving assets or calling GitHub', async () => {
  const { worker, calls } = harness();
  assert.equal((await worker.fetch(request('/'), env(), context('visitor@example.ie'))).status, 403);
  assert.equal((await worker.fetch(request('/'), env({ ADMIN_EMAILS: '' }), context())).status, 503);
  assert.equal((await worker.fetch(request('/'), env({ ACCESS_AUD: 'another-audience' }), context())).status, 403);
  assert.equal((await worker.fetch(request('/'), env(), context(EMAIL, { getIdentity: async () => { throw new Error(SECRET); } }))).status, 401);
  assert.deepEqual(calls, []);
});

test('session supports an explicit email allowlist and never exposes a publishing key', async () => {
  const { worker, calls } = harness();
  const response = await worker.fetch(request('/api/session'), env({ ADMIN_EMAILS: `other@example.ie, ${EMAIL.toUpperCase()} ` }), context(EMAIL.toUpperCase()));
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.equal(body.includes(SECRET), false);
  assert.deepEqual(JSON.parse(body), { authenticated: true, email: EMAIL, name: 'Approved administrator', user: { email: EMAIL, name: 'Approved administrator' }, publicSiteURL: 'https://performancevehicles.ie/', logoutURL: '/cdn-cgi/access/logout', publishingReady: true });
  assert.deepEqual(calls, []);
  const missing = await worker.fetch(request('/api/session'), env({ GITHUB_PUBLISH_TOKEN: '' }), context());
  assert.equal((await missing.json()).publishingReady, false);
});

test('all private static assets pass through the identity check and receive private security headers', async () => {
  const { worker } = harness();
  const response = await worker.fetch(request('/'), env(), context());
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '<h1>/index.html</h1>');
  assert.match(response.headers.get('Cache-Control'), /private, no-store/);
  assert.match(response.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
});

test('inventory reads use only the server credential and disconnect after the request', async () => {
  const { worker, calls } = harness();
  const response = await worker.fetch(request('/api/inventory'), env(), context());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { vehicles: [car()], sha: SHA });
  assert.deepEqual(calls, [['client', SECRET], 'load', 'disconnect']);
});

test('the real repository client adds GitHub-required identity headers and never follows credential-bearing redirects', async () => {
  const calls = [];
  const source = `window.VEHICLES = ${JSON.stringify([car()])};`;
  const worker = createWorker({ fetchImpl: async (url, options) => {
    calls.push({ url: String(url), options });
    return Response.json({ type: 'file', encoding: 'base64', content: btoa(source), sha: SHA });
  } });
  const response = await worker.fetch(request('/api/inventory'), env(), context());
  assert.equal(response.status, 200);
  assert.equal(calls[0].url, 'https://api.github.com/repos/conormorey3131/performance-vehicles/contents/inventory.js?ref=main');
  assert.equal(calls[0].options.headers.get('User-Agent'), 'Performance-Vehicles-Admin');
  assert.equal(calls[0].options.headers.get('Authorization'), `Bearer ${SECRET}`);
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal((await response.text()).includes(SECRET), false);
});

test('a valid stock update uses the fixed repository client and returns the canonical public URL', async () => {
  const { worker, calls } = harness();
  const data = payload();
  const response = await worker.fetch(post(data), env(), context());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).url, 'https://performancevehicles.ie/');
  assert.deepEqual(calls, [['client', SECRET], ['publish', data], 'disconnect']);
});

test('missing, foreign, null and cross-site origins cannot mutate stock', async () => {
  const { worker, calls } = harness();
  for (const headers of [{ Origin: 'https://evil.example' }, { Origin: 'null' }, { Origin: '' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await worker.fetch(post(payload(), headers), env(), context())).status, 403);
  }
  assert.deepEqual(calls, []);
});

test('non-JSON requests, compressed bodies, wrong methods and unknown API paths never reach GitHub', async () => {
  const { worker, calls } = harness();
  assert.equal((await worker.fetch(post(payload(), { 'Content-Type': 'text/plain' }), env(), context())).status, 415);
  assert.equal((await worker.fetch(post(payload(), { 'Content-Encoding': 'gzip' }), env(), context())).status, 415);
  assert.equal((await worker.fetch(request('/api/publish'), env(), context())).status, 405);
  assert.equal((await worker.fetch(request('/api/session', { method: 'OPTIONS' }), env(), context())).status, 405);
  assert.equal((await worker.fetch(request('/api/repos/anything'), env(), context())).status, 404);
  assert.deepEqual(calls, []);
});

test('body bounds apply before GitHub writes even when Content-Length is forged', async () => {
  const { worker, calls } = harness();
  const stated = post(payload(), { 'Content-Length': String(LIMITS.requestBytes + 1) });
  assert.equal((await worker.fetch(stated, env(), context())).status, 413);
  const chunk = new Uint8Array(1024 * 1024).fill(32);
  let count = 0;
  const stream = new ReadableStream({ pull(controller) { if (count++ < 25) controller.enqueue(chunk); else controller.close(); } });
  const streamed = request('/api/publish', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'Content-Length': '1' }, body: stream, duplex: 'half' });
  assert.equal((await worker.fetch(streamed, env(), context())).status, 413);
  assert.deepEqual(calls, []);
});

test('unsupported fields, malformed stock, stale-token format and unrelated uploads are rejected', async () => {
  const { worker, calls } = harness();
  const invalid = [
    { ...payload(), endpoint: 'https://evil.example' },
    { ...payload(), token: SECRET },
    { ...payload(), expectedSha: '../main' },
    { ...payload(), uploads: { unrelated: { dataUrl: JPEG_PREFIX + '/9j/2Q==' } } },
    { ...payload(), vehicles: [{ ...car(), admin: true }] },
    { ...payload(), vehicles: [{ ...car(), description: 'x'.repeat(10001) }] },
    { ...payload(), vehicles: [{ ...car(), images: ['https://evil.example/file.jpg'] }] },
    { ...payload(), vehicles: [{ ...car(), priceEUR: -1 }] }
  ];
  for (const value of invalid) assert.equal((await worker.fetch(post(value), env(), context())).status, 400);
  assert.deepEqual(calls, []);
});

const JPEG_PREFIX = 'data:image/jpeg;base64,';
test('prepared image validation rejects oversized and disguised files while allowing a bounded JPEG', async () => {
  const { worker, calls } = harness();
  const withPhoto = dataUrl => ({ ...payload(), vehicles: [{ ...car(), images: ['upload:photo-1'], image: 'upload:photo-1' }], uploads: { 'photo-1': { id: 'photo-1', name: 'car.jpg', width: 1600, height: 900, dataUrl } } });
  assert.equal((await worker.fetch(post(withPhoto(JPEG_PREFIX + btoa('<script>bad</script>'))), env(), context())).status, 400);
  assert.equal((await worker.fetch(post(withPhoto(JPEG_PREFIX + 'AAAA'.repeat(Math.ceil((LIMITS.photoBytes + 1) / 3)))), env(), context())).status, 413);
  assert.deepEqual(calls, []);
  const jpeg = JPEG_PREFIX + btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 0, 2, 0xff, 0xd9));
  assert.equal((await worker.fetch(post(withPhoto(jpeg)), env(), context())).status, 200);
});

test('public-image proxy is fixed-origin, read-only, credential-free and refuses redirects', async () => {
  const calls = [];
  const worker = createWorker({ fetchImpl: async (url, options) => { calls.push({ url: String(url), options }); return new Response('image', { headers: { 'Content-Type': 'image/jpeg', 'Set-Cookie': 'CF_Authorization=untrusted', 'Access-Control-Allow-Origin': '*' } }); } });
  const response = await worker.fetch(request('/assets/uploads/car.jpg?target=https://evil.example'), env(), context());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(calls[0].url, 'https://performancevehicles.ie/assets/uploads/car.jpg');
  assert.deepEqual(calls[0].options, { method: 'GET', credentials: 'omit', redirect: 'manual', headers: { Accept: 'image/*' } });
  assert.equal((await worker.fetch(request('/assets/file.html'), env(), context())).status, 404);
  assert.equal(calls.length, 1);
  assert.equal((await worker.fetch(request('/assets/car.jpg'), env({ PUBLIC_SITE_URL: 'https://conormorey3131.github.io/performance-vehicles/' }), context())).status, 200);
  assert.equal(calls[1].url, 'https://conormorey3131.github.io/performance-vehicles/assets/car.jpg');
  const redirect = createWorker({ fetchImpl: async () => new Response(null, { status: 302, headers: { Location: 'https://evil.example' } }) });
  assert.equal((await redirect.fetch(request('/assets/car.jpg'), env(), context())).status, 502);
});

test('backend credential failures and unexpected errors do not leak secrets; conflicts retain recovery information', async () => {
  for (const thrown of [new Error(SECRET), new PublishingError(SECRET, 'AUTH'), new PublishingError(SECRET, 'API')]) {
    const { worker, calls } = harness({ publish: async () => { throw thrown; } });
    const response = await worker.fetch(post(), env(), context());
    assert.ok([502, 503].includes(response.status));
    assert.equal((await response.text()).includes(SECRET), false);
    assert.equal(calls.at(-1), 'disconnect');
  }
  const { worker } = harness({ publish: async () => { throw new PublishingError('A newer stock update exists. Reload stock.', 'CONFLICT'); } });
  const response = await worker.fetch(post(), env(), context());
  assert.equal(response.status, 409);
  assert.match((await response.json()).error.message, /Reload stock/);
});

test('no publishing token gives a clear unavailable state and no upstream requests', async () => {
  const { worker, calls } = harness();
  assert.equal((await worker.fetch(request('/api/inventory'), env({ GITHUB_PUBLISH_TOKEN: '' }), context())).status, 503);
  assert.equal((await worker.fetch(post(), env({ GITHUB_PUBLISH_TOKEN: '' }), context())).status, 503);
  assert.deepEqual(calls, []);
});
