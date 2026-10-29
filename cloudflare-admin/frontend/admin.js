import { PrivateAdminClient } from './admin-client.js';
import { validateInventory } from './admin-validator.js';

const $ = id => document.getElementById(id);
const clone = value => structuredClone(value);
let seed = [];
const state = { vehicles: clone(seed), baseVehicles: clone(seed), uploads: {}, baseSha: null, dirty: false, conflict: false, client: null, user: null, editing: null, editorDirty: false, isNew: false, busy: false, storageAvailable: true, publishingReady: false, publicSiteURL: 'https://performancevehicles.ie/' };
const money = value => typeof value === 'number' ? new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value) : 'Price on request';
const statusName = value => ({ available: 'Available', reserved: 'Reserved', sold: 'Sold', draft: 'Draft', showcase: 'Showcase' }[value] || 'Showcase');
let dbPromise;
let persistence = Promise.resolve();
let toastTimer;
let decisionResolve = null;

function node(tag, className, text) { const value = document.createElement(tag); if (className) value.className = className; if (text != null) value.textContent = text; return value; }
function fullName(car) { return [car.make, car.model].filter(Boolean).join(' ') || 'New vehicle'; }
function showMessage(id, text, type = '') { const target = $(id); target.textContent = text; target.className = `message ${type}`.trim(); target.hidden = !text; }
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000); }
function imageURL(path) { return path?.startsWith('upload:') ? state.uploads[path.slice(7)]?.dataUrl || '' : path || ''; }
function imageList(car) { return Array.isArray(car.images) ? car.images : car.image ? [car.image] : []; }
function signature(vehicles) { return JSON.stringify(vehicles); }

function database() {
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('performance-vehicles-admin', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspace');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Draft storage is unavailable.'));
  });
  return dbPromise;
}
async function readDraft() {
  const db = await database();
  return new Promise((resolve, reject) => { const request = db.transaction('workspace', 'readonly').objectStore('workspace').get('current'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
function persist() {
  const snapshot = { vehicles: clone(state.vehicles), baseVehicles: clone(state.baseVehicles), uploads: clone(state.uploads), baseSha: state.baseSha, dirty: state.dirty, updatedAt: new Date().toISOString() };
  persistence = persistence.catch(() => {}).then(async () => {
    const db = await database();
    await new Promise((resolve, reject) => { const transaction = db.transaction('workspace', 'readwrite'); transaction.objectStore('workspace').put(snapshot, 'current'); transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error); });
    state.storageAvailable = true;
  }).catch(() => {
    state.storageAvailable = false;
    showMessage('workspace-message', 'This browser could not save the draft. Keep this tab open, or download a draft backup before leaving.', 'error');
  });
  return persistence;
}
function pruneUploads() {
  const referenced = new Set(state.vehicles.flatMap(car => imageList(car)).filter(path => path.startsWith('upload:')).map(path => path.slice(7)));
  for (const id of Object.keys(state.uploads)) if (!referenced.has(id)) delete state.uploads[id];
}
function lock(value) {
  state.busy = value; document.body.classList.toggle('busy', value);
  document.querySelectorAll('button').forEach(button => {
    if (value) { button.dataset.beforeBusyDisabled = String(button.disabled); button.disabled = true; }
    else { button.disabled = button.dataset.beforeBusyDisabled === 'true'; delete button.dataset.beforeBusyDisabled; }
  });
  $('car-photos').disabled = value;
  updateConnection();
}
function updateConnection() {
  const connected = !!state.client && !!state.user;
  $('connection-dot').classList.toggle('connected', connected);
  $('connection-name').textContent = connected ? state.user.email : 'Sign-in required';
  $('connection-copy').textContent = connected ? 'Private stock management' : 'Sign in with an approved email address.';
  $('publish-button').disabled = !connected || !state.publishingReady || !state.dirty || state.conflict || state.busy;
  $('draft-status').textContent = !connected ? 'Sign in to manage stock.' : !state.publishingReady ? 'Publishing is being set up. Your saved drafts can be prepared on this device.' : state.conflict ? 'A newer stock update is available. Reload before publishing.' : state.dirty ? (state.storageAvailable ? 'Unpublished changes · Draft saved on this device.' : 'Unpublished changes · Browser draft storage is unavailable.') : 'Your stock matches the current published version.';
  $('side-count').textContent = String(state.vehicles.length);
}
function requireSignIn(error) {
  state.client = null; state.user = null; state.publishingReady = false;
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  $('workspace').hidden = true; $('welcome').hidden = false;
  $('session-heading').textContent = error?.status === 403 ? 'This account needs access.' : 'Sign in to continue.';
  $('session-copy').textContent = 'Use an approved administrator email address to open stock management.';
  showMessage('session-message', error?.message || 'Your sign-in has expired. Sign in again to continue.', 'error');
  $('session-signin').hidden = false; $('session-retry').hidden = false;
  updateConnection();
}
function handleRequestError(error, messageId = 'workspace-message') {
  if (error?.status === 401 || error?.status === 403 || error?.code === 'AUTH') { requireSignIn(error); return; }
  showMessage(messageId, error?.message || 'The stock service could not complete this request. Your draft is still on this device.', 'error');
}
async function bootstrap() {
  if (state.busy) return;
  $('workspace').hidden = true; $('welcome').hidden = false;
  $('session-heading').textContent = 'Opening your showroom.';
  $('session-copy').textContent = 'Checking your sign-in and loading the current stock.';
  $('session-signin').hidden = true; $('session-retry').hidden = true; showMessage('session-message', '');
  lock(true);
  try {
    const client = new PrivateAdminClient({ onProgress: text => showMessage('publish-progress', text, 'info') });
    const session = await client.session();
    const remote = await client.load();
    if (!Array.isArray(remote.vehicles) || !remote.sha) throw new Error('The current stock could not be loaded. Try again shortly.');
    const publicURL = new URL(session.publicSiteURL || state.publicSiteURL);
    if (publicURL.protocol !== 'https:') throw new Error('The public website address is not configured correctly.');
    state.client = client; state.user = session.user; state.publishingReady = session.publishingReady === true; state.publicSiteURL = publicURL.href;
    document.querySelectorAll('[data-public-site]').forEach(link => { link.href = publicURL.href; });
    $('logout-link').href = typeof session.logoutURL === 'string' && session.logoutURL.startsWith('/') && !session.logoutURL.startsWith('//') ? session.logoutURL : '/cdn-cgi/access/logout';
    seed = clone(remote.vehicles);
    let saved;
    try { saved = await readDraft(); } catch (_) { state.storageAvailable = false; }
    if (saved?.dirty === true && Array.isArray(saved.vehicles) && Array.isArray(saved.baseVehicles)) {
      state.vehicles = saved.vehicles; state.baseVehicles = saved.baseVehicles; state.uploads = saved.uploads || {}; state.baseSha = saved.baseSha || null; state.dirty = true;
      const sameBase = state.baseSha ? state.baseSha === remote.sha : signature(state.baseVehicles) === signature(remote.vehicles);
      state.conflict = !sameBase;
      if (sameBase) { state.baseSha = remote.sha; state.baseVehicles = clone(remote.vehicles); }
    } else {
      state.vehicles = clone(remote.vehicles); state.baseVehicles = clone(remote.vehicles); state.baseSha = remote.sha; state.uploads = {}; state.dirty = false; state.conflict = false;
    }
    openWorkspace();
    showMessage('workspace-message', state.conflict ? 'A saved draft was restored, but the published stock has changed. Download a backup if needed, then reload published stock before publishing.' : state.dirty ? 'Your saved draft has been restored on this device.' : !state.publishingReady ? 'Publishing has not been enabled yet. Ask the site owner to complete the connection before publishing changes.' : '', state.conflict ? 'error' : 'info');
  } catch (error) {
    if (error?.status === 401 || error?.status === 403 || error?.code === 'AUTH') requireSignIn(error);
    else { state.client = null; state.user = null; state.publishingReady = false; $('session-heading').textContent = 'We couldn’t open your stock.'; $('session-copy').textContent = 'Your existing saved drafts remain on this device.'; showMessage('session-message', error.message || 'Please try again shortly.', 'error'); $('session-retry').hidden = false; $('session-signin').hidden = false; }
  } finally { lock(false); }
}
function openWorkspace() { $('welcome').hidden = true; $('workspace').hidden = false; renderStock(); updateConnection(); }
function renderStock() {
  const query = $('stock-query').value.toLowerCase().trim(); const filter = $('stock-status').value;
  const cars = state.vehicles.filter(car => (!query || fullName(car).toLowerCase().includes(query)) && (!filter || (car.status || 'showcase') === filter));
  const list = $('stock-list'); list.replaceChildren();
  $('stock-count').textContent = `${cars.length} of ${state.vehicles.length} ${state.vehicles.length === 1 ? 'listing' : 'listings'}`;
  cars.forEach(car => {
    const row = node('article', 'stock-row');
    const img = node('img', 'stock-row-image'); img.src = imageURL(imageList(car)[0]); img.alt = fullName(car); img.loading = 'lazy'; if (!img.src || !imageList(car).length) { img.removeAttribute('src'); img.alt = 'No photo yet'; }
    const title = node('div'); title.append(node('h3', 'stock-row-title', fullName(car)), node('p', 'stock-row-meta', [car.year, car.body, `${imageList(car).length} photos`].filter(Boolean).join(' · ')));
    const price = node('div', 'stock-row-price', money(car.priceEUR)); price.append(node('small', '', car.status === 'draft' ? 'Hidden from website' : 'Shown on website'));
    const badge = node('span', `badge badge-${car.status || 'showcase'}`, statusName(car.status));
    const edit = node('button', 'stock-row-edit', 'Edit ↗'); edit.type = 'button'; edit.setAttribute('aria-label', `Edit ${fullName(car)}`); edit.addEventListener('click', () => openEditor(car.id));
    row.append(img, title, price, badge, edit); list.append(row);
  });
  if (!cars.length) { const empty = node('div', 'stock-empty'); empty.append(node('h3', '', 'Room for something special.'), node('p', '', query || filter ? 'Try another search or status.' : 'Add your first car to start the collection.')); list.append(empty); }
  updateConnection();
}
function setSelect(id, value) {
  const select = $(id);
  if (value && ![...select.options].some(option => option.value === value)) select.add(new Option(value, value));
  select.value = value || '';
}
function confirmAction({ title, message, confirmLabel = 'Continue', cancelLabel = 'Keep editing', danger = false }) {
  if (decisionResolve) return Promise.resolve(false);
  $('decision-heading').textContent = title; $('decision-message').textContent = message;
  $('decision-confirm').textContent = confirmLabel; $('decision-confirm').className = `button ${danger ? 'danger-primary' : 'primary'}`;
  $('decision-cancel').textContent = cancelLabel;
  return new Promise(resolve => { decisionResolve = resolve; $('decision-dialog').showModal(); $('decision-cancel').focus(); });
}
function resolveDecision(value) {
  const resolve = decisionResolve; decisionResolve = null;
  if ($('decision-dialog').open) $('decision-dialog').close();
  resolve?.(value);
}
async function discardEditor({ force = false } = {}) {
  if (!force && state.editorDirty && !await confirmAction({ title: 'Discard these edits?', message: 'The unsaved changes to this listing will be discarded. Your saved draft stock will be kept.', confirmLabel: 'Discard edits', danger: true })) return false;
  state.editing = null; state.editorDirty = false; $('editor-panel').hidden = true; $('stock-panel').hidden = false; pruneUploads(); renderStock(); return true;
}
async function openEditor(id = null) {
  if (state.editing && !await discardEditor()) return;
  const existing = state.vehicles.find(car => car.id === id);
  state.isNew = !existing;
  state.editing = existing ? clone(existing) : { id: `car-${crypto.randomUUID()}`, make: '', model: '', subtitle: '', body: '', description: '', priceEUR: null, year: null, mileageKm: null, fuel: '', transmission: '', status: 'draft', image: '', images: [], credit: 'Performance Vehicles collection', focus: '50% 50%' };
  state.editing.images = clone(imageList(state.editing));
  const car = state.editing;
  $('car-form').reset();
  for (const [field, key] of [['make', 'make'], ['model', 'model'], ['subtitle', 'subtitle'], ['description', 'description'], ['price', 'priceEUR'], ['year', 'year'], ['mileage', 'mileageKm']]) $(`car-${field}`).value = car[key] ?? '';
  for (const key of ['body', 'fuel', 'transmission']) setSelect(`car-${key}`, car[key] || '');
  $('car-status').value = car.status || 'showcase';
  $('car-price-request').checked = car.priceEUR == null;
  $('car-year').max = String(new Date().getFullYear() + 2);
  updatePriceInput();
  $('editor-heading').textContent = state.isNew ? 'Add a car' : fullName(car);
  $('editor-state').textContent = state.isNew ? 'New listing · draft' : 'Editing saved draft';
  $('delete-car').hidden = state.isNew;
  $('stock-panel').hidden = true; $('editor-panel').hidden = false;
  state.editorDirty = false; showMessage('photo-status', ''); renderPhotos(); updatePreview();
  $('editor-heading').scrollIntoView({ block: 'start', behavior: 'smooth' }); $('car-make').focus({ preventScroll: true });
}
function readEditor() {
  const car = clone(state.editing);
  for (const key of ['make', 'model', 'subtitle', 'body', 'description', 'fuel', 'transmission', 'status']) car[key] = $(`car-${key}`).value.trim();
  car.priceEUR = $('car-price-request').checked || $('car-price').value === '' ? null : Number($('car-price').value);
  car.year = $('car-year').value === '' ? null : Number($('car-year').value);
  car.mileageKm = $('car-mileage').value === '' ? null : Number($('car-mileage').value);
  car.image = car.images[0] || '';
  return car;
}
function updatePriceInput() { $('car-price').disabled = $('car-price-request').checked; $('car-price').required = !$('car-price-request').checked; }
function updatePreview() {
  if (!state.editing) return;
  const car = readEditor(); const photo = $('preview-photo'); photo.replaceChildren();
  if (car.images.length) { const img = node('img'); img.src = imageURL(car.images[0]); img.alt = fullName(car); photo.append(img); } else photo.append(node('span', '', 'Your cover photo'));
  $('preview-make').textContent = car.make || 'MAKE'; $('preview-title').textContent = car.model || 'Your next listing'; $('preview-subtitle').textContent = car.subtitle;
  $('preview-price').textContent = money(car.priceEUR); $('preview-status').textContent = statusName(car.status); $('preview-status').className = `badge badge-${car.status}`;
}
function renderPhotos() {
  const list = $('photo-list'); list.replaceChildren();
  if (!state.editing) return;
  state.editing.images.forEach((path, index) => {
    const tile = node('div', 'photo-tile'); const img = node('img'); img.src = imageURL(path); img.alt = `Vehicle photo ${index + 1}`;
    const top = node('div', 'photo-tile-top'); top.append(node('span', '', index === 0 ? 'COVER PHOTO' : `PHOTO ${index + 1}`));
    if (index > 0) { const cover = node('button', '', 'Make cover'); cover.type = 'button'; cover.addEventListener('click', () => { const [value] = state.editing.images.splice(index, 1); state.editing.images.unshift(value); changedPhotos(); }); top.append(cover); }
    const actions = node('div', 'photo-tile-actions');
    for (const [text, delta, label] of [['←', -1, 'Move photo earlier'], ['→', 1, 'Move photo later']]) { const button = node('button', '', text); button.type = 'button'; button.disabled = index + delta < 0 || index + delta >= state.editing.images.length; button.setAttribute('aria-label', `${label}, photo ${index + 1}`); button.addEventListener('click', () => { [state.editing.images[index], state.editing.images[index + delta]] = [state.editing.images[index + delta], state.editing.images[index]]; changedPhotos(); }); actions.append(button); }
    const remove = node('button', '', 'Remove'); remove.type = 'button'; remove.setAttribute('aria-label', `Remove photo ${index + 1}`); remove.addEventListener('click', () => { state.editing.images.splice(index, 1); changedPhotos(); }); actions.append(remove);
    tile.append(img, top, actions); list.append(tile);
  });
}
function changedPhotos() { state.editorDirty = true; renderPhotos(); updatePreview(); }
async function optimiseImage(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error(`${file.name}: choose a JPEG, PNG or WebP image.`);
  if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name}: the photo is over 10 MB.`);
  let image;
  try { image = await createImageBitmap(file); } catch (_) { throw new Error(`${file.name}: the image could not be opened. Export it as JPEG and try again.`); }
  if (!image.width || !image.height || image.width * image.height > 80000000) { image.close(); throw new Error(`${file.name}: this image is too large to process.`); }
  const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d'); if (!context) { image.close(); throw new Error('Your browser could not prepare this photo.'); }
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height); image.close();
  let quality = .85;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  while (dataUrl.split(',')[1].length * .75 > 2 * 1024 * 1024 && quality > .55) { quality -= .1; dataUrl = canvas.toDataURL('image/jpeg', quality); }
  if (dataUrl.split(',')[1].length * .75 > 2 * 1024 * 1024) throw new Error(`${file.name}: this photo is still too large. Choose a smaller JPEG image.`);
  return { id: crypto.randomUUID(), dataUrl, name: file.name, width: canvas.width, height: canvas.height };
}
async function addPhotos(files) {
  if (!state.editing || state.busy || !files.length) return;
  if (state.editing.images.length + files.length > 30) { showMessage('photo-status', 'A listing can contain up to 30 photos. Remove a photo before adding more.', 'error'); return; }
  lock(true); const errors = [];
  try {
    for (let index = 0; index < files.length; index++) {
      showMessage('photo-status', `Preparing photo ${index + 1} of ${files.length}…`, 'info');
      try { const image = await optimiseImage(files[index]); state.uploads[image.id] = image; state.editing.images.push(`upload:${image.id}`); state.editorDirty = true; }
      catch (error) { errors.push(error.message); }
    }
    renderPhotos(); updatePreview();
    showMessage('photo-status', errors.length ? errors.join(' ') : 'Photos are ready. Save this listing to keep the draft on this device.', errors.length ? 'error' : '');
  } finally { lock(false); $('car-photos').value = ''; }
}
async function saveEditor(event) {
  event.preventDefault(); if (!state.editing || state.busy) return;
  if (!$('car-form').reportValidity()) return;
  const car = readEditor();
  try { validateInventory([car], state.uploads); } catch (error) { showMessage('workspace-message', error.message, 'error'); $('workspace-message').scrollIntoView({ block: 'center' }); return; }
  const index = state.vehicles.findIndex(value => value.id === car.id);
  if (index >= 0) state.vehicles[index] = car; else state.vehicles.unshift(car);
  state.dirty = true; state.editorDirty = false; pruneUploads(); await persist(); await discardEditor({ force: true });
  showMessage('workspace-message', state.storageAvailable ? 'Listing saved as an unpublished draft. Use Publish changes to update the public website.' : 'Your listing is open in this tab, but this browser could not store it. Download a draft backup before leaving.', state.storageAvailable ? 'info' : 'error');
  toast(state.storageAvailable ? 'Listing saved on this device.' : 'Draft storage is unavailable. Download a backup.');
}
async function reloadStock() {
  if (state.busy) return;
  if (!state.client) { requireSignIn(); return; }
  if ((state.dirty || state.editorDirty) && !await confirmAction({ title: 'Replace this draft?', message: 'This device’s draft will be replaced with the current published stock. Download a draft backup first if you want to keep your edits.', confirmLabel: 'Replace draft', danger: true })) return;
  lock(true);
  try {
    const remote = await state.client.load(); seed = clone(remote.vehicles); state.vehicles = clone(remote.vehicles); state.baseVehicles = clone(remote.vehicles); state.baseSha = remote.sha; state.uploads = {}; state.dirty = false; state.conflict = false; state.editorDirty = false;
    await persist(); if (state.editing) await discardEditor({ force: true }); renderStock(); showMessage('workspace-message', state.storageAvailable ? 'Published stock loaded. This workspace is up to date.' : 'Published stock loaded in this tab. Browser draft storage is unavailable, so download a backup before leaving.', state.storageAvailable ? '' : 'error');
  } catch (error) { handleRequestError(error); }
  finally { lock(false); }
}
function backup() {
  if (state.editorDirty) { showMessage('workspace-message', 'Save the listing you are editing before downloading a draft backup.', 'error'); return; }
  const data = JSON.stringify({ format: 'performance-vehicles-draft-v1', savedAt: new Date().toISOString(), vehicles: state.vehicles, uploads: state.uploads }, null, 2);
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' })); const link = node('a'); link.href = url; link.download = `performance-vehicles-draft-${new Date().toISOString().slice(0, 10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Draft backup downloaded.');
}
async function restoreBackup(event) {
  const file = event.target.files?.[0];
  if (!file || state.busy || !state.client) return;
  try {
    if (state.editorDirty) throw new Error('Save the listing you are editing before restoring a draft backup.');
    if (file.size > 25 * 1024 * 1024) throw new Error('This backup is over 25 MB. Use a smaller backup or ask the site owner for help restoring it.');
    let value;
    try { value = JSON.parse(await file.text()); } catch (_) { throw new Error('This file is not a readable draft backup. Choose the JSON file downloaded from stock management.'); }
    if (value?.format !== 'performance-vehicles-draft-v1' || !Array.isArray(value.vehicles) || !value.uploads || typeof value.uploads !== 'object' || Array.isArray(value.uploads)) throw new Error('Choose a Performance Vehicles draft backup file.');
    validateInventory(value.vehicles, value.uploads);
    if (!await confirmAction({ title: 'Restore this draft?', message: `${value.vehicles.length} listings from the backup will replace this device’s draft. The public website changes only after you publish.`, confirmLabel: 'Restore draft', cancelLabel: 'Keep current draft' })) return;
    state.vehicles = clone(value.vehicles); state.uploads = clone(value.uploads); state.dirty = true; state.conflict = false; state.editorDirty = false;
    pruneUploads(); await persist(); if (state.editing) await discardEditor({ force: true }); renderStock();
    showMessage('workspace-message', state.storageAvailable ? 'Draft backup restored on this device. Review the listings before publishing.' : 'The backup was restored in this tab, but browser storage is unavailable. Keep your original backup file.', state.storageAvailable ? 'info' : 'error');
  } catch (error) { showMessage('workspace-message', error.message || 'The draft backup could not be restored.', 'error'); }
  finally { event.target.value = ''; }
}
function validatePublishSize() {
  const ids = [...new Set(state.vehicles.flatMap(car => imageList(car)).filter(path => path.startsWith('upload:')).map(path => path.slice(7)))];
  if (ids.length > 30) throw new Error('Publish photos in smaller batches. One update can include up to 30 new photographs.');
  const uploads = Object.fromEntries(ids.map(id => [id, state.uploads[id]]));
  const size = new TextEncoder().encode(JSON.stringify({ vehicles: state.vehicles, uploads, expectedSha: state.baseSha })).byteLength;
  if (size > 24 * 1024 * 1024) throw new Error('This update is too large to publish at once. Add or replace photographs in smaller batches.');
}
function requestPublish() {
  if (!state.client) { requireSignIn(); return; }
  if (!state.dirty || state.busy || state.conflict || !state.publishingReady) return;
  if (state.editorDirty) { showMessage('workspace-message', 'Save the listing you are editing before publishing the stock update.', 'error'); return; }
  try { validateInventory(state.vehicles, state.uploads); validatePublishSize(); } catch (error) { showMessage('workspace-message', error.message, 'error'); return; }
  const publicCars = state.vehicles.filter(car => car.status !== 'draft').length;
  const photos = new Set(state.vehicles.flatMap(car => imageList(car)).filter(path => path.startsWith('upload:'))).size;
  $('publish-summary').textContent = `${publicCars} ${publicCars === 1 ? 'listing will' : 'listings will'} be visible on the website. ${state.vehicles.length - publicCars} draft ${state.vehicles.length - publicCars === 1 ? 'listing stays' : 'listings stay'} hidden. ${photos} new ${photos === 1 ? 'photo' : 'photos'} will be uploaded.`;
  showMessage('publish-progress', ''); $('publish-dialog').showModal();
}
async function publish() {
  if (state.busy || !state.client || !state.publishingReady || state.conflict || !state.dirty) return;
  lock(true);
  try {
    const result = await state.client.publish({ vehicles: state.vehicles, uploads: state.uploads, expectedSha: state.baseSha });
    state.vehicles = clone(result.vehicles); state.baseVehicles = clone(result.vehicles); state.baseSha = result.sha; state.uploads = {}; state.dirty = false; state.conflict = false; state.editorDirty = false; await persist();
    if (state.editing) await discardEditor({ force: true }); renderStock(); $('publish-dialog').close();
    showMessage('workspace-message', 'Stock saved. The public website is being updated and may take a few minutes to show the changes.');
    const link = node('a', '', ' View public website ↗'); link.href = result.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; $('workspace-message').append(link); toast('Stock update saved.');
  } catch (error) {
    if (error.code === 'CONFLICT' || error.code === 'VERIFY') state.conflict = true;
    if (error.status === 503) state.publishingReady = false;
    showMessage('publish-progress', error.message || 'The update could not be published. Your draft is still on this device.', 'error');
    handleRequestError(error);
  } finally { lock(false); }
}

$('session-retry').addEventListener('click', bootstrap);
$('new-car').addEventListener('click', () => openEditor());
$('editor-back').addEventListener('click', () => discardEditor()); $('cancel-editor').addEventListener('click', () => discardEditor());
$('stock-nav').addEventListener('click', async () => { if (!state.editing || await discardEditor()) $('stock-panel').hidden = false; });
$('car-form').addEventListener('submit', saveEditor);
$('car-form').addEventListener('input', event => { if (!state.editing || event.target.type === 'file') return; state.editorDirty = true; if (event.target.id === 'car-price-request') updatePriceInput(); updatePreview(); });
$('car-form').addEventListener('change', event => { if (!state.editing || event.target.type === 'file') return; state.editorDirty = true; if (event.target.id === 'car-price-request') updatePriceInput(); updatePreview(); });
$('car-photos').addEventListener('change', event => addPhotos([...event.target.files]));
for (const name of ['dragenter', 'dragover']) $('photo-drop').addEventListener(name, event => { event.preventDefault(); $('photo-drop').classList.add('is-over'); });
for (const name of ['dragleave', 'drop']) $('photo-drop').addEventListener(name, event => { event.preventDefault(); $('photo-drop').classList.remove('is-over'); });
$('photo-drop').addEventListener('drop', event => addPhotos([...event.dataTransfer.files]));
$('stock-query').addEventListener('input', renderStock); $('stock-status').addEventListener('change', renderStock);
$('reload-stock').addEventListener('click', reloadStock); $('download-backup').addEventListener('click', backup);
$('restore-backup').addEventListener('change', restoreBackup);
$('delete-car').addEventListener('click', async () => {
  if (!state.editing || state.busy || !await confirmAction({ title: 'Delete this listing?', message: `${fullName(state.editing)} will be removed from this draft. The public website changes only after you publish.`, confirmLabel: 'Delete listing', cancelLabel: 'Keep listing', danger: true })) return;
  state.vehicles = state.vehicles.filter(car => car.id !== state.editing.id); state.dirty = true; state.editorDirty = false; pruneUploads(); await persist(); await discardEditor({ force: true }); toast('Listing removed from this device’s draft.');
});
$('publish-button').addEventListener('click', requestPublish); $('confirm-publish').addEventListener('click', publish);
for (const id of ['close-publish', 'cancel-publish']) $(id).addEventListener('click', () => $('publish-dialog').close());
for (const id of ['publish-dialog']) $(id).addEventListener('cancel', event => { if (state.busy) event.preventDefault(); });
$('decision-confirm').addEventListener('click', () => resolveDecision(true));
for (const id of ['decision-cancel', 'close-decision']) $(id).addEventListener('click', () => resolveDecision(false));
$('decision-dialog').addEventListener('cancel', event => { event.preventDefault(); resolveDecision(false); });
$('decision-dialog').addEventListener('close', () => { if (decisionResolve) resolveDecision(false); });
window.addEventListener('beforeunload', event => { if (state.editorDirty || state.busy) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', () => { state.client = null; state.user = null; });
window.addEventListener('pageshow', event => { if (event.persisted) bootstrap(); });

await bootstrap();
