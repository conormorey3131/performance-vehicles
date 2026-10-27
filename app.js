(() => {
  'use strict';

  function initialize() {
    const vehicles = Array.isArray(window.VEHICLES) ? window.VEHICLES : [];
    const byId = new Map(vehicles.map(vehicle => [String(vehicle.id), vehicle]));
    const $ = id => document.getElementById(id);
    const grid = $('vehicle-grid');
    const search = $('stock-search');
    const makeFilter = $('make-filter');
    const bodyFilter = $('body-filter');
    const keywordFilter = $('keyword-filter');
    const sortFilter = $('sort-filter');
    const savedFilter = $('saved-filter');
    const detailDialog = $('vehicle-dialog');
    const enquiryDialog = $('enquiry-dialog');
    const enquiryCar = $('enquiry-car');
    const placeholderEmail = 'sales@performancevehicles.ie';
    let saved = new Set();
    let savedOnly = false;
    let selectedVehicle = null;
    let imageIndex = 0;
    let lastTrigger = null;

    try {
      const stored = JSON.parse(localStorage.getItem('performance-vehicles-saved') || '[]');
      if (Array.isArray(stored)) saved = new Set(stored.filter(id => byId.has(String(id))).map(String));
    } catch (_) { /* Browsers may disable local storage. */ }

    const icons = {
      heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/></svg>',
      arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 12h15M13 5l7 7-7 7"/></svg>',
      left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>',
      right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>'
    };

    function element(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text != null) node.textContent = text;
      return node;
    }

    function fullName(vehicle) {
      return `${vehicle.make || ''} ${vehicle.model || ''}`.trim();
    }

    function imageList(vehicle) {
      const images = Array.isArray(vehicle.images) ? vehicle.images.filter(Boolean) : [];
      return images.length ? images : [vehicle.image].filter(Boolean);
    }

    function updateSaveCount() {
      const count = $('saved-count');
      if (count) count.textContent = String(saved.size);
      if (savedFilter) {
        savedFilter.setAttribute('aria-pressed', String(savedOnly));
        savedFilter.classList.toggle('is-active', savedOnly);
        savedFilter.setAttribute('aria-label', `Saved cars, ${saved.size} saved${savedOnly ? ', filter active' : ''}`);
      }
    }

    function toggleSaved(id) {
      saved.has(id) ? saved.delete(id) : saved.add(id);
      try { localStorage.setItem('performance-vehicles-saved', JSON.stringify([...saved])); } catch (_) {}
      renderCatalogue();
      const buttons = [...(grid?.querySelectorAll('.vehicle-save') || [])];
      const nextFocus = buttons.find(button => button.dataset.vehicleId === id) || buttons[0] || savedFilter;
      nextFocus?.focus({ preventScroll: true });
    }

    function createCard(vehicle, index) {
      const id = String(vehicle.id);
      const card = element('article', 'vehicle-card');
      card.style.setProperty('--card-order', String(index));
      const imageWrap = element('div', 'vehicle-image-wrap');
      const imageButton = element('button', 'vehicle-image-link');
      imageButton.type = 'button';
      imageButton.setAttribute('aria-label', `View ${fullName(vehicle)}`);
      const image = element('img', 'vehicle-image');
      image.src = vehicle.image || imageList(vehicle)[0] || '';
      image.alt = fullName(vehicle);
      image.style.objectPosition = vehicle.focus || '50% 60%';
      image.loading = 'lazy';
      image.decoding = 'async';
      imageButton.append(image);
      imageButton.addEventListener('click', event => openDetail(vehicle, event.currentTarget));
      const save = element('button', 'vehicle-save');
      save.type = 'button';
      save.dataset.vehicleId = id;
      save.innerHTML = icons.heart;
      save.classList.toggle('is-saved', saved.has(id));
      save.setAttribute('aria-pressed', String(saved.has(id)));
      save.setAttribute('aria-label', `${saved.has(id) ? 'Unsave' : 'Save'} ${fullName(vehicle)}`);
      save.addEventListener('click', () => toggleSaved(id));
      imageWrap.append(imageButton, save);
      const body = element('div', 'vehicle-body');
      body.append(element('p', 'vehicle-eyebrow', vehicle.make), element('h3', 'vehicle-title', vehicle.model));
      body.append(element('p', 'vehicle-subtitle', vehicle.subtitle || vehicle.body || 'Performance collection'));
      const footer = element('div', 'vehicle-card-footer');
      footer.append(element('span', 'vehicle-price', 'Enquire for details'));
      const details = element('button', 'vehicle-detail-link', 'View car');
      details.type = 'button';
      details.insertAdjacentHTML('beforeend', icons.arrow);
      details.setAttribute('aria-label', `View details for ${fullName(vehicle)}`);
      details.addEventListener('click', event => openDetail(vehicle, event.currentTarget));
      footer.append(details);
      body.append(footer);
      card.append(imageWrap, body);
      return card;
    }

    function filteredVehicles() {
      const keyword = (keywordFilter?.value || '').trim().toLocaleLowerCase();
      const make = makeFilter?.value || '';
      const body = bodyFilter?.value || '';
      let result = vehicles.filter(vehicle => {
        const words = [vehicle.make, vehicle.model, vehicle.subtitle, vehicle.body].filter(Boolean).join(' ').toLocaleLowerCase();
        return (!make || vehicle.make === make) && (!body || vehicle.body === body) && (!keyword || words.includes(keyword)) && (!savedOnly || saved.has(String(vehicle.id)));
      });
      if (sortFilter?.value === 'make') result = [...result].sort((a, b) => fullName(a).localeCompare(fullName(b)));
      return result;
    }

    function renderCatalogue() {
      if (!grid) return;
      const results = filteredVehicles();
      grid.replaceChildren(...results.map(createCard));
      if (!results.length) {
        const empty = element('div', 'catalogue-empty');
        empty.append(element('h3', '', savedOnly ? 'Your shortlist starts here.' : 'No cars match your search.'));
        empty.append(element('p', '', savedOnly ? 'Tap the heart on a car to save it to your shortlist.' : 'Try another make or clear your filters to explore the full collection.'));
        const reset = element('button', 'button button-outline', 'Explore all cars');
        reset.type = 'button';
        reset.addEventListener('click', resetFilters);
        empty.append(reset);
        grid.append(empty);
      }
      const count = $('result-count');
      if (count) count.textContent = `${results.length} ${results.length === 1 ? 'car' : 'cars'}${savedOnly ? ' in your shortlist' : ' in the collection'}`;
      updateSaveCount();
    }

    function resetFilters() {
      if (makeFilter) makeFilter.value = '';
      if (bodyFilter) bodyFilter.value = '';
      if (keywordFilter) keywordFilter.value = '';
      if (sortFilter) sortFilter.value = 'featured';
      savedOnly = false;
      renderCatalogue();
    }

    function populateSelect(select, values, initialLabel) {
      if (!select) return;
      select.replaceChildren(new Option(initialLabel, ''), ...values.map(value => new Option(value, value)));
    }

    populateSelect(makeFilter, [...new Set(vehicles.map(vehicle => vehicle.make).filter(Boolean))].sort(), 'All makes');
    populateSelect(bodyFilter, [...new Set(vehicles.map(vehicle => vehicle.body).filter(Boolean))].sort(), 'All body types');
    populateSelect(enquiryCar, vehicles.map(fullName), 'A general enquiry');
    if (enquiryCar) vehicles.forEach((vehicle, index) => { enquiryCar.options[index + 1].value = String(vehicle.id); });

    search?.addEventListener('submit', event => {
      event.preventDefault();
      renderCatalogue();
      $('collection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    [makeFilter, bodyFilter, sortFilter].forEach(filter => filter?.addEventListener('change', renderCatalogue));
    keywordFilter?.addEventListener('input', renderCatalogue);
    $('reset-filters')?.addEventListener('click', resetFilters);
    savedFilter?.addEventListener('click', () => {
      savedOnly = !savedOnly;
      renderCatalogue();
      $('collection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    $('view-all')?.addEventListener('click', event => {
      event.preventDefault();
      resetFilters();
      $('collection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    function openDialog(dialog, trigger) {
      if (!dialog) return;
      lastTrigger = trigger || document.activeElement;
      dialog.showModal();
      document.body.classList.add('dialog-open');
    }

    function closeDialog(dialog) {
      if (dialog?.open) dialog.close();
    }

    [detailDialog, enquiryDialog].forEach(dialog => {
      if (!dialog) return;
      dialog.addEventListener('click', event => {
        if (event.target === dialog) {
          const bounds = dialog.getBoundingClientRect();
          if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDialog(dialog);
        }
      });
      dialog.addEventListener('close', () => {
        if (!detailDialog?.open && !enquiryDialog?.open) {
          document.body.classList.remove('dialog-open');
          if (lastTrigger?.isConnected) lastTrigger.focus();
        }
      });
    });
    $('close-detail')?.addEventListener('click', () => closeDialog(detailDialog));
    $('close-enquiry')?.addEventListener('click', () => closeDialog(enquiryDialog));

    function selectImage(nextIndex) {
      if (!selectedVehicle) return;
      const images = imageList(selectedVehicle);
      imageIndex = (nextIndex + images.length) % images.length;
      const main = $('detail-main-image');
      if (main) {
        main.src = images[imageIndex];
        main.alt = `${fullName(selectedVehicle)} — photo ${imageIndex + 1} of ${images.length}`;
      }
      const count = $('gallery-count');
      if (count) count.textContent = `${String(imageIndex + 1).padStart(2, '0')} / ${String(images.length).padStart(2, '0')}`;
      document.querySelectorAll('.gallery-thumbnail').forEach((button, index) => {
        button.classList.toggle('is-active', index === imageIndex);
        button.setAttribute('aria-pressed', String(index === imageIndex));
      });
    }

    function openDetail(vehicle, trigger) {
      if (!detailDialog || !$('vehicle-detail')) return;
      selectedVehicle = vehicle;
      imageIndex = 0;
      const images = imageList(vehicle);
      const gallery = element('div', 'detail-gallery');
      const mainWrap = element('div', 'detail-main-image-wrap');
      const main = element('img', 'detail-main-image');
      main.id = 'detail-main-image';
      main.src = images[0] || '';
      main.alt = fullName(vehicle);
      mainWrap.append(main);
      if (images.length > 1) {
        [['Previous photo', -1, 'left'], ['Next photo', 1, 'right']].forEach(([label, delta, icon]) => {
          const control = element('button', `gallery-arrow gallery-arrow-${icon}`);
          control.type = 'button';
          control.setAttribute('aria-label', label);
          control.innerHTML = icons[icon];
          control.addEventListener('click', () => selectImage(imageIndex + delta));
          mainWrap.append(control);
        });
      }
      const imageCount = element('span', 'gallery-count');
      imageCount.id = 'gallery-count';
      imageCount.setAttribute('aria-live', 'polite');
      mainWrap.append(imageCount);
      gallery.append(mainWrap);
      if (images.length > 1) {
        const thumbnails = element('div', 'gallery-thumbnails');
        thumbnails.setAttribute('aria-label', 'Vehicle photographs');
        images.forEach((src, index) => {
          const thumb = element('button', 'gallery-thumbnail');
          thumb.type = 'button';
          thumb.setAttribute('aria-label', `Show photo ${index + 1}`);
          const thumbImage = element('img');
          thumbImage.src = src;
          thumbImage.alt = '';
          thumbImage.loading = 'lazy';
          thumb.append(thumbImage);
          thumb.addEventListener('click', () => selectImage(index));
          thumbnails.append(thumb);
        });
        gallery.append(thumbnails);
      }
      const copy = element('div', 'detail-copy');
      copy.append(element('p', 'detail-eyebrow', vehicle.make));
      const title = element('h2', 'detail-title', vehicle.model);
      title.id = 'detail-title';
      copy.append(title);
      copy.append(element('p', 'vehicle-subtitle', vehicle.subtitle || ''));
      copy.append(element('p', 'detail-description', vehicle.description || 'Explore the photographs, save this car to your shortlist, or get in touch to discuss your next car.'));
      const facts = element('dl', 'detail-facts');
      [['Make', vehicle.make], ['Body', vehicle.body]].forEach(([label, value]) => {
        if (!value) return;
        const pair = element('div');
        pair.append(element('dt', '', label), element('dd', '', value));
        facts.append(pair);
      });
      copy.append(facts);
      copy.append(element('p', 'detail-notice', 'Photography showcase — availability and specification to be confirmed.'));
      const actions = element('div', 'detail-actions');
      const enquire = element('button', 'button button-primary', 'Enquire about this car');
      enquire.type = 'button';
      enquire.insertAdjacentHTML('beforeend', icons.arrow);
      enquire.addEventListener('click', () => {
        closeDialog(detailDialog);
        openEnquiry(String(vehicle.id), trigger);
      });
      const source = element('p', 'detail-source-link', vehicle.credit || 'Performance Vehicles collection');
      actions.append(enquire, source);
      copy.append(actions);
      $('vehicle-detail').replaceChildren(gallery, copy);
      detailDialog.setAttribute('aria-labelledby', 'detail-title');
      selectImage(0);
      openDialog(detailDialog, trigger);
    }

    detailDialog?.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        selectImage(imageIndex + (event.key === 'ArrowRight' ? 1 : -1));
      }
    });

    function enquiryText() {
      const vehicle = byId.get(enquiryCar?.value || '');
      const name = $('enquiry-name')?.value.trim() || '';
      const message = $('enquiry-message')?.value.trim() || '';
      const greeting = name ? `Hi, I'm ${name}.` : 'Hi Performance Vehicles,';
      const interest = vehicle ? `I'm interested in the ${fullName(vehicle)} featured on your website. Could you let me know the availability and details?` : "I'd like to discuss finding my next car.";
      return [greeting, interest, message].filter(Boolean).join('\n\n');
    }

    function updateEnquiry() {
      const preview = $('enquiry-preview');
      if (preview) preview.textContent = enquiryText();
      const emailLink = $('email-enquiry');
      const vehicle = byId.get(enquiryCar?.value || '');
      const subject = vehicle ? `Vehicle enquiry: ${fullName(vehicle)}` : 'Vehicle enquiry';
      if (emailLink) emailLink.href = `mailto:${placeholderEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(enquiryText())}`;
      const status = $('copy-status');
      if (status) status.textContent = '';
      const button = $('copy-enquiry');
      if (button) button.textContent = 'Copy enquiry';
    }

    function openEnquiry(id, trigger) {
      if (enquiryCar) enquiryCar.value = byId.has(id) ? id : '';
      updateEnquiry();
      openDialog(enquiryDialog, trigger);
    }

    document.addEventListener('click', event => {
      const trigger = event.target.closest('[data-enquiry]');
      if (!trigger) return;
      event.preventDefault();
      openEnquiry(trigger.dataset.enquiry || '', trigger);
    });
    $('enquiry-form')?.addEventListener('submit', event => event.preventDefault());
    [enquiryCar, $('enquiry-name'), $('enquiry-message')].forEach(input => {
      input?.addEventListener('input', updateEnquiry);
      input?.addEventListener('change', updateEnquiry);
    });
    $('copy-enquiry')?.addEventListener('click', async () => {
      const status = $('copy-status');
      try {
        await navigator.clipboard.writeText(enquiryText());
        $('copy-enquiry').textContent = 'Enquiry copied';
        if (status) status.textContent = 'Copied. You can paste your enquiry into an email. The contact address is a placeholder for now.';
      } catch (_) {
        if (status) status.textContent = 'Please select and copy the enquiry text below, then paste it into your email.';
        const preview = $('enquiry-preview');
        if (preview) {
          const range = document.createRange();
          range.selectNodeContents(preview);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
    });

    const menuToggle = $('menu-toggle');
    const mainNav = $('main-nav');
    function closeMenu() {
      menuToggle?.setAttribute('aria-expanded', 'false');
      menuToggle?.setAttribute('aria-label', 'Open navigation');
      mainNav?.classList.remove('is-open');
      document.body.classList.remove('menu-open');
    }
    menuToggle?.addEventListener('click', () => {
      const opening = menuToggle.getAttribute('aria-expanded') !== 'true';
      menuToggle.setAttribute('aria-expanded', String(opening));
      menuToggle.setAttribute('aria-label', opening ? 'Close navigation' : 'Open navigation');
      mainNav?.classList.toggle('is-open', opening);
      document.body.classList.toggle('menu-open', opening);
    });
    mainNav?.querySelectorAll('a, button').forEach(link => link.addEventListener('click', closeMenu));
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && menuToggle?.getAttribute('aria-expanded') === 'true') {
        closeMenu();
        menuToggle.focus();
      }
    });
    const header = $('site-header');
    if (header) {
      const updateHeader = () => header.classList.toggle('is-scrolled', window.scrollY > 25);
      window.addEventListener('scroll', updateHeader, { passive: true });
      updateHeader();
    }

    renderCatalogue();
    updateEnquiry();
    document.documentElement.classList.add('site-ready');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
