export class AdminRequestError extends Error {
  constructor(message, code = 'NETWORK', status = 0) { super(message); this.name = 'AdminRequestError'; this.code = code; this.status = status; }
}

export class PrivateAdminClient {
  #fetch;
  #progress;
  constructor({ fetchImpl = (resource, options) => globalThis.fetch(resource, options), onProgress = () => {} } = {}) { this.#fetch = fetchImpl; this.#progress = onProgress; }
  async request(path, { method = 'GET', body } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), method === 'POST' ? 120000 : 30000);
    try {
      const response = await this.#fetch(path, { method, credentials: 'same-origin', cache: 'no-store', redirect: 'follow', signal: controller.signal, headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (response.redirected || !response.headers.get('content-type')?.includes('application/json')) throw new AdminRequestError('Your sign-in needs to be renewed. Sign in again to continue.', 'AUTH', 401);
      let result;
      try { result = await response.json(); } catch (_) { throw new AdminRequestError('The stock service returned an unreadable response. Try again shortly.', 'RESPONSE', response.status); }
      if (!response.ok) {
        const code = result?.error?.code || (response.status === 401 ? 'AUTH' : response.status === 403 ? 'FORBIDDEN' : response.status === 409 ? 'CONFLICT' : 'SERVICE');
        const message = result?.error?.message || (response.status === 401 ? 'Your sign-in has expired. Sign in again to continue.' : response.status === 403 ? 'Your account does not have access to stock management.' : 'The stock update could not be completed. Your draft is still on this device.');
        throw new AdminRequestError(message, code, response.status);
      }
      return result;
    } catch (error) {
      if (error instanceof AdminRequestError) throw error;
      throw new AdminRequestError(controller.signal.aborted ? 'The stock service took too long to respond. Your saved draft is safe on this device. Reload stock before retrying a publication.' : 'The stock service could not be reached. Check your connection, or sign in again if your session has expired.', 'NETWORK');
    } finally { clearTimeout(timeout); }
  }
  async session() {
    const value = await this.request('/api/session');
    const email = value.user?.email || value.email;
    if (!email || value.authenticated === false) throw new AdminRequestError('Sign in with an approved administrator email address.', 'AUTH', 401);
    return { ...value, user: { email, name: value.user?.name || value.name || email } };
  }
  load() { return this.request('/api/inventory'); }
  async publish({ vehicles, uploads = {}, expectedSha }) {
    this.#progress('Uploading photographs and saving your stock update…');
    const value = await this.request('/api/publish', { method: 'POST', body: { vehicles, uploads, expectedSha } });
    if (!Array.isArray(value.vehicles) || !value.sha) throw new AdminRequestError('The update may have been saved, but could not be confirmed. Reload the published stock before trying again.', 'VERIFY');
    this.#progress('Stock saved. The public website is updating.');
    return value;
  }
}
