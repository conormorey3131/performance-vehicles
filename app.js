(() => {
  'use strict';

  function initialize() {
    const vehicles = (Array.isArray(window.VEHICLES) ? window.VEHICLES : []).filter(vehicle => vehicle && vehicle.status !== 'draft');
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
    let galleryImmersive = false;
    let galleryZoomed = false;
    let galleryGridOpen = false;
    let slideshowTimer = null;
    let galleryReturnFocus = null;
    let similarInterest = null;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const enquiryVehicles = vehicles.filter(vehicle => vehicle.status !== 'sold');
    const numberFormat = new Intl.NumberFormat('en-IE');
    const priceFormat = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

    try {
      const stored = JSON.parse(localStorage.getItem('performance-vehicles-saved') || '[]');
      if (Array.isArray(stored)) saved = new Set(stored.filter(id => byId.has(String(id))).map(String));
    } catch (_) { /* Browsers may disable local storage. */ }

    const icons = {
      heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/></svg>',
      arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 12h15M13 5l7 7-7 7"/></svg>',
      left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>',
      right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>',
      expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/></svg>',
      zoom: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5M7.5 10.5h6M10.5 7.5v6"/></svg>',
      unzoom: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5M7.5 10.5h6"/></svg>',
      play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m8 4 12 8-12 8Z"/></svg>',
      pause: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M8 4v16M16 4v16"/></svg>',
      grid: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="5" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="12" cy="19" r="2"/><circle cx="19" cy="19" r="2"/></svg>'
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

    function safeImageURL(value) {
      if (typeof value !== 'string' || !value.trim() || /[\\\u0000-\u001f]/.test(value)) return '';
      const source = value.trim();
      try {
        const url = new URL(source, window.location.href);
        if (/^https:\/\//i.test(source) && !url.username && !url.password) return url.href;
        const base = new URL('./', window.location.href);
        if (/^(?:\.\/)?assets\//.test(source) && url.origin === base.origin && url.pathname.startsWith(`${base.pathname}assets/`)) return source;
      } catch (_) {}
      return '';
    }

    function imageList(vehicle) {
      const images = Array.isArray(vehicle.images) ? vehicle.images.map(safeImageURL).filter(Boolean) : [];
      return [...new Set(images.length ? images : [safeImageURL(vehicle.image)].filter(Boolean))];
    }

    function numericValue(value) {
      if (value == null || value === '' || !['number', 'string'].includes(typeof value)) return null;
      const numeric = Number(value);
      return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
    }

    function vehiclePrice(vehicle) {
      const value = vehicle.priceEUR !== undefined ? vehicle.priceEUR : vehicle.price;
      const numeric = numericValue(value);
      return numeric !== null ? priceFormat.format(numeric) : (value !== undefined ? 'Price on request' : 'Enquire for details');
    }

    function statusLabel(vehicle) {
      return ({ available: 'Available', reserved: 'Reserved', sold: 'Sold', showcase: 'Collection showcase' })[vehicle.status] || '';
    }

    function scrollToCollection() {
      $('collection')?.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
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
      const imageSource = safeImageURL(vehicle.image) || imageList(vehicle)[0];
      const image = element(imageSource ? 'img' : 'span', imageSource ? 'vehicle-image' : 'vehicle-image-placeholder', imageSource ? null : 'Photography coming soon');
      if (imageSource) image.src = imageSource;
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
      if (['sold', 'reserved'].includes(vehicle.status)) imageWrap.append(element('span', `vehicle-status-ribbon status-${vehicle.status}`, statusLabel(vehicle)));
      const body = element('div', 'vehicle-body');
      body.append(element('p', 'vehicle-eyebrow', vehicle.make), element('h3', 'vehicle-title', vehicle.model));
      if (numericValue(vehicle.year)) body.querySelector('.vehicle-title').prepend(element('span', 'vehicle-year', `${vehicle.year} `));
      body.append(element('p', 'vehicle-subtitle', vehicle.subtitle || vehicle.body || 'Performance collection'));
      const footer = element('div', 'vehicle-card-footer');
      const price = element('span', 'vehicle-price', vehiclePrice(vehicle));
      if (numericValue(vehicle.priceEUR ?? vehicle.price) !== null) price.classList.add('has-price');
      footer.append(price);
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
    populateSelect(enquiryCar, enquiryVehicles.map(fullName), 'A general enquiry');
    if (enquiryCar) enquiryVehicles.forEach((vehicle, index) => { enquiryCar.options[index + 1].value = String(vehicle.id); });

    search?.addEventListener('submit', event => {
      event.preventDefault();
      renderCatalogue();
      scrollToCollection();
    });
    [makeFilter, bodyFilter, sortFilter].forEach(filter => filter?.addEventListener('change', renderCatalogue));
    keywordFilter?.addEventListener('input', renderCatalogue);
    $('reset-filters')?.addEventListener('click', resetFilters);
    savedFilter?.addEventListener('click', () => {
      savedOnly = !savedOnly;
      renderCatalogue();
      scrollToCollection();
    });
    $('view-all')?.addEventListener('click', event => {
      event.preventDefault();
      resetFilters();
      scrollToCollection();
    });

    function openDialog(dialog, trigger) {
      if (!dialog) return;
      lastTrigger = trigger || document.activeElement;
      if (!dialog.open) dialog.showModal();
      document.body.classList.add('dialog-open');
    }

    function closeDialog(dialog) {
      if (dialog === detailDialog) stopSlideshow();
      if (dialog?.open) dialog.close();
    }

    function setControl(button, icon, label, pressed) {
      if (!button) return;
      button.innerHTML = icons[icon];
      button.setAttribute('aria-label', label);
      button.title = label;
      if (pressed != null) button.setAttribute('aria-pressed', String(pressed));
    }

    function galleryControl(id, icon, label, callback) {
      const button = element('button', 'gallery-tool');
      button.id = id;
      button.type = 'button';
      setControl(button, icon, label, false);
      button.addEventListener('click', callback);
      return button;
    }

    function stopSlideshow() {
      if (slideshowTimer) window.clearInterval(slideshowTimer);
      slideshowTimer = null;
      setControl($('gallery-play'), 'play', 'Start slideshow', false);
    }

    function startSlideshow() {
      if (!selectedVehicle || imageList(selectedVehicle).length < 2 || reducedMotion.matches || document.hidden) return;
      setGalleryGrid(false, false);
      setGalleryZoom(false);
      slideshowTimer = window.setInterval(() => selectImage(imageIndex + 1, true), 4000);
      setControl($('gallery-play'), 'pause', 'Pause slideshow', true);
    }

    function setGalleryZoom(zoomed) {
      galleryZoomed = Boolean(zoomed);
      if (galleryZoomed) stopSlideshow();
      detailDialog?.classList.toggle('gallery-zoomed', galleryZoomed);
      setControl($('gallery-zoom'), galleryZoomed ? 'unzoom' : 'zoom', galleryZoomed ? 'Zoom out' : 'Zoom in', galleryZoomed);
      const imageButton = $('gallery-image-button');
      if (imageButton) imageButton.setAttribute('aria-label', galleryImmersive ? (galleryZoomed ? 'Zoom out of photo' : 'Zoom in on photo') : 'Open full screen photo gallery');
      const stage = $('gallery-stage');
      if (stage) {
        stage.scrollLeft = 0;
        stage.scrollTop = 0;
      }
    }

    function setGalleryGrid(open, restoreFocus = true) {
      if (open && !galleryImmersive) setImmersive(true, $('gallery-grid-toggle'));
      galleryGridOpen = Boolean(open);
      if (galleryGridOpen) {
        stopSlideshow();
        setGalleryZoom(false);
      }
      detailDialog?.classList.toggle('gallery-grid-open', galleryGridOpen);
      const photoGrid = $('gallery-grid');
      const stage = $('gallery-stage');
      if (photoGrid) photoGrid.hidden = !galleryGridOpen;
      if (stage) stage.hidden = galleryGridOpen;
      const toggle = $('gallery-grid-toggle');
      setControl(toggle, 'grid', galleryGridOpen ? 'Return to current photo' : 'Show all photos', galleryGridOpen);
      toggle?.setAttribute('aria-expanded', String(galleryGridOpen));
      if (restoreFocus) {
        if (galleryGridOpen) photoGrid?.querySelector('.is-active')?.focus();
        else toggle?.focus();
      }
    }

    function setImmersive(immersive, trigger) {
      if (!detailDialog) return;
      if (immersive && !galleryImmersive) galleryReturnFocus = trigger || document.activeElement;
      galleryImmersive = Boolean(immersive);
      detailDialog.classList.toggle('gallery-immersive', galleryImmersive);
      if (!galleryImmersive) {
        stopSlideshow();
        setGalleryGrid(false, false);
        setGalleryZoom(false);
      }
      const close = $('close-detail');
      if (close) {
        close.setAttribute('aria-label', galleryImmersive ? 'Exit full screen gallery' : 'Close vehicle details');
        close.title = galleryImmersive ? 'Exit full screen gallery' : 'Close vehicle details';
      }
      const imageButton = $('gallery-image-button');
      if (imageButton) imageButton.setAttribute('aria-label', galleryImmersive ? 'Zoom in on photo' : 'Open full screen photo gallery');
      const hint = detailDialog.querySelector('.gallery-hint');
      if (hint) hint.textContent = galleryImmersive ? (imageList(selectedVehicle || {}).length > 1 ? 'Swipe to explore' : 'Use the controls to explore') : (imageList(selectedVehicle || {}).length > 1 ? 'Swipe to explore · Tap for full screen' : 'Tap for full screen');
      if (galleryImmersive) {
        detailDialog.scrollTop = 0;
        $('gallery-zoom')?.focus({ preventScroll: true });
      } else if (galleryReturnFocus?.isConnected) galleryReturnFocus.focus({ preventScroll: true });
    }

    function resetGalleryState() {
      stopSlideshow();
      galleryImmersive = false;
      galleryZoomed = false;
      galleryGridOpen = false;
      detailDialog?.classList.remove('gallery-immersive', 'gallery-zoomed', 'gallery-grid-open');
      const close = $('close-detail');
      if (close) {
        close.setAttribute('aria-label', 'Close vehicle details');
        close.title = 'Close vehicle details';
      }
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
        if (dialog === detailDialog) resetGalleryState();
        if (!detailDialog?.open && !enquiryDialog?.open) {
          document.body.classList.remove('dialog-open');
          if (lastTrigger?.isConnected) lastTrigger.focus();
        }
      });
    });
    detailDialog?.classList.add('vehicle-viewer');
    $('vehicle-detail')?.classList.add('vehicle-viewer-content');
    $('close-detail')?.addEventListener('click', () => {
      if (galleryImmersive) setImmersive(false);
      else closeDialog(detailDialog);
    });
    detailDialog?.addEventListener('cancel', event => {
      if (galleryImmersive) {
        event.preventDefault();
        setImmersive(false);
      }
    });
    $('close-enquiry')?.addEventListener('click', () => closeDialog(enquiryDialog));
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopSlideshow(); });
    reducedMotion.addEventListener('change', () => {
      if (reducedMotion.matches) stopSlideshow();
      const play = $('gallery-play');
      if (play) play.disabled = reducedMotion.matches || imageList(selectedVehicle || {}).length < 2;
    });

    function selectImage(nextIndex, automatic = false) {
      if (!selectedVehicle) return;
      const images = imageList(selectedVehicle);
      if (!images.length) return;
      if (!automatic) stopSlideshow();
      imageIndex = (nextIndex + images.length) % images.length;
      setGalleryZoom(false);
      const main = $('detail-main-image');
      if (main) {
        main.src = images[imageIndex];
        main.alt = `${fullName(selectedVehicle)} — photo ${imageIndex + 1} of ${images.length}`;
      }
      const count = $('gallery-count');
      if (count) count.textContent = `${imageIndex + 1} / ${images.length}`;
      detailDialog?.querySelectorAll('.gallery-thumbnail, .gallery-grid-item').forEach(button => {
        const active = Number(button.dataset.photoIndex) === imageIndex;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
        if (active) button.setAttribute('aria-current', 'true');
        else button.removeAttribute('aria-current');
      });
      const thumbnails = $('gallery-thumbnails');
      const activeThumbnail = thumbnails?.querySelector('.is-active');
      if (thumbnails && activeThumbnail && detailDialog?.open) {
        thumbnails.scrollTo({ left: activeThumbnail.offsetLeft - thumbnails.offsetLeft - (thumbnails.clientWidth - activeThumbnail.clientWidth) / 2, behavior: reducedMotion.matches || automatic ? 'auto' : 'smooth' });
      }
    }

    function installSwipe(stage, imageButton) {
      let gesture = null;
      let suppressNextImageClick = false;
      const activePointers = new Set();
      stage.addEventListener('pointerdown', event => {
        suppressNextImageClick = false;
        activePointers.add(event.pointerId);
        const button = event.target.closest('button');
        if (activePointers.size > 1 || galleryZoomed || galleryGridOpen || (button && button !== imageButton) || (event.pointerType === 'mouse' && event.button !== 0)) {
          gesture = null;
          return;
        }
        gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, time: Date.now() };
      });
      stage.addEventListener('pointerup', event => {
        activePointers.delete(event.pointerId);
        if (!gesture || gesture.id !== event.pointerId) return;
        const deltaX = event.clientX - gesture.x;
        const deltaY = event.clientY - gesture.y;
        const elapsed = Date.now() - gesture.time;
        gesture = null;
        if (Math.abs(deltaX) > 45 && Math.abs(deltaX) > Math.abs(deltaY) * 1.3 && elapsed < 1500) {
          suppressNextImageClick = true;
          event.preventDefault();
          selectImage(imageIndex + (deltaX < 0 ? 1 : -1));
        }
      });
      ['pointercancel', 'pointerleave'].forEach(type => stage.addEventListener(type, event => {
        activePointers.delete(event.pointerId);
        gesture = null;
      }));
      imageButton.addEventListener('click', event => {
        if (suppressNextImageClick) {
          suppressNextImageClick = false;
          event.preventDefault();
          return;
        }
        if (!galleryImmersive) setImmersive(true, imageButton);
        else setGalleryZoom(!galleryZoomed);
      });
      imageButton.addEventListener('dragstart', event => event.preventDefault());
    }

    function openDetail(vehicle, trigger) {
      if (!detailDialog || !$('vehicle-detail')) return;
      resetGalleryState();
      selectedVehicle = vehicle;
      imageIndex = 0;
      const images = imageList(vehicle);
      const heading = element('header', 'detail-heading');
      const headingCopy = element('div', 'detail-heading-copy');
      headingCopy.append(element('p', 'detail-eyebrow', 'PERFORMANCE VEHICLES'));
      const title = element('h2', 'detail-title', fullName(vehicle));
      title.id = 'detail-title';
      headingCopy.append(title);
      if (vehicle.subtitle) headingCopy.append(element('p', 'detail-subtitle', vehicle.subtitle));
      if (statusLabel(vehicle)) headingCopy.append(element('p', `detail-status status-${vehicle.status}`, statusLabel(vehicle)));
      const headingPrice = element('div', 'detail-heading-price');
      if (numericValue(vehicle.year)) headingPrice.append(element('p', 'detail-year', String(vehicle.year)));
      headingPrice.append(element('p', 'detail-price', vehiclePrice(vehicle)));
      heading.append(headingCopy, headingPrice);
      const gallery = element('section', 'detail-gallery');
      gallery.setAttribute('aria-label', `${fullName(vehicle)} photographs`);
      if (images.length) {
        const toolbar = element('div', 'gallery-toolbar');
        const count = element('p', 'gallery-count');
        count.id = 'gallery-count';
        count.setAttribute('aria-live', 'polite');
        count.setAttribute('aria-atomic', 'true');
        const tools = element('div', 'gallery-tools');
        const expand = galleryControl('gallery-expand', 'expand', 'Open full screen gallery', event => setImmersive(true, event.currentTarget));
        const zoom = galleryControl('gallery-zoom', 'zoom', 'Zoom in', () => {
          if (!galleryImmersive) setImmersive(true, zoom);
          setGalleryZoom(!galleryZoomed);
        });
        const play = galleryControl('gallery-play', 'play', 'Start slideshow', () => {
          if (slideshowTimer) stopSlideshow();
          else startSlideshow();
        });
        play.disabled = images.length < 2 || reducedMotion.matches;
        if (reducedMotion.matches) play.title = 'Slideshow paused while reduced motion is enabled';
        const gridToggle = galleryControl('gallery-grid-toggle', 'grid', 'Show all photos', () => setGalleryGrid(!galleryGridOpen));
        gridToggle.setAttribute('aria-controls', 'gallery-grid');
        gridToggle.setAttribute('aria-expanded', 'false');
        tools.append(expand, zoom, play, gridToggle);
        toolbar.append(count, tools);
        gallery.append(toolbar);
        const stage = element('div', 'gallery-stage');
        stage.id = 'gallery-stage';
        const imageButton = element('button', 'gallery-image-button');
        imageButton.id = 'gallery-image-button';
        imageButton.type = 'button';
        imageButton.setAttribute('aria-label', 'Open full screen photo gallery');
        const main = element('img', 'detail-main-image');
        main.id = 'detail-main-image';
        main.src = images[0];
        main.alt = fullName(vehicle);
        main.draggable = false;
        main.decoding = 'async';
        imageButton.append(main);
        stage.append(imageButton);
        if (images.length > 1) {
          [['Previous photo', -1, 'left'], ['Next photo', 1, 'right']].forEach(([label, delta, icon]) => {
            const control = element('button', `gallery-arrow gallery-arrow-${icon}`);
            control.type = 'button';
            control.setAttribute('aria-label', label);
            control.title = label;
            control.innerHTML = icons[icon];
            control.addEventListener('click', () => selectImage(imageIndex + delta));
            stage.append(control);
          });
        }
        stage.append(element('p', 'gallery-hint', images.length > 1 ? 'Swipe to explore · Tap for full screen' : 'Tap for full screen'));
        installSwipe(stage, imageButton);
        gallery.append(stage);
        const thumbnails = element('div', 'gallery-thumbnails');
        thumbnails.id = 'gallery-thumbnails';
        thumbnails.setAttribute('aria-label', 'Choose a photograph');
        const photoGrid = element('div', 'gallery-grid');
        photoGrid.id = 'gallery-grid';
        photoGrid.hidden = true;
        photoGrid.setAttribute('aria-label', 'All photographs');
        images.forEach((src, index) => {
          [['gallery-thumbnail', thumbnails], ['gallery-grid-item', photoGrid]].forEach(([className, parent]) => {
            const button = element('button', className);
            button.type = 'button';
            button.dataset.photoIndex = String(index);
            button.setAttribute('aria-label', `Show photo ${index + 1} of ${images.length}`);
            const thumbnail = element('img');
            thumbnail.src = src;
            thumbnail.alt = '';
            thumbnail.loading = 'lazy';
            thumbnail.decoding = 'async';
            button.append(thumbnail);
            if (className === 'gallery-grid-item') button.append(element('span', '', String(index + 1).padStart(2, '0')));
            button.addEventListener('click', () => {
              selectImage(index);
              if (galleryGridOpen) {
                setGalleryGrid(false, false);
                imageButton.focus({ preventScroll: true });
              }
            });
            parent.append(button);
          });
        });
        gallery.append(photoGrid, thumbnails);
      } else gallery.append(element('div', 'gallery-empty', 'Vehicle photography will be added soon.'));
      const copy = element('div', 'detail-copy');
      copy.append(element('p', 'detail-description', vehicle.description || 'Get in touch to discuss this car and the details that matter to you.'));
      const facts = element('dl', 'detail-facts');
      const mileage = numericValue(vehicle.mileageKm);
      [['Make', vehicle.make], ['Body style', vehicle.body], ['Year', numericValue(vehicle.year) ? String(vehicle.year) : null], ['Mileage', mileage !== null ? `${numberFormat.format(mileage)} km` : null], ['Fuel', vehicle.fuel], ['Transmission', vehicle.transmission]].forEach(([label, value]) => {
        if (value == null || value === '') return;
        const pair = element('div');
        pair.append(element('dt', '', label), element('dd', '', String(value)));
        facts.append(pair);
      });
      if (facts.children.length) copy.append(facts);
      const notice = vehicle.status === 'sold' ? 'This car has been sold. Get in touch to discuss something similar.' : vehicle.status === 'reserved' ? 'This car is reserved. Please enquire for the latest availability.' : (!vehicle.status || vehicle.status === 'showcase') ? 'Photography showcase — availability and specification to be confirmed.' : '';
      if (notice) copy.append(element('p', 'detail-notice', notice));
      const actions = element('div', 'detail-actions');
      const enquire = element('button', 'button button-primary', vehicle.status === 'sold' ? 'Enquire about similar' : 'Enquire about this car');
      enquire.type = 'button';
      enquire.insertAdjacentHTML('beforeend', icons.arrow);
      enquire.addEventListener('click', () => {
        closeDialog(detailDialog);
        openEnquiry(String(vehicle.id), trigger);
      });
      actions.append(enquire, element('p', 'detail-source-link', vehicle.credit || 'Performance Vehicles collection'));
      copy.append(actions);
      $('vehicle-detail').replaceChildren(heading, gallery, copy);
      detailDialog.setAttribute('aria-labelledby', 'detail-title');
      selectImage(0);
      openDialog(detailDialog, trigger);
      detailDialog.scrollTop = 0;
      $('close-detail')?.focus({ preventScroll: true });
    }

    detailDialog?.addEventListener('keydown', event => {
      if (!selectedVehicle || event.target.closest('input, textarea, select')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        selectImage(imageIndex + (event.key === 'ArrowRight' ? 1 : -1));
        if (galleryGridOpen) $('gallery-grid')?.querySelector('.is-active')?.focus();
      }
    });

    function enquiryText() {
      const vehicle = byId.get(enquiryCar?.value || '');
      const name = $('enquiry-name')?.value.trim() || '';
      const message = $('enquiry-message')?.value.trim() || '';
      const greeting = name ? `Hi, I'm ${name}.` : 'Hi Performance Vehicles,';
      const interest = vehicle ? `I'm interested in the ${fullName(vehicle)} featured on your website. Could you let me know the availability and details?` : similarInterest ? `I'm looking for a car similar to the ${fullName(similarInterest)}. Could you let me know what you have available?` : "I'd like to discuss finding my next car.";
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
      const vehicle = byId.get(id);
      similarInterest = vehicle?.status === 'sold' ? vehicle : null;
      if (enquiryCar) enquiryCar.value = vehicle && !similarInterest ? id : '';
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
    enquiryCar?.addEventListener('change', () => { similarInterest = null; updateEnquiry(); });
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
