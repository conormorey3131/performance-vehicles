const OWNER = 'conormorey3131';
const REPOSITORY = 'performance-vehicles';
const BRANCH = 'main';
const ROOT = `/repos/${OWNER}/${REPOSITORY}`;
const STATUSES = new Set(['showcase', 'draft', 'available', 'reserved', 'sold']);

export class PublishingError extends Error {
  constructor(message, code = 'PUBLISHING', details = {}) {
    super(message); this.name = 'PublishingError'; this.code = code; this.details = details;
  }
}

export function parseInventory(source) {
  if (typeof source !== 'string') throw new PublishingError('The stock file could not be read.', 'INVALID_INVENTORY');
  const match = source.match(/^\s*window\.VEHICLES\s*=\s*([\s\S]+?)\s*;?\s*$/);
  if (!match) throw new PublishingError('The stock file has an unsupported format. No changes were published.', 'INVALID_INVENTORY');
  let values;
  try { values = JSON.parse(match[1]); } catch (_) { throw new PublishingError('The stock file contains invalid data. No changes were published.', 'INVALID_INVENTORY'); }
  if (!Array.isArray(values) || values.some(value => !value || typeof value !== 'object' || Array.isArray(value))) throw new PublishingError('The stock file must contain a list of cars.', 'INVALID_INVENTORY');
  return values;
}

export function validateInventory(vehicles, uploads = {}) {
  if (!Array.isArray(vehicles) || vehicles.length > 500) throw new PublishingError('The stock list must contain no more than 500 cars.', 'VALIDATION');
  const ids = new Set();
  vehicles.forEach((car, index) => {
    const label = [car?.make, car?.model].filter(Boolean).join(' ') || `Car ${index + 1}`;
    if (!car || typeof car !== 'object' || typeof car.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,100}$/.test(car.id) || ids.has(car.id)) throw new PublishingError(`${label}: the listing identifier is missing or duplicated.`, 'VALIDATION');
    ids.add(car.id);
    const status = car.status || 'showcase';
    if (!STATUSES.has(status)) throw new PublishingError(`${label}: choose a valid stock status.`, 'VALIDATION');
    for (const key of ['make', 'model']) if (typeof car[key] !== 'string' || !car[key].trim() || car[key].length > 150) throw new PublishingError(`${label}: add a ${key} (up to 150 characters).`, 'VALIDATION');
    if (typeof car.description !== 'string' || car.description.length > 10000 || (status !== 'draft' && !car.description.trim())) throw new PublishingError(`${label}: add a description before publishing it to the website.`, 'VALIDATION');
    for (const key of ['priceEUR', 'mileageKm']) if (car[key] != null && (typeof car[key] !== 'number' || !Number.isFinite(car[key]) || car[key] < 0 || car[key] > 1000000000)) throw new PublishingError(`${label}: enter a valid ${key === 'priceEUR' ? 'price' : 'mileage'}.`, 'VALIDATION');
    if (car.year != null && (!Number.isInteger(car.year) || car.year < 1886 || car.year > new Date().getFullYear() + 2)) throw new PublishingError(`${label}: enter a valid year.`, 'VALIDATION');
    const images = Array.isArray(car.images) ? car.images : [];
    if (images.length > 30 || (status !== 'draft' && !images.length)) throw new PublishingError(`${label}: add between 1 and 30 photos before showing it on the website.`, 'VALIDATION');
    images.forEach(path => {
      if (typeof path !== 'string') throw new PublishingError(`${label}: an image reference is invalid.`, 'VALIDATION');
      if (path.startsWith('upload:')) {
        const upload = uploads[path.slice(7)];
        if (!upload || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(upload.dataUrl || '')) throw new PublishingError(`${label}: an uploaded photo is missing. Add it again.`, 'VALIDATION');
      } else if (!/^assets\/[A-Za-z0-9_./-]+\.(?:jpe?g|png|webp|avif)$/i.test(path) || path.includes('..')) throw new PublishingError(`${label}: photos must be stored in the website’s assets folder.`, 'VALIDATION');
    });
  });
  return true;
}

function decodeUTF8(value) {
  const binary = atob(value.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, letter => letter.charCodeAt(0)));
}

export class RepositoryClient {
  #token;
  #fetch;
  #progress;
  constructor(token, { fetchImpl = globalThis.fetch, onProgress = () => {} } = {}) {
    if (typeof token !== 'string' || !token.trim()) throw new PublishingError('Enter your GitHub publishing key.', 'AUTH');
    this.#token = token.trim(); this.#fetch = fetchImpl; this.#progress = onProgress;
  }
  disconnect() { this.#token = ''; }
  async request(path, { method = 'GET', body } = {}) {
    if (!this.#token) throw new PublishingError('Connect your GitHub account before publishing.', 'AUTH');
    let response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      response = await this.#fetch(`https://api.github.com${path}`, {
        method, credentials: 'omit', cache: 'no-store', signal: controller.signal,
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${this.#token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
    } catch (_) { throw new PublishingError(controller.signal.aborted ? 'GitHub took too long to respond. Check your connection and try again.' : 'GitHub could not be reached. Check your connection and try again.', 'NETWORK'); }
    finally { clearTimeout(timeout); }
    if (!response.ok) {
      if (response.status === 401) throw new PublishingError('The publishing key is invalid or has expired. Create a new key and reconnect.', 'AUTH');
      if (response.status === 403 || response.status === 404) throw new PublishingError('GitHub has not granted access. Select only the performance-vehicles repository and give Contents read and write permission. Your account must have write access.', 'PERMISSION');
      if (response.status === 409 || response.status === 422) throw new PublishingError('The stock changed during this update. Reload published stock before trying again.', 'CONFLICT');
      throw new PublishingError(`GitHub could not complete this step (status ${response.status}). Your publishing key has not been saved.`, 'API');
    }
    return response.status === 204 ? null : response.json();
  }
  async authenticate() {
    const user = await this.request('/user');
    const repo = await this.request(ROOT);
    if (!repo.permissions?.push) throw new PublishingError('This GitHub account does not have permission to update Performance Vehicles.', 'PERMISSION');
    return { login: user.login, name: user.name || user.login };
  }
  async load(ref = BRANCH) {
    const file = await this.request(`${ROOT}/contents/inventory.js?ref=${encodeURIComponent(ref)}`);
    if (!file || file.encoding !== 'base64' || !file.content || file.type !== 'file') throw new PublishingError('The published stock file could not be loaded.', 'INVALID_INVENTORY');
    return { vehicles: parseInventory(decodeUTF8(file.content)), sha: file.sha };
  }
  async publish({ vehicles, uploads = {}, expectedSha }) {
    validateInventory(vehicles, uploads);
    if (!expectedSha) throw new PublishingError('Load the current published stock before publishing your changes.', 'CONFLICT');
    this.#progress('Checking the latest stock…');
    const branch = await this.request(`${ROOT}/git/ref/heads/${BRANCH}`);
    const parent = branch.object.sha;
    const latest = await this.load(parent);
    if (latest.sha !== expectedSha) throw new PublishingError('Someone has updated the stock since you opened it. Your draft is safe on this device. Reload published stock before publishing again.', 'CONFLICT');
    const commit = await this.request(`${ROOT}/git/commits/${parent}`);
    const output = structuredClone(vehicles);
    const usedUploads = [...new Set(output.flatMap(car => car.images || []).filter(path => path.startsWith('upload:')).map(path => path.slice(7)))];
    const imagePaths = new Map();
    const tree = [];
    for (let index = 0; index < usedUploads.length; index++) {
      const id = usedUploads[index];
      if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new PublishingError('An uploaded photo identifier is invalid. Add the photo again.', 'VALIDATION');
      this.#progress(`Uploading photo ${index + 1} of ${usedUploads.length}…`);
      const blob = await this.request(`${ROOT}/git/blobs`, { method: 'POST', body: { content: uploads[id].dataUrl.split(',')[1], encoding: 'base64' } });
      const path = `assets/uploads/${id}.jpg`;
      imagePaths.set(id, path);
      tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    output.forEach(car => {
      car.images = (car.images || []).map(path => path.startsWith('upload:') ? imagePaths.get(path.slice(7)) : path);
      car.image = car.images[0] || '';
    });
    this.#progress('Saving the vehicle descriptions and prices…');
    const inventorySource = `window.VEHICLES = ${JSON.stringify(output, null, 2)};\n`;
    const stockBlob = await this.request(`${ROOT}/git/blobs`, { method: 'POST', body: { content: inventorySource, encoding: 'utf-8' } });
    tree.push({ path: 'inventory.js', mode: '100644', type: 'blob', sha: stockBlob.sha });
    const newTree = await this.request(`${ROOT}/git/trees`, { method: 'POST', body: { base_tree: commit.tree.sha, tree } });
    const newCommit = await this.request(`${ROOT}/git/commits`, { method: 'POST', body: { message: `Update vehicle stock (${output.length} listings)`, tree: newTree.sha, parents: [parent] } });
    this.#progress('Publishing the stock update…');
    try { await this.request(`${ROOT}/git/refs/heads/${BRANCH}`, { method: 'PATCH', body: { sha: newCommit.sha, force: false } }); }
    catch (error) {
      if (error.code !== 'NETWORK') throw error;
      const current = await this.request(`${ROOT}/git/ref/heads/${BRANCH}`);
      if (current.object.sha !== newCommit.sha) throw new PublishingError('The final update could not be confirmed. Reload published stock before trying again.', 'CONFLICT');
    }
    let verified;
    try { verified = await this.load(newCommit.sha); }
    catch (_) { throw new PublishingError('GitHub saved the update, but confirmation was interrupted. Reload published stock to check the result before publishing again.', 'VERIFY', { commitSha: newCommit.sha }); }
    if (verified.sha !== stockBlob.sha) throw new PublishingError('GitHub saved the update, but its stock file could not be confirmed. Reload published stock before publishing again.', 'VERIFY', { commitSha: newCommit.sha });
    this.#progress('Stock saved. GitHub is updating the public website.');
    return { vehicles: output, sha: verified.sha, commitSha: newCommit.sha, url: `https://${OWNER}.github.io/${REPOSITORY}/` };
  }
}
