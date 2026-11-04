import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { validateInventory } from '../frontend/admin-validator.js';

const source = (await readFile(new URL('../frontend/admin.js', import.meta.url), 'utf8'))
  .replace(/^import .+;\n/gm, '')
  .replace(/\nawait bootstrap\(\);\s*$/, '');
const html = await readFile(new URL('../frontend/index.html', import.meta.url), 'utf8');
const car = { id: 'porsche-911', make: 'Porsche', model: '911', description: 'Silver finish.', priceEUR: null, status: 'available', image: 'assets/porsche.jpg', images: ['assets/porsche.jpg'], credit: 'Owner photography' };
const plain = value => JSON.parse(JSON.stringify(value));

class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase(); this.children = []; this.listeners = {}; this.dataset = {}; this.value = ''; this.textContent = ''; this.disabled = false; this.hidden = false; this.checked = false;
    this.options = ['', 'GBP', 'EUR', 'Coupé', 'Petrol', 'Automatic'].map(value => ({ value }));
    this.classList = { toggle() {}, add() {}, remove() {} };
  }
  get value() { return this._value; }
  set value(value) { this._value = String(value); }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  async dispatch(type, target = this) { for (const handler of this.listeners[type] || []) await handler({ target, preventDefault() {} }); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this[name] = value; }
  removeAttribute(name) { delete this[name]; }
  add(option) { this.options.push(option); }
  reportValidity() { return true; }
  reset() {}
  focus() {}
  scrollIntoView() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
}

function harness({ remote = [car], saved } = {}) {
  const elements = new Map([...html.matchAll(/<([a-z0-9]+)\b[^>]*\bid="([^"]+)"/gi)].map(([, tag, id]) => [id, Object.assign(new Element(tag), { id })]));
  const calls = [];
  class Client {
    async session() { return { user: { email: 'admin@example.com' }, publicSiteURL: 'https://performancevehicles.ie/', publishingReady: true }; }
    async load() { return { vehicles: structuredClone(remote), sha: 'published-stock' }; }
    async publish(payload) { calls.push(structuredClone(payload)); return { vehicles: payload.vehicles, sha: 'new-stock', url: 'https://performancevehicles.ie/' }; }
  }
  const context = vm.createContext({
    document: { getElementById: id => { assert.ok(elements.has(id), `Missing admin HTML control: ${id}`); return elements.get(id); }, createElement: tag => new Element(tag), querySelectorAll: () => [], body: new Element('body') },
    window: { addEventListener() {} }, PrivateAdminClient: Client, validateInventory, structuredClone, crypto: webcrypto, URL, Blob, TextEncoder, setTimeout: () => 0, clearTimeout() {},
    Option: class { constructor(text, value) { this.text = text; this.value = value; } }, savedFixture: saved
  });
  new vm.Script(`${source}\nreadDraft = async () => savedFixture; persist = async () => {}; confirmAction = async () => true;\nglobalThis.admin = { state, normalizeVehiclePricing, bootstrap, openEditor, readEditor, saveEditor, restoreBackup, requestPublish, publish, renderStock };`).runInContext(context);
  return { ...context.admin, elements, calls };
}

test('pricing migration preserves historical euro amounts, canonical currencies and unknown listing fields', () => {
  const { normalizeVehiclePricing } = harness();
  const legacy = { ...car, priceEUR: 145000, provenance: { suppliedByOwner: true } };
  const migrated = normalizeVehiclePricing(legacy);
  assert.equal(migrated.price, 145000);
  assert.equal(migrated.currency, 'EUR');
  assert.equal(Object.hasOwn(migrated, 'priceEUR'), false);
  assert.equal(migrated.credit, legacy.credit);
  assert.deepEqual(plain(migrated.provenance), legacy.provenance);
  assert.equal(legacy.priceEUR, 145000, 'Reading a draft must not mutate its source.');
  for (const [input, price, currency] of [
    [{ ...car, price: 21500, priceEUR: null }, 21500, 'EUR'],
    [{ ...car, price: 49950, currency: 'GBP' }, 49950, 'GBP'],
    [{ ...car, price: 49950, currency: 'EUR' }, 49950, 'EUR'],
    [{ ...car, price: null, currency: 'EUR' }, null, 'EUR'],
    [{ ...car }, null, 'GBP'],
    [{ id: 'unpriced' }, null, 'GBP']
  ]) {
    const result = normalizeVehiclePricing(input);
    assert.equal(result.price, price); assert.equal(result.currency, currency);
    assert.equal(Object.hasOwn(result, 'priceEUR'), false);
  }
});

test('ambiguous amounts and explicit invalid currencies cannot silently become valid GBP stock', () => {
  const { normalizeVehiclePricing } = harness();
  for (const input of [{ ...car, price: null, priceEUR: 12000, currency: 'GBP' }, { ...car, priceEUR: 12000, currency: 'GBP' }]) {
    assert.throws(() => normalizeVehiclePricing(input), /conflicting price|legacy euro price/);
  }
  const invalid = normalizeVehiclePricing({ ...car, price: 12000, currency: 'USD' });
  assert.equal(invalid.currency, 'USD');
  assert.throws(() => validateInventory([invalid]), /pounds \(GBP\) or euro \(EUR\)/);
});

test('new listing defaults to GBP POA and the currency selector changes labels and preview without conversion', async () => {
  const admin = harness();
  await admin.openEditor();
  const get = id => admin.elements.get(id);
  assert.equal(admin.state.editing.price, null);
  assert.equal(admin.state.editing.currency, 'GBP');
  assert.equal(get('car-currency').value, 'GBP');
  assert.equal(get('car-price-label').textContent, 'Price (£)');
  assert.equal(get('car-price').disabled, true);
  assert.equal(get('preview-price').textContent, 'Price on request');
  get('car-price-request').checked = false;
  await get('car-form').dispatch('input', get('car-price-request'));
  assert.equal(get('car-price').disabled, false);
  assert.equal(get('car-price').required, true);
  get('car-price').value = '49950';
  await get('car-form').dispatch('input', get('car-price'));
  assert.equal(get('preview-price').textContent, '£49,950');
  get('car-price').value = '49950.25';
  await get('car-form').dispatch('input', get('car-price'));
  assert.equal(get('preview-price').textContent, '£49,950.25');
  get('car-currency').value = 'EUR';
  await get('car-form').dispatch('change', get('car-currency'));
  assert.equal(get('car-price').value, '49950.25');
  assert.equal(get('car-price-label').textContent, 'Price (€)');
  assert.match(get('price-request-help').textContent, /euro/);
  assert.equal(get('preview-price').textContent, '€49,950.25');
  get('car-price-request').checked = true;
  await get('car-form').dispatch('change', get('car-price-request'));
  assert.equal(get('preview-price').textContent, 'Price on request');
  assert.equal(admin.readEditor().price, null);
  assert.equal(admin.readEditor().currency, 'EUR');
  get('car-make').value = 'Porsche'; get('car-model').value = '911';
  await admin.saveEditor({ preventDefault() {} });
  assert.equal(admin.state.vehicles[0].price, null);
  assert.equal(admin.state.vehicles[0].currency, 'EUR');
  assert.equal(Object.hasOwn(admin.state.vehicles[0], 'priceEUR'), false);
});

test('legacy numeric euro stock opens unchanged and saving a GBP edit updates the stock row and publish payload', async () => {
  const admin = harness({ remote: [{ ...car, priceEUR: 49950 }] });
  await admin.bootstrap();
  assert.equal(admin.state.dirty, false);
  assert.equal(admin.state.baseSha, 'published-stock');
  await admin.openEditor(car.id);
  const get = id => admin.elements.get(id);
  assert.equal(get('car-currency').value, 'EUR');
  assert.equal(get('car-price').value, '49950');
  assert.equal(get('preview-price').textContent, '€49,950');
  get('car-currency').value = 'GBP';
  await get('car-form').dispatch('change', get('car-currency'));
  await admin.saveEditor({ preventDefault() {} });
  const row = get('stock-list').children[0];
  assert.equal(row.children[2].textContent, '£49,950');
  assert.equal(admin.state.vehicles[0].credit, car.credit);
  admin.requestPublish(); await admin.publish();
  assert.equal(admin.calls.length, 1);
  assert.equal(admin.calls[0].vehicles[0].price, 49950);
  assert.equal(admin.calls[0].vehicles[0].currency, 'GBP');
  assert.equal(Object.hasOwn(admin.calls[0].vehicles[0], 'priceEUR'), false);
  assert.equal(admin.calls[0].expectedSha, 'published-stock');
  assert.equal(admin.state.dirty, false);
});

test('saved drafts and backup restoration migrate historical prices before validation and publication', async () => {
  const saved = { dirty: true, vehicles: [{ ...car, price: 27000 }], baseVehicles: [car], baseSha: 'published-stock', uploads: {} };
  const admin = harness({ saved });
  await admin.bootstrap();
  assert.equal(admin.state.vehicles[0].price, 27000);
  assert.equal(admin.state.vehicles[0].currency, 'EUR');
  assert.equal(admin.state.conflict, false);
  const data = { format: 'performance-vehicles-draft-v1', vehicles: [{ ...car, priceEUR: 28000 }, { ...car, id: 'new-stock', priceEUR: null }], uploads: {} };
  const target = { files: [{ size: 1500, text: async () => JSON.stringify(data) }], value: 'backup.json' };
  await admin.restoreBackup({ target });
  assert.equal(target.value, '');
  assert.equal(admin.state.vehicles[0].price, 28000);
  assert.equal(admin.state.vehicles[0].currency, 'EUR');
  assert.equal(admin.state.vehicles[1].price, null);
  assert.equal(admin.state.vehicles[1].currency, 'GBP');
  admin.requestPublish(); await admin.publish();
  assert.deepEqual(admin.calls[0].vehicles.map(({ price, currency }) => ({ price, currency })), [{ price: 28000, currency: 'EUR' }, { price: null, currency: 'GBP' }]);
  assert.equal(admin.calls[0].vehicles.some(value => Object.hasOwn(value, 'priceEUR')), false);
});
