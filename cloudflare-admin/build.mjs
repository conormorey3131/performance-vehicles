import { build } from 'esbuild';
import { copyFile, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const frontendFiles = {
  'index.html': 'text/html; charset=utf-8',
  'admin.css': 'text/css; charset=utf-8',
  'admin.js': 'application/javascript; charset=utf-8',
  'admin-client.js': 'application/javascript; charset=utf-8',
  'admin-validator.js': 'application/javascript; charset=utf-8'
};

export async function buildWorker({ output = resolve(root, 'dist'), log = true } = {}) {
  await mkdir(resolve(root, 'lib'), { recursive: true });
  await copyFile(resolve(root, '..', 'admin-publisher.js'), resolve(root, 'lib', 'admin-publisher.js'));
  await mkdir(output, { recursive: true });
  const assets = {};
  for (const [name, contentType] of Object.entries(frontendFiles)) assets[`/${name}`] = { contentType, body: await readFile(resolve(root, 'frontend', name), 'utf8') };
  const generatedModule = resolve(output, 'embedded-assets.mjs');
  await writeFile(generatedModule, `export default Object.freeze(${JSON.stringify(assets)});\n`);
  const artifact = resolve(output, 'worker.js');
  const result = await build({
    absWorkingDir: root, entryPoints: [resolve(root, 'dashboard-entry.mjs')], outfile: artifact,
    bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', sourcemap: false,
    legalComments: 'none', metafile: true,
    plugins: [{ name: 'embedded-protected-admin-assets', setup(builder) {
      builder.onResolve({ filter: /^\.\/dashboard-assets\.generated\.mjs$/ }, () => ({ path: generatedModule }));
    } }]
  });
  for (const value of Object.values(result.metafile.outputs)) if (value.imports.length) throw new Error('The protected Worker must not depend on external imports.');
  const bytes = (await stat(artifact)).size;
  if (bytes >= 3 * 1024 * 1024) throw new Error('The protected Worker exceeds the 3 MiB artifact limit.');
  const info = { artifact, bytes, embeddedFiles: Object.keys(frontendFiles), externalImports: 0 };
  await writeFile(resolve(output, 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
  if (log) console.log(JSON.stringify({ ...info, kibibytes: Math.round(bytes / 1024 * 10) / 10 }));
  return info;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildWorker();
