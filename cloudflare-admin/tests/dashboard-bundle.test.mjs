import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const build = spawnSync(process.execPath, ['build.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(build.status, 0, `Direct Worker build failed: ${build.stderr || build.stdout}`);
const output = resolve(root, 'dist');
const source = await readFile(resolve(output, 'worker.js'), 'utf8');
const info = JSON.parse(await readFile(resolve(output, 'build-info.json'), 'utf8'));
// A data import proves the single artifact can load without a filesystem module
// graph or a separately uploaded asset binding.
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const env = { ADMIN_EMAILS: 'admin@example.com', PUBLIC_SITE_URL: 'https://performancevehicles.ie/', GITHUB_PUBLISH_TOKEN: 'TEST_SECRET_MUST_NOT_BE_RENDERED' };
const approved = { access: { getIdentity: async () => ({ email: 'admin@example.com', name: 'Admin' }) } };
const request = (path, init = {}) => new Request(`https://admin.example.com${path}`, init);

test('production configuration deploys a direct Worker without the static-assets router', async () => {
  const configuration = JSON.parse(await readFile(resolve(root, 'wrangler.jsonc'), 'utf8'));
  assert.equal(configuration.main, 'dist/worker.js');
  assert.equal(configuration.build.command, 'npm run build');
  assert.equal(configuration.no_bundle, true);
  assert.equal(configuration.workers_dev, false);
  assert.equal(configuration.preview_urls, false);
  assert.equal(Object.hasOwn(configuration, 'assets'), false);
});

test('direct Worker artifact is a small standalone ESM with exactly the protected frontend assets', () => {
  assert.equal(info.externalImports, 0);
  assert.ok(Buffer.byteLength(source) < 3 * 1024 * 1024);
  assert.deepEqual(info.embeddedFiles.sort(), ['admin-client.js', 'admin-validator.js', 'admin.css', 'admin.js', 'index.html']);
  assert.equal(typeof worker.fetch, 'function');
  assert.equal(/ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9]{30,}/.test(source), false);
});

test('anonymous requests cannot reach any embedded page, API, image or unknown path', async () => {
  for (const path of ['/', '/index.html', '/admin.html', '/admin.js', '/admin-client.js', '/admin-validator.js', '/admin.css', '/api/session', '/api/inventory', '/api/publish', '/assets/favicon.svg', '/unknown.js']) {
    const response = await worker.fetch(request(path, { headers: { 'Cf-Access-Authenticated-User-Email': 'admin@example.com', 'Cf-Access-Jwt-Assertion': 'forged-client-header' } }), env, {});
    assert.equal(response.status, 401, path);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store, max-age=0');
    const body = await response.text();
    assert.equal(body.includes('TEST_SECRET_MUST_NOT_BE_RENDERED'), false);
    assert.equal(body.includes('PRIVATE STOCK MANAGEMENT'), false);
    assert.equal(body.includes('const state ='), false);
  }
});

test('unapproved runtime identity is refused before an asset binding is used', async () => {
  let assetsCalled = false;
  const response = await worker.fetch(request('/admin.js'), { ...env, ASSETS: { fetch: async () => { assetsCalled = true; return new Response('must not load'); } } }, { access: { getIdentity: async () => ({ email: 'other@example.com' }) } });
  assert.equal(response.status, 403);
  assert.equal(assetsCalled, false);
});

test('approved runtime identity receives current embedded HTML, CSS and JS with private headers', async () => {
  for (const [path, type, marker] of [
    ['/', 'text/html', 'PRIVATE STOCK MANAGEMENT'],
    ['/admin.html', 'text/html', 'PRIVATE STOCK MANAGEMENT'],
    ['/index.html', 'text/html', 'PRIVATE STOCK MANAGEMENT'],
    ['/admin.css', 'text/css', ':root'],
    ['/admin.js', 'application/javascript', 'await bootstrap()'],
    ['/admin-client.js', 'application/javascript', 'class PrivateAdminClient'],
    ['/admin-validator.js', 'application/javascript', 'function validateInventory']
  ]) {
    const response = await worker.fetch(request(path), env, approved);
    assert.equal(response.status, 200, path);
    assert.ok(response.headers.get('Content-Type').startsWith(type), path);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store, max-age=0');
    assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
    assert.ok(response.headers.get('Content-Security-Policy').includes("frame-ancestors 'none'"));
    const body = await response.text();
    assert.ok(body.includes(marker), path);
    assert.equal(body.includes('TEST_SECRET_MUST_NOT_BE_RENDERED'), false, path);
    assert.equal(body.includes('github-token'), false, path);
  }
});

test('approved HEAD and missing assets have bounded static behavior', async () => {
  const head = await worker.fetch(request('/admin.js', { method: 'HEAD' }), env, approved);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const missing = await worker.fetch(request('/missing.js'), env, approved);
  assert.equal(missing.status, 404);
  const post = await worker.fetch(request('/index.html', { method: 'POST' }), env, approved);
  assert.equal(post.status, 405);
});

test('dashboard wrapper preserves a real asset binding and the original protected API router', async () => {
  const bound = await worker.fetch(request('/admin.css'), { ...env, ASSETS: { fetch: async assetRequest => new Response(`binding:${new URL(assetRequest.url).pathname}`, { headers: { 'Content-Type': 'text/css' } }) } }, approved);
  assert.equal(await bound.text(), 'binding:/admin.css');
  const session = await worker.fetch(request('/api/session'), env, approved);
  assert.equal(session.status, 200);
  const value = await session.json();
  assert.equal(value.user.email, 'admin@example.com');
  assert.equal(value.publicSiteURL, 'https://performancevehicles.ie/');
  assert.equal(value.publishingReady, true);
  assert.equal(JSON.stringify(value).includes('TEST_SECRET_MUST_NOT_BE_RENDERED'), false);
});
