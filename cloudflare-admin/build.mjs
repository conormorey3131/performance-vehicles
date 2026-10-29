import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const frontend = resolve(root, 'frontend');
const output = resolve(root, 'public');
const knownFiles = ['index.html', 'admin.css', 'admin.js', 'admin-client.js', 'admin-validator.js'];
await mkdir(output, { recursive: true });
for (const entry of await readdir(output)) if (!knownFiles.includes(entry)) await rm(resolve(output, entry), { recursive: true, force: true });
for (const name of knownFiles) await copyFile(resolve(frontend, name), resolve(output, name));
await mkdir(resolve(root, 'lib'), { recursive: true });
await copyFile(resolve(root, '..', 'admin-publisher.js'), resolve(root, 'lib', 'admin-publisher.js'));
console.log(`Prepared ${knownFiles.length} private frontend assets and the server-only publisher library.`);
