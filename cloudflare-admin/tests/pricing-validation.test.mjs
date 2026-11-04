import test from 'node:test';
import assert from 'node:assert/strict';
import { validateInventory as validateServerInventory } from '../lib/admin-publisher.js';
import { validateInventory as validateBrowserInventory } from '../frontend/admin-validator.js';
import { validatePublishPayload } from '../worker.mjs';

const car = pricing => ({
  id: 'porsche-911', make: 'Porsche', model: '911', description: 'A confirmed vehicle description.',
  images: ['assets/car.jpg'], image: 'assets/car.jpg', status: 'available', ...pricing
});

for (const [name, validate] of [['server', validateServerInventory], ['browser', validateBrowserInventory]]) {
  test(`${name} accepts pound, euro, legacy euro and price-on-request stock without changing amounts`, () => {
    for (const pricing of [{ price: 49950, currency: 'GBP' }, { price: 49950, currency: 'EUR' }, { priceEUR: 49950 }, { price: null, currency: 'GBP' }, { price: null, currency: 'EUR' }]) {
      const vehicles = [car(pricing)];
      const original = structuredClone(vehicles);
      assert.equal(validate(vehicles), true);
      assert.deepEqual(vehicles, original);
    }
  });

  test(`${name} rejects missing or unsupported currencies and conflicting or invalid prices`, () => {
    for (const pricing of [
      { price: 49950 }, { price: 49950, currency: 'USD' }, { price: 49950, currency: 'gbp' },
      { price: -1, currency: 'GBP' }, { price: Infinity, currency: 'GBP' }, { price: NaN, currency: 'GBP' },
      { price: '49950', currency: 'GBP' }, { price: 1000000001, currency: 'GBP' },
      { price: null, currency: null }, { price: null, currency: 'USD' },
      { price: 49950, currency: 'GBP', priceEUR: 49950 },
      { price: null, currency: 'GBP', priceEUR: 49950 }, { priceEUR: 49950, currency: 'GBP' }
    ]) assert.throws(() => validate([car(pricing)]), error => error.code === 'VALIDATION', JSON.stringify(pricing));
  });
}

test('the publishing payload accepts canonical pound fields and preserves their meaning', () => {
  const value = { vehicles: [car({ price: 49950, currency: 'GBP' })], uploads: {}, expectedSha: 'a'.repeat(40) };
  assert.deepEqual(validatePublishPayload(value), value);
  assert.throws(() => validatePublishPayload({ ...value, vehicles: [car({ price: 49950, currency: 'USD' })] }), error => error.code === 'VALIDATION');
});
