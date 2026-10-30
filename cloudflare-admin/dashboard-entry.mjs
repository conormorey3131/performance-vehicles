import protectedWorker from './worker.mjs';
import embeddedAssets from './dashboard-assets.generated.mjs';

// Frontend files are served directly inside this Worker. There is deliberately
// no Cloudflare static-assets binding/router: it does not propagate ctx.access.
// The existing Worker verifies Access identity before calling this in-process
// handler. No request can reach embedded files without the same identity check.
const fallbackAssets = {
  async fetch(request) {
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    const path = new URL(request.url).pathname;
    const asset = Object.hasOwn(embeddedAssets, path) ? embeddedAssets[path] : null;
    if (!asset) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    return new Response(request.method === 'HEAD' ? null : asset.body, { headers: { 'Content-Type': asset.contentType } });
  }
};

export default {
  fetch(request, env, ctx) {
    const assets = typeof env?.ASSETS?.fetch === 'function' ? env.ASSETS : fallbackAssets;
    return protectedWorker.fetch(request, { ...env, ASSETS: assets }, ctx);
  }
};
