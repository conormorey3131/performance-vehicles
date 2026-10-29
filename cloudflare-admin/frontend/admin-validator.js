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

