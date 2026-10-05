/* Barn Finder — listings + satellite map. Data: listings.json (updated daily). */
(() => {
  'use strict';
  const PARCELS = 'https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/UtahStatewideParcels/FeatureServer/0/query';
  const $ = s => document.querySelector(s);
  const store = {
    get(k, d) { try { const v = localStorage.getItem('bf.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem('bf.' + k, JSON.stringify(v)); } catch {} }
  };
  const LOCS = {
    salem: { label: 'Salem, UT', file: 'listings.json', center: [39.9, -111.65], zoom: 9, parcels: true, foot: 'Drive times are estimates from your home in Salem.' },
    swan: { label: 'Swan Valley, ID', file: 'listings-swan.json', center: [43.35, -111.45], zoom: 8, parcels: false, foot: 'Drive times are estimates from your place in Swan Valley. Parcel outlines aren\'t available in Idaho or Wyoming yet.' }
  };
  let loc = store.get('loc', 'salem'); if (!LOCS[loc]) loc = 'salem';
  let DATA = [], META = {}, view = 'list';
  const favs = new Set(store.get('favs', []));
  const state = Object.assign({
    sort: 'posted-desc', maxDrive: 60, maxPrice: 1500000, minAcres: 5,
    types: ['land', 'house', 'barn'], onlyWater: false, noHoa: false, onlyFav: false, showPending: false, q: ''
  }, store.get('state', {}));

  const money = n => n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US');
  const short = n => n >= 1e6 ? '$' + (n / 1e6).toFixed(n % 1e6 ? 2 : 1).replace(/\.?0+$/, '') + 'M' : '$' + Math.round(n / 1000) + 'K';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = s => s ? new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  const daysAgo = s => s ? Math.floor((Date.now() - new Date(s + 'T12:00:00')) / 864e5) : 9999;

  function lastDrop(d) {
    const h = (d.history || []).filter(x => /drop/i.test(x[1]));
    if (!h.length) return null;
    const last = h.sort((a, b) => a[0] < b[0] ? -1 : 1).at(-1);
    const all = (d.history || []).slice().sort((a, b) => a[0] < b[0] ? -1 : 1);
    const i = all.findIndex(x => x === last);
    const prev = i > 0 ? all[i - 1][2] : null;
    return { date: last[0], prev, days: daysAgo(last[0]) };
  }
  const isNew = d => (daysAgo(d.firstSeen) <= 2 && META.firstRun !== d.firstSeen) || daysAgo(d.posted) <= 7;
  const lastChange = d => Math.max(...(d.history || []).map(h => +new Date(h[0])), +new Date(d.posted || 0));
  const pending = d => /contract|pending/i.test(d.status || '');
  const rank = { yes: 0, partial: 1, nearby: 1, 'off-grid': 2, unknown: 3, no: 4 };

  // ---------- filtering / sorting ----------
  function filtered() {
    const q = state.q.trim().toLowerCase();
    return DATA.filter(d =>
      (state.maxDrive >= 90 || d.driveMin <= state.maxDrive) &&
      d.price <= state.maxPrice &&
      (d.acresMax || d.acres) >= state.minAcres &&
      state.types.includes(d.cat) &&
      (!state.onlyWater || d.waterFlag === 'yes') &&
      (!state.noHoa || d.hoaFlag === 'none') &&
      (!state.onlyFav || favs.has(d.id)) &&
      (state.showPending || !pending(d)) &&
      (!q || [d.city, d.addr, d.mls, d.zoning, d.water, d.desc, d.county, d.parcel].join(' ').toLowerCase().includes(q))
    ).sort(sorter(state.sort));
  }
  function sorter(k) {
    const by = f => (a, b) => f(a) - f(b);
    switch (k) {
      case 'price-asc': return by(d => d.price);
      case 'price-desc': return by(d => -d.price);
      case 'drive-asc': return by(d => d.driveMin);
      case 'acres-desc': return by(d => -d.acres);
      case 'acres-asc': return by(d => d.acres);
      case 'ppa-asc': return by(d => d.price / d.acres);
      case 'water': return (a, b) => rank[a.waterFlag] - rank[b.waterFlag] || a.driveMin - b.driveMin;
      case 'power': return (a, b) => rank[a.powerFlag] - rank[b.powerFlag] || a.driveMin - b.driveMin;
      case 'hoa': return (a, b) => ({ none: 0, unknown: 1, yes: 2 }[a.hoaFlag] - { none: 0, unknown: 1, yes: 2 }[b.hoaFlag]) || a.driveMin - b.driveMin;
      case 'zoning': return (a, b) => (a.zoning || '~').localeCompare(b.zoning || '~');
      case 'mls': return (a, b) => (a.mls || '~').localeCompare(b.mls || '~', undefined, { numeric: true });
      case 'changed': return by(d => -lastChange(d));
      default: return by(d => -new Date(d.posted || 0));
    }
  }

  // ---------- cards ----------
  const icon = {
    l: '<svg width="16" height="16" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>',
    r: '<svg width="16" height="16" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>',
    star: '<svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill="currentColor"/></svg>'
  };
  const utilLabel = { yes: 'in place', partial: 'permit / partial', nearby: 'nearby', 'off-grid': 'off-grid', unknown: 'not stated', no: 'none' };

  function card(d) {
    const drop = lastDrop(d);
    const badges = [];
    if (isNew(d)) badges.push('<span class="badge new">New</span>');
    if (drop && drop.days <= 21) badges.push('<span class="badge drop">Price cut</span>');
    if (pending(d)) badges.push('<span class="badge pend">Under contract</span>');
    if (d.cat === 'barn') badges.push('<span class="badge">Barn</span>');
    const imgs = d.imgs || [];
    const ppa = d.price / d.acres;
    const gm = `https://www.google.com/maps/@?api=1&map_action=map&center=${d.lat},${d.lng}&zoom=17&basemap=satellite`;
    const hist = (d.history || []).slice().sort((a, b) => a[0] < b[0] ? 1 : -1)
      .map(h => `<tr><td>${fmtDate(h[0])}</td><td>${esc(h[1])}</td><td>${money(h[2])}</td></tr>`).join('');
    return `<article class="card" id="c-${d.id}" data-id="${d.id}">
      <div class="car" data-i="0">
        ${imgs.length ? `<div class="track">${imgs.map((u, i) => `<img src="${esc(u)}" alt="Photo ${i + 1} of ${esc(d.city)} listing" loading="lazy" decoding="async" data-i="${i}" referrerpolicy="no-referrer">`).join('')}</div>`
        : `<div class="noimg">No photos on the listing yet.<br>Use the map for a satellite view.</div>`}
        ${imgs.length > 1 ? `<button class="nav prev" aria-label="Previous photo">${icon.l}</button><button class="nav next" aria-label="Next photo">${icon.r}</button><span class="idx">1 / ${imgs.length}</span>` : ''}
        <div class="badges">${badges.join('')}</div>
        <button class="fav" aria-pressed="${favs.has(d.id)}" aria-label="Save listing" title="Save">${icon.star}</button>
      </div>
      <div class="body">
        <div class="row1">
          <div class="price">${d.priceMax ? short(d.price) + '–' + short(d.priceMax) : money(d.price)}${drop && drop.prev && drop.days <= 60 ? `<span class="was">${short(drop.prev)}</span>` : ''}</div>
          <div class="acres">${d.acresMax ? d.acres + '–' + d.acresMax : d.acres} ac <small>· ${short(ppa)}/ac</small></div>
        </div>
        <div class="loc"><b>${esc(d.city)}</b>${d.addr ? ' · ' + esc(d.addr) : ''} <span>· ${esc(d.county.includes(',') ? d.county.replace(',', ' Co.,') : d.county + ' Co.')}</span></div>
        <div class="drive"><span class="pill ${d.driveMin > 60 ? 'far' : ''}">~${d.driveMin} min drive</span><span>${d.miles} mi straight-line</span>${d.approx ? '<span title="Location approximate">· approx. location</span>' : ''}</div>
        <div class="util">
          <span class="u ${d.waterFlag}"><i></i>Water: ${utilLabel[d.waterFlag]}</span>
          <span class="u ${d.powerFlag}"><i></i>Power: ${utilLabel[d.powerFlag]}</span>
          <span class="u ${d.hoaFlag === 'none' ? 'yes' : d.hoaFlag === 'yes' ? 'nearby' : 'unknown'}"><i></i>HOA: ${d.hoaFlag === 'none' ? 'none' : d.hoa ? esc(d.hoa) : 'not stated'}</span>
        </div>
        ${d.water ? `<p class="wnote">${esc(d.water)}</p>` : ''}
        <p class="desc">${esc(d.desc)}</p>
        <dl class="facts">
          <div><dt>MLS #</dt><dd class="mono">${esc(d.mls || 'Not listed')}</dd></div>
          <div><dt>Listed</dt><dd>${fmtDate(d.posted)}</dd></div>
          <div><dt>Zoning</dt><dd>${esc(d.zoning || 'Not stated')}</dd></div>
          <div><dt>Parcel</dt><dd class="mono">${esc(d.parcel || '—')}</dd></div>
          <div><dt>Power detail</dt><dd>${esc(d.power || 'Not stated')}</dd></div>
          <div><dt>Sewer</dt><dd>${esc(d.sewer || 'Not stated')}</dd></div>
          ${d.beds ? `<div><dt>Home</dt><dd>${d.beds} bd · ${d.baths} ba${d.sqft ? ' · ' + d.sqft.toLocaleString() + ' sq ft' : ''}</dd></div>` : ''}
          <div><dt>Broker</dt><dd>${esc(d.broker || '—')}</dd></div>
        </dl>
        ${hist ? `<details class="hist"><summary>Price history</summary><table>${hist}</table></details>` : ''}
        <div class="actions">
          <a class="btn primary" href="${esc(d.url)}" target="_blank" rel="noopener">View listing</a>
          <button class="btn showmap">${LOCS[loc].parcels ? 'Satellite + parcel' : 'Satellite view'}</button>
          <a class="btn" href="${gm}" target="_blank" rel="noopener">Google Maps</a>
        </div>
      </div>
    </article>`;
  }

  function renderList() {
    const rows = filtered();
    $('#grid').innerHTML = rows.map(card).join('');
    $('#empty').hidden = rows.length > 0;
    $('#count').innerHTML = `<b>${rows.length}</b> of ${DATA.length} properties`;
    if (map) renderMarkers(rows);
  }

  // carousel + lightbox + actions (delegated)
  function go(car, i) {
    const imgs = car.querySelectorAll('.track img');
    if (!imgs.length) return;
    i = (i + imgs.length) % imgs.length;
    car.dataset.i = i;
    car.querySelector('.track').style.transform = `translateX(-${i * 100}%)`;
    const idx = car.querySelector('.idx'); if (idx) idx.textContent = `${i + 1} / ${imgs.length}`;
  }
  $('#grid').addEventListener('click', e => {
    const cardEl = e.target.closest('.card'); if (!cardEl) return;
    const car = cardEl.querySelector('.car');
    const d = DATA.find(x => x.id === cardEl.dataset.id);
    if (e.target.closest('.prev')) return go(car, +car.dataset.i - 1);
    if (e.target.closest('.next')) return go(car, +car.dataset.i + 1);
    if (e.target.closest('.fav')) {
      const b = e.target.closest('.fav');
      favs.has(d.id) ? favs.delete(d.id) : favs.add(d.id);
      b.setAttribute('aria-pressed', favs.has(d.id)); store.set('favs', [...favs]);
      if (state.onlyFav) renderList();
      return;
    }
    if (e.target.closest('.showmap')) { cameFrom = d.id; setView('map'); focusListing(d.id, true); return; }
    const img = e.target.closest('.track img');
    if (img && !car.dataset.swiped) openLB(d, +img.dataset.i);
  });
  // swipe on carousels
  let sx = null, sy = null, scar = null;
  $('#grid').addEventListener('touchstart', e => { const c = e.target.closest('.car'); if (!c) return; scar = c; sx = e.touches[0].clientX; sy = e.touches[0].clientY; delete c.dataset.swiped; }, { passive: true });
  $('#grid').addEventListener('touchend', e => {
    if (!scar) return; const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { go(scar, +scar.dataset.i + (dx < 0 ? 1 : -1)); scar.dataset.swiped = 1; setTimeout(() => scar && delete scar.dataset.swiped, 350); }
    scar = null;
  }, { passive: true });
  // hide broken photos
  document.addEventListener('error', e => {
    if (e.target.tagName === 'IMG' && e.target.closest('.track')) {
      const car = e.target.closest('.car'); e.target.remove();
      const n = car.querySelectorAll('.track img').length;
      if (!n) car.querySelector('.track').outerHTML = '<div class="noimg">Photos unavailable.<br>Open the listing or the map.</div>';
      go(car, 0); const idx = car.querySelector('.idx'); if (idx && n < 2) { idx.remove(); car.querySelectorAll('.nav').forEach(b => b.remove()); }
    }
  }, true);

  // lightbox
  let lbD = null, lbI = 0;
  function openLB(d, i) { lbD = d; lbI = i; showLB(); $('#lb').hidden = false; document.body.style.overflow = 'hidden'; $('#lbClose').focus(); }
  function showLB() {
    const n = lbD.imgs.length; lbI = (lbI + n) % n;
    $('#lbImg').src = lbD.imgs[lbI]; $('#lbImg').alt = `${lbD.city} photo ${lbI + 1}`;
    $('#lbCap').innerHTML = `${esc(lbD.city)} · ${money(lbD.price)} · ${lbD.acres} ac <span>${lbI + 1} / ${n}</span>`;
  }
  function closeLB() { $('#lb').hidden = true; document.body.style.overflow = ''; $('#lbImg').src = ''; }
  $('#lbClose').onclick = closeLB;
  $('#lbPrev').onclick = () => { lbI--; showLB(); };
  $('#lbNext').onclick = () => { lbI++; showLB(); };
  $('#lb').addEventListener('click', e => { if (e.target.id === 'lb') closeLB(); });
  document.addEventListener('keydown', e => {
    if ($('#lb').hidden) return;
    if (e.key === 'Escape') closeLB(); if (e.key === 'ArrowLeft') { lbI--; showLB(); } if (e.key === 'ArrowRight') { lbI++; showLB(); }
  });
  let lx = null;
  $('#lb').addEventListener('touchstart', e => { if (e.touches.length === 1) lx = e.touches[0].clientX; }, { passive: true });
  $('#lb').addEventListener('touchend', e => { if (lx == null) return; const dx = e.changedTouches[0].clientX - lx; if (Math.abs(dx) > 50) { lbI += dx < 0 ? 1 : -1; showLB(); } lx = null; }, { passive: true });

  // ---------- map ----------
  let map = null, markers = {}, layerGroup = null, parcelLayer = null, parcelCache = {}, selected = null;
  function initMap() {
    if (map) return;
    map = L.map('map', { zoomControl: true }).setView(LOCS[loc].center, LOCS[loc].zoom);
    const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' });
    const labels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 });
    const roads = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, opacity: .7 });
    const topo = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: '© Esri' });
    sat.addTo(map); labels.addTo(map); roads.addTo(map);
    const closeCtl = L.control({ position: 'topright' });
    closeCtl.onAdd = () => {
      const b = L.DomUtil.create('button', 'mapclose');
      b.type = 'button'; b.setAttribute('aria-label', 'Close map and go back to listings'); b.title = 'Back to listings';
      b.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg><span>Listings</span>';
      L.DomEvent.disableClickPropagation(b);
      L.DomEvent.on(b, 'click', e => { L.DomEvent.preventDefault(e); backToList(); });
      return b;
    };
    closeCtl.addTo(map);
    L.control.layers({ 'Satellite': sat, 'Topographic': topo }, { 'Town labels': labels, 'Roads': roads }, { position: 'topright' }).addTo(map);
    L.control.scale({ imperial: true, metric: false }).addTo(map);
    const lg = L.control({ position: 'bottomleft' });
    lg.onAdd = () => { const el = L.DomUtil.create('div', 'legend'); el.innerHTML = '<div><i style="background:#6F8466"></i>Land</div><div><i style="background:#5F8FB3"></i>House on acreage</div><div><i style="background:#B65E3C"></i>Has barn</div><div><i style="border:2px solid #F2D27A;background:transparent"></i>Parcel outline</div>'; return el; };
    lg.addTo(map);
    layerGroup = L.layerGroup().addTo(map);
    parcelLayer = L.layerGroup().addTo(map);
    map.on('zoomend moveend', autoOutlines);
  }
  function pinIcon(d) {
    return L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 26], popupAnchor: [0, -24],
      html: `<div class="pin ${d.cat}${d.approx ? ' approx' : ''}${selected === d.id ? ' sel' : ''}"><span>${d.price >= 1e6 ? (d.price / 1e6).toFixed(1) : Math.round(d.price / 1e3)}</span></div>` });
  }
  function popup(d) {
    const pa = parcelCache[d.id] && parcelCache[d.id].acres ? `<div class="pa">County parcel: ${parcelCache[d.id].acres.toFixed(2)} ac · ID ${esc(parcelCache[d.id].pid)}</div>` : '';
    return `<div class="pop">${d.imgs && d.imgs[0] ? `<img src="${esc(d.imgs[0])}" alt="" referrerpolicy="no-referrer">` : ''}
      <b>${money(d.price)}</b> · ${d.acres} ac<div class="m">${esc(d.city)} · ~${d.driveMin} min · ${esc(d.mls || '')}</div>${pa}
      <div class="links"><a href="#" data-card="${d.id}">Details</a><a href="${esc(d.url)}" target="_blank" rel="noopener">Listing ↗</a></div></div>`;
  }
  function renderMarkers(rows) {
    if (!map) return;
    layerGroup.clearLayers(); markers = {};
    rows.forEach(d => {
      const m = L.marker([d.lat, d.lng], { icon: pinIcon(d), title: `${money(d.price)} · ${d.acres} ac` }).bindPopup(() => popup(d), { maxWidth: 260 });
      m.on('click', () => focusListing(d.id, false));
      m.addTo(layerGroup); markers[d.id] = m;
    });
    $('#sideList').innerHTML = rows.map(d => `<div class="mi" data-id="${d.id}">${d.imgs && d.imgs[0] ? `<img src="${esc(d.imgs[0])}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<div class="ph"></div>'}<div class="t"><b>${money(d.price)}</b>${d.acres} ac · ${esc(d.city)}<br><span>~${d.driveMin} min · ${esc(d.mls || 'no MLS #')}</span></div></div>`).join('');
  }
  $('#sideList').addEventListener('click', e => { const r = e.target.closest('.mi'); if (r) focusListing(r.dataset.id, true); });
  document.addEventListener('click', e => {
    const a = e.target.closest('a[data-card]'); if (!a) return; e.preventDefault();
    setView('list'); const el = document.getElementById('c-' + a.dataset.card);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  });

  function focusListing(id, fly) {
    const d = DATA.find(x => x.id === id); if (!d) return;
    const prev = selected; selected = id;
    [prev, id].forEach(k => markers[k] && markers[k].setIcon(pinIcon(DATA.find(x => x.id === k))));
    document.querySelectorAll('.side .mi').forEach(r => r.classList.toggle('on', r.dataset.id === id));
    const row = document.querySelector(`.side .mi[data-id="${id}"]`); if (row) row.scrollIntoView({ block: 'nearest' });
    if (fly) map.flyTo([d.lat, d.lng], 16, { duration: .8 });
    loadParcel(d).then(p => {
      if (p && p.layer && selected === id) {
        if (fly) map.flyToBounds(p.layer.getBounds().pad(.35), { maxZoom: 17, duration: .8 });
        if (d.approx && p.center) { d.lat = p.center[0]; d.lng = p.center[1]; d.approx = false; markers[id] && markers[id].setLatLng(p.center).setIcon(pinIcon(d)); }
      }
      markers[id] && markers[id].openPopup();
    });
  }

  // parcel lookup: by parcel ID near the listing, else by point
  function idVariants(p) {
    if (!p) return [];
    const raw = String(p).trim(), nodash = raw.replace(/[-\s]/g, ''), nolead = nodash.replace(/^[A-Z]?0+/, '');
    return [...new Set([raw, nodash, nolead, raw.replace(/^S-?/i, ''), nodash.replace(/^0+/, '')])].filter(Boolean);
  }
  async function q(params) {
    const u = PARCELS + '?' + new URLSearchParams(Object.assign({ outFields: 'PARCEL_ID,PARCEL_ADD,Shape__Area', returnGeometry: 'true', outSR: '4326', f: 'geojson' }, params));
    const r = await fetch(u); if (!r.ok) throw new Error(r.status); return r.json();
  }
  async function loadParcel(d) {
    if (!LOCS[loc].parcels) return null;
    if (parcelCache[d.id] !== undefined) return drawParcel(d, parcelCache[d.id]);
    let gj = null;
    try {
      const vs = idVariants(d.parcel);
      if (vs.length) {
        const pad = d.approx ? .35 : .05;
        const res = await q({ where: vs.map(v => `PARCEL_ID LIKE '${v.replace(/'/g, "''")}%'`).join(' OR '),
          geometry: `${d.lng - pad},${d.lat - pad},${d.lng + pad},${d.lat + pad}`, geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects' });
        if (res.features && res.features.length) gj = res;
      }
      if (!gj && !d.approx) {
        const res = await q({ geometry: `${d.lng},${d.lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects' });
        if (res.features && res.features.length) gj = res;
      }
    } catch (e) { console.warn('parcel lookup failed', e); }
    let rec = null;
    if (gj) {
      const f = gj.features;
      const area = f.reduce((s, x) => s + (x.properties.Shape__Area || 0), 0);
      const c = Math.cos(d.lat * Math.PI / 180);
      rec = { gj, pid: f.map(x => x.properties.PARCEL_ID).join(', '), acres: area ? area * c * c / 4046.86 : null };
    }
    parcelCache[d.id] = rec;
    return drawParcel(d, rec);
  }
  function drawParcel(d, rec) {
    if (!rec) return null;
    if (!rec.layer) {
      rec.layer = L.geoJSON(rec.gj, { style: { color: '#F2D27A', weight: 3, fillColor: '#F2D27A', fillOpacity: .12, dashArray: '6 4' } });
      const b = rec.layer.getBounds(); const c = b.getCenter(); rec.center = [c.lat, c.lng];
    }
    if (!parcelLayer.hasLayer(rec.layer)) rec.layer.addTo(parcelLayer);
    return rec;
  }
  let autoT = null;
  function autoOutlines() {
    clearTimeout(autoT);
    autoT = setTimeout(() => {
      if (!map || map.getZoom() < 13) return;
      const b = map.getBounds();
      filtered().filter(d => b.contains([d.lat, d.lng])).slice(0, 12).forEach(d => loadParcel(d));
    }, 400);
  }

  // ---------- controls ----------
  function bind() {
    const s = $('#sort'); s.value = state.sort; s.onchange = () => { state.sort = s.value; save(); };
    const rng = (id, key, fmt) => { const el = $('#' + id), out = $('#' + id + 'Out'); el.value = state[key]; out.textContent = fmt(+el.value); el.oninput = () => { state[key] = +el.value; out.textContent = fmt(+el.value); save(); }; };
    rng('maxDrive', 'maxDrive', v => v >= 90 ? 'any' : v + ' min');
    rng('maxPrice', 'maxPrice', v => short(v));
    rng('minAcres', 'minAcres', v => v + ' ac');
    document.querySelectorAll('#typeChips .chip').forEach(b => {
      b.setAttribute('aria-pressed', state.types.includes(b.dataset.t));
      b.onclick = () => { const t = b.dataset.t; state.types = state.types.includes(t) ? state.types.filter(x => x !== t) : [...state.types, t]; b.setAttribute('aria-pressed', state.types.includes(t)); save(); };
    });
    ['onlyWater', 'noHoa', 'onlyFav', 'showPending'].forEach(k => { const b = $('#' + k); b.setAttribute('aria-pressed', state[k]); b.onclick = () => { state[k] = !state[k]; b.setAttribute('aria-pressed', state[k]); save(); }; });
    const qi = $('#q'); qi.value = state.q; qi.oninput = () => { state.q = qi.value; save(); };
    $('#ftoggle').onclick = () => { const f = $('#filters'); const open = f.classList.toggle('collapsed') === false; $('#ftoggle').setAttribute('aria-expanded', open); $('#ftoggle').textContent = open ? 'Hide filters' : 'Filters'; };
    $('#tabList').onclick = () => setView('list');
    $('#tabMap').onclick = () => setView('map');
  }
  function save() { store.set('state', state); renderList(); }
  let cameFrom = null;
  function backToList() {
    const id = selected || cameFrom;
    setView('list');
    const el = id && document.getElementById('c-' + id);
    if (el) {
      document.documentElement.style.setProperty('--stick', $('#hdr').offsetHeight + 'px');
      el.scrollIntoView({ block: 'start' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    }
    cameFrom = null;
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && view === 'map' && $('#lb').hidden) backToList(); });
  function setView(v) {
    view = v;
    $('#tabList').setAttribute('aria-selected', v === 'list'); $('#tabMap').setAttribute('aria-selected', v === 'map');
    $('#listView').hidden = v !== 'list'; $('#mapView').hidden = v !== 'map';
    if (v === 'map') {
      const h = $('#hdr').offsetHeight + document.querySelector('.filters').offsetHeight + ($('#news').hidden ? 0 : $('#news').offsetHeight);
      document.documentElement.style.setProperty('--hdr', h + 'px');
      initMap(); setTimeout(() => map.invalidateSize(), 50); renderMarkers(filtered());
    }
    try { history.replaceState(null, '', v === 'map' ? '#map' : '#list'); } catch {}
  }

  function news() {
    const ch = (META.changes || []).filter(c => daysAgo(c.date) <= 3);
    if (!ch.length) return;
    const nNew = ch.filter(c => c.kind === 'new').length, nDrop = ch.filter(c => c.kind === 'price').length;
    $('#newsInner').innerHTML = `<b>Since ${fmtDate(ch[ch.length - 1].date)}</b><span>${nNew} new listing${nNew === 1 ? '' : 's'}</span><span>${nDrop} price change${nDrop === 1 ? '' : 's'}</span><button id="seeChanged">Show recently changed</button>`;
    $('#news').hidden = false;
    $('#seeChanged').onclick = () => { state.sort = 'changed'; $('#sort').value = 'changed'; save(); };
  }

  async function loadData() {
    const L0 = LOCS[loc];
    $('#locLink').textContent = L0.label;
    $('#locNext').textContent = LOCS[loc === 'salem' ? 'swan' : 'salem'].label;
    $('#locLink').title = 'Switch to ' + LOCS[loc === 'salem' ? 'swan' : 'salem'].label;
    $('#footLoc').textContent = L0.foot;
    $('#updated').textContent = 'Loading listings…';
    $('#news').hidden = true;
    try {
      const r = await fetch(L0.file + '?v=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      META = j; DATA = j.listings;
      const up = new Date(j.updated);
      $('#updated').textContent = `${DATA.length} properties · updated ${up.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${up.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    } catch (e) {
      DATA = []; META = {};
      $('#updated').textContent = 'Could not load listings';
      $('#grid').innerHTML = '<div class="empty"><h2>Listings did not load</h2><p>Check your connection and reload the page.</p></div>';
      return false;
    }
    news(); renderList();
    return true;
  }
  async function switchLoc() {
    loc = loc === 'salem' ? 'swan' : 'salem';
    store.set('loc', loc);
    selected = null; cameFrom = null; parcelCache = {};
    if (parcelLayer) parcelLayer.clearLayers();
    window.scrollTo(0, 0);
    const ok = await loadData();
    if (ok && map) {
      map.setView(LOCS[loc].center, LOCS[loc].zoom);
      if (view === 'map') setTimeout(() => map.invalidateSize(), 50);
    }
  }
  async function boot() {
    bind();
    $('#locLink').onclick = switchLoc;
    const ok = await loadData();
    if (ok && location.hash === '#map') setView('map');
  }
  boot();
})();
