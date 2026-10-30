import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorker } from './build.mjs';

// Optional copy for Cloudflare Dashboard Quick Edit. Production Wrangler uses
// the identical direct Worker build at dist/worker.js.
const root = dirname(fileURLToPath(import.meta.url));
await buildWorker({ output: resolve(root, '../../cloudflare-dashboard-worker') });
