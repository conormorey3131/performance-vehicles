import { copyFile, lstat, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_FILES = Object.freeze(['index.html', 'styles.css', 'gallery.css', 'app.js', 'inventory.js', 'CNAME', '.nojekyll', 'admin.html']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.svg', '.ico', '.gif']);

async function requireRegularFile(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`The public build accepts regular files only: ${path}`);
}

export async function buildPublicSite(sourceRoot = repositoryRoot) {
  const source = resolve(sourceRoot);
  const output = join(source, 'dist-public');
  // The destination is a fixed generated child, never an argument supplied by a workflow.
  // Recreate it so stale files cannot survive a later reduction of the public allowlist.
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  let count = 0;
  for (const name of PUBLIC_FILES) {
    await requireRegularFile(join(source, name));
    await copyFile(join(source, name), join(output, name));
    count++;
  }
  const assets = join(source, 'assets');
  const assetInfo = await lstat(assets);
  if (!assetInfo.isDirectory() || assetInfo.isSymbolicLink()) throw new Error('The assets source must be a regular directory.');
  async function copyImages(relative = '') {
    await mkdir(join(output, 'assets', relative), { recursive: true });
    for (const entry of await readdir(join(assets, relative), { withFileTypes: true })) {
      if (entry.name === '.DS_Store') continue;
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(entry.name) || entry.isSymbolicLink()) throw new Error(`Unsupported public asset path: ${join(relative, entry.name)}`);
      const path = join(relative, entry.name);
      if (entry.isDirectory()) { await copyImages(path); continue; }
      if (!IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase())) throw new Error(`Unsupported public asset type: ${path}`);
      await requireRegularFile(join(assets, path));
      await copyFile(join(assets, path), join(output, 'assets', path));
      count++;
    }
  }
  await copyImages();
  return { directory: output, files: count };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildPublicSite();
  console.log(`Prepared ${result.files} allowlisted public files in ${result.directory}.`);
}
