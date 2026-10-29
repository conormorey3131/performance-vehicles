import { PublishingError, RepositoryClient, validateInventory } from './lib/admin-publisher.js';

export const LIMITS = Object.freeze({ requestBytes: 24 * 1024 * 1024, uploads: 30, photoBytes: 2 * 1024 * 1024, vehicles: 500 });
const VEHICLE_FIELDS = new Set(['id', 'make', 'model', 'subtitle', 'description', 'image', 'images', 'body', 'credit', 'focus', 'status', 'priceEUR', 'year', 'mileageKm', 'fuel', 'transmission']);
const TEXT_FIELDS = { id: 101, make: 150, model: 150, subtitle: 250, description: 10000, image: 500, body: 100, credit: 500, focus: 50, status: 20, fuel: 100, transmission: 100 };
const UPLOAD_FIELDS = new Set(['id', 'dataUrl', 'name', 'width', 'height']);
const JPEG_PREFIX = 'data:image/jpeg;base64,';
const PUBLIC_IMAGE_PATH = /^\/assets\/[A-Za-z0-9_./-]+\.(?:jpe?g|png|webp|avif|svg)$/i;

class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function isRecord(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function fail(status, code, message) { throw new HttpError(status, code, message); }
function publicSiteURL(env) {
  try {
    const url = new URL(env.PUBLIC_SITE_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error();
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url.href;
  } catch (_) { fail(503, 'CONFIGURATION', 'The public website address has not been configured.'); }
}
function commonHeaders() {
  return {
    'Cache-Control': 'private, no-store, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Strict-Transport-Security': 'max-age=31536000',
    'X-Robots-Tag': 'noindex, nofollow, noarchive'
  };
}
function json(value, status = 200, extra = {}) {
  return Response.json(value, { status, headers: { ...commonHeaders(), ...extra } });
}
function errorResponse(error) {
  if (error instanceof HttpError) return json({ error: { code: error.code, message: error.message } }, error.status);
  if (error instanceof PublishingError) {
    if (error.code === 'VALIDATION') return json({ error: { code: error.code, message: error.message } }, 400);
    if (error.code === 'CONFLICT' || error.code === 'VERIFY') return json({ error: { code: error.code, message: error.message } }, 409);
    if (error.code === 'AUTH' || error.code === 'PERMISSION') return json({ error: { code: 'PUBLISHING_NOT_READY', message: 'Publishing access needs to be configured or renewed by the website administrator.' } }, 503);
  }
  return json({ error: { code: 'UPSTREAM', message: 'The stock update could not be completed. Reload published stock before trying again.' } }, 502);
}

async function authorisedIdentity(env, ctx) {
  const allowed = new Set(String(env.ADMIN_EMAILS || '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean));
  if (!allowed.size) fail(503, 'CONFIGURATION', 'Admin access has not been configured.');
  // Cloudflare supplies this runtime object after validating the Worker-level Access policy.
  // Request headers are deliberately never accepted as proof of identity.
  if (!ctx?.access || typeof ctx.access.getIdentity !== 'function') fail(401, 'AUTHENTICATION_REQUIRED', 'Sign in through the protected admin address.');
  let identity;
  try { identity = await ctx.access.getIdentity(); }
  catch (_) { fail(401, 'AUTHENTICATION_REQUIRED', 'Your sign-in could not be verified. Sign in again.'); }
  const email = typeof identity?.email === 'string' ? identity.email.trim().toLowerCase() : '';
  if (!email || !allowed.has(email)) fail(403, 'NOT_AUTHORISED', 'This account is not authorised to manage Performance Vehicles.');
  if (env.ACCESS_AUD && ctx.access.aud !== env.ACCESS_AUD) fail(403, 'NOT_AUTHORISED', 'This sign-in does not belong to the admin application.');
  return { email, name: typeof identity.name === 'string' ? identity.name.slice(0, 150) : email };
}

function requireSameOrigin(request, url) {
  if (request.headers.get('Origin') !== url.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    fail(403, 'CSRF', 'Publish changes from this admin page.');
  }
  const type = request.headers.get('Content-Type') || '';
  if (!/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(type)) fail(415, 'CONTENT_TYPE', 'Stock updates must use JSON.');
  if (request.headers.has('Content-Encoding')) fail(415, 'CONTENT_ENCODING', 'Compressed request bodies are not supported.');
}

async function readJSON(request) {
  const statedLength = request.headers.get('Content-Length');
  if (statedLength && (!/^\d+$/.test(statedLength) || Number(statedLength) > LIMITS.requestBytes)) fail(413, 'PAYLOAD_TOO_LARGE', 'Publish fewer photos at a time. This update is over 24 MB.');
  if (!request.body) fail(400, 'INVALID_JSON', 'The stock update is empty.');
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0, source = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > LIMITS.requestBytes) {
        await reader.cancel();
        fail(413, 'PAYLOAD_TOO_LARGE', 'Publish fewer photos at a time. This update is over 24 MB.');
      }
      source += decoder.decode(value, { stream: true });
    }
    source += decoder.decode();
    return JSON.parse(source);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    fail(400, 'INVALID_JSON', 'The stock update could not be read.');
  } finally { reader.releaseLock(); }
}

export function validatePublishPayload(payload) {
  if (!isRecord(payload) || Object.keys(payload).some(key => !['vehicles', 'uploads', 'expectedSha'].includes(key))) fail(400, 'VALIDATION', 'The stock update has an unsupported format.');
  const { vehicles, uploads = {}, expectedSha } = payload;
  if (!Array.isArray(vehicles) || vehicles.length > LIMITS.vehicles) fail(400, 'VALIDATION', 'The stock list must contain no more than 500 cars.');
  if (typeof expectedSha !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(expectedSha)) fail(400, 'VALIDATION', 'Reload published stock before publishing changes.');
  for (const car of vehicles) {
    if (!isRecord(car) || Object.keys(car).some(key => !VEHICLE_FIELDS.has(key))) fail(400, 'VALIDATION', 'A listing contains unsupported fields.');
    for (const [field, limit] of Object.entries(TEXT_FIELDS)) {
      if (car[field] !== undefined && (typeof car[field] !== 'string' || car[field].length > limit)) fail(400, 'VALIDATION', `A listing contains an invalid ${field} value.`);
    }
    if (!Array.isArray(car.images) || car.images.length > 30 || car.images.some(path => typeof path !== 'string' || path.length > 500)) fail(400, 'VALIDATION', 'Each car can contain up to 30 photo references.');
    if (car.image && !car.image.startsWith('upload:') && (!/^assets\/[A-Za-z0-9_./-]+\.(?:jpe?g|png|webp|avif)$/i.test(car.image) || car.image.includes('..'))) fail(400, 'VALIDATION', 'A cover photo reference is invalid.');
  }
  if (!isRecord(uploads) || Object.keys(uploads).length > LIMITS.uploads) fail(400, 'VALIDATION', 'Publish no more than 30 new photos in one update.');
  const referenced = new Set(vehicles.flatMap(car => car.images).filter(path => path.startsWith('upload:')).map(path => path.slice(7)));
  if (referenced.size !== Object.keys(uploads).length || Object.keys(uploads).some(id => !referenced.has(id))) fail(400, 'VALIDATION', 'The uploaded photos do not match the stock update.');
  for (const [id, photo] of Object.entries(uploads)) {
    if (!/^[A-Za-z0-9-]{1,100}$/.test(id) || !isRecord(photo) || Object.keys(photo).some(key => !UPLOAD_FIELDS.has(key))) fail(400, 'VALIDATION', 'An uploaded photo has an unsupported format.');
    if (photo.id !== undefined && photo.id !== id) fail(400, 'VALIDATION', 'An uploaded photo identifier does not match.');
    if (photo.name !== undefined && (typeof photo.name !== 'string' || photo.name.length > 250)) fail(400, 'VALIDATION', 'An uploaded photo name is invalid.');
    for (const field of ['width', 'height']) if (photo[field] !== undefined && (!Number.isInteger(photo[field]) || photo[field] < 1 || photo[field] > 1600)) fail(400, 'VALIDATION', 'Uploaded photos must be prepared at a maximum of 1600 pixels.');
    if (typeof photo.dataUrl !== 'string' || !photo.dataUrl.startsWith(JPEG_PREFIX)) fail(400, 'VALIDATION', 'Uploaded photos must be prepared as JPEG images.');
    const encoded = photo.dataUrl.slice(JPEG_PREFIX.length);
    if (!encoded.length || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) fail(400, 'VALIDATION', 'An uploaded photo could not be read.');
    const bytes = encoded.length / 4 * 3 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
    if (bytes > LIMITS.photoBytes) fail(413, 'PHOTO_TOO_LARGE', 'A prepared photo is over 2 MB. Choose a smaller image.');
    let start, end;
    try { start = atob(encoded.slice(0, 8)); end = atob(encoded.slice(-8)); }
    catch (_) { fail(400, 'VALIDATION', 'An uploaded photo could not be read.'); }
    if (bytes < 4 || start.charCodeAt(0) !== 0xff || start.charCodeAt(1) !== 0xd8 || start.charCodeAt(2) !== 0xff || end.charCodeAt(end.length - 2) !== 0xff || end.charCodeAt(end.length - 1) !== 0xd9) fail(400, 'VALIDATION', 'An uploaded photo is not a JPEG image.');
  }
  validateInventory(vehicles, uploads);
  return { vehicles, uploads, expectedSha };
}

function protectedAsset(response, siteURL) {
  const headers = new Headers(response.headers);
  // Public image origins and static-asset metadata must not set admin cookies or CORS policy.
  for (const key of [...headers.keys()]) if (key.toLowerCase() === 'set-cookie' || key.toLowerCase().startsWith('access-control-')) headers.delete(key);
  for (const [key, value] of Object.entries(commonHeaders())) headers.set(key, value);
  headers.set('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: ${new URL(siteURL).origin}; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'none'`);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function createWorker({ createRepositoryClient, fetchImpl = globalThis.fetch } = {}) {
  const makeClient = createRepositoryClient || (token => new RepositoryClient(token, {
    fetchImpl(resource, options = {}) {
      const destination = new URL(resource);
      if (destination.origin !== 'https://api.github.com') throw new Error('Unsupported publishing destination.');
      const headers = new Headers(options.headers);
      headers.set('User-Agent', 'Performance-Vehicles-Admin');
      return fetchImpl(destination, { ...options, headers, redirect: 'error' });
    }
  }));
  return {
    async fetch(request, env, ctx) {
      let client;
      try {
        const user = await authorisedIdentity(env, ctx);
        const url = new URL(request.url);
        const siteURL = publicSiteURL(env);
        const publishingReady = typeof env.GITHUB_PUBLISH_TOKEN === 'string' && !!env.GITHUB_PUBLISH_TOKEN.trim();
        if (url.pathname === '/api/session') {
          if (request.method !== 'GET') return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET for this endpoint.' } }, 405, { Allow: 'GET' });
          return json({ authenticated: true, email: user.email, name: user.name, user, publicSiteURL: siteURL, logoutURL: '/cdn-cgi/access/logout', publishingReady });
        }
        if (url.pathname === '/api/inventory' || url.pathname === '/api/publish') {
          const method = url.pathname === '/api/publish' ? 'POST' : 'GET';
          if (request.method !== method) return json({ error: { code: 'METHOD_NOT_ALLOWED', message: `Use ${method} for this endpoint.` } }, 405, { Allow: method });
          let payload;
          if (method === 'POST') { requireSameOrigin(request, url); payload = validatePublishPayload(await readJSON(request)); }
          if (!publishingReady) fail(503, 'PUBLISHING_NOT_READY', 'Publishing access needs to be configured by the website administrator.');
          client = makeClient(env.GITHUB_PUBLISH_TOKEN);
          const result = method === 'POST' ? await client.publish(payload) : await client.load();
          return json(method === 'POST' ? { ...result, url: siteURL } : result);
        }
        if (url.pathname.startsWith('/api/')) fail(404, 'NOT_FOUND', 'This admin endpoint does not exist.');
        if (!['GET', 'HEAD'].includes(request.method)) return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET or HEAD for this page.' } }, 405, { Allow: 'GET, HEAD' });
        if (url.pathname.startsWith('/assets/')) {
          if (!PUBLIC_IMAGE_PATH.test(url.pathname) || url.pathname.includes('..')) fail(404, 'NOT_FOUND', 'This image does not exist.');
          const target = new URL(url.pathname.slice(1), siteURL);
          // Read-only, fixed-origin photo requests never carry credentials or Access headers.
          const image = await fetchImpl(target, { method: request.method, credentials: 'omit', redirect: 'manual', headers: { Accept: 'image/*' } });
          if (!image.ok || !/^image\//i.test(image.headers.get('Content-Type') || '')) fail(502, 'IMAGE_UNAVAILABLE', 'The public website image is temporarily unavailable.');
          return protectedAsset(image, siteURL);
        }
        if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') fail(503, 'CONFIGURATION', 'The admin interface has not been deployed.');
        const assetURL = new URL(url);
        if (assetURL.pathname === '/' || assetURL.pathname === '/admin.html') assetURL.pathname = '/index.html';
        const response = await env.ASSETS.fetch(new Request(assetURL, request));
        return protectedAsset(response, siteURL);
      } catch (error) { return errorResponse(error); }
      finally { client?.disconnect(); }
    }
  };
}

export default createWorker();
