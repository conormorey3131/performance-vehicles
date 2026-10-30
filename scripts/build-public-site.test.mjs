import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPublicSite, PUBLIC_FILES } from './build-public-site.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'performance-public-build-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of PUBLIC_FILES) await writeFile(join(root, name), name === '.nojekyll' ? '' : `public:${name}`);
  await mkdir(join(root, 'assets', 'uploads'), { recursive: true });
  await writeFile(join(root, 'assets', 'favicon.svg'), '<svg/>');
  await writeFile(join(root, 'assets', 'uploads', 'car.jpg'), 'photo');
  return root;
}

test('the public artifact includes only showroom allowlisted files and image assets', async t => {
  const root = await fixture(t);
  await mkdir(join(root, 'cloudflare-admin', 'public'), { recursive: true });
  await writeFile(join(root, 'cloudflare-admin', 'public', 'index.html'), 'PRIVATE EDITOR');
  await writeFile(join(root, 'admin-publisher.js'), 'SERVER PUBLISHER');
  await writeFile(join(root, '.env'), 'DO NOT SHIP');
  await writeFile(join(root, 'README.md'), 'PRIVATE SETUP NOTES');
  const result = await buildPublicSite(root);
  assert.deepEqual((await readdir(result.directory)).sort(), [...PUBLIC_FILES, 'assets'].sort());
  assert.equal(await readFile(join(result.directory, 'assets', 'uploads', 'car.jpg'), 'utf8'), 'photo');
  assert.equal(result.files, PUBLIC_FILES.length + 2);
});

test('stale private files are removed before every build', async t => {
  const root = await fixture(t);
  const { directory } = await buildPublicSite(root);
  await mkdir(join(directory, 'cloudflare-admin'), { recursive: true });
  await writeFile(join(directory, 'cloudflare-admin', 'worker.mjs'), 'STALE');
  await writeFile(join(directory, '.env'), 'STALE');
  await buildPublicSite(root);
  assert.equal((await readdir(directory)).includes('cloudflare-admin'), false);
  assert.equal((await readdir(directory)).includes('.env'), false);
});

test('symlinked root files or assets cannot pull private source into the public artifact', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'private.txt'), 'PRIVATE');
  await symlink(join(root, 'private.txt'), join(root, 'assets', 'leaked.jpg'));
  await assert.rejects(buildPublicSite(root), /Unsupported public asset path/);
  await rm(join(root, 'assets', 'leaked.jpg'));
  await rm(join(root, 'index.html'));
  await symlink(join(root, 'private.txt'), join(root, 'index.html'));
  await assert.rejects(buildPublicSite(root), /regular files only/);
});

test('unexpected non-image assets fail closed rather than being published', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'assets', 'publishing-key.json'), 'PRIVATE');
  await assert.rejects(buildPublicSite(root), /Unsupported public asset type/);
});

test('the public stock-management page contains only a redirect and fallback to the protected admin', async () => {
  const html = await readFile(new URL('../admin.html', import.meta.url), 'utf8');
  assert.match(html, /http-equiv="refresh"\s+content="0;url=https:\/\/admin\.performancevehicles\.ie\/"/i);
  assert.match(html, /href="https:\/\/admin\.performancevehicles\.ie\/"/);
  assert.doesNotMatch(html, /<(?:script|form|input|textarea|select|iframe|object|embed)\b/i);
  assert.doesNotMatch(html, /github-token|open-draft|car-form|admin\.js|admin\.css|api\.github\.com/i);
});
