// Trace app (static, no server). Reports are signed public events on free Nostr relays; your list stays in this browser.
// Shared by Drip Trace and Butt Trace; window.TRACE (set in index.html) picks the mode.
import { createStore, rid, TEST, now, getPublicKey } from './store.js';
const C = window.TRACE, DRIP = C.mode === 'drip';
const S = createStore(C.app);
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const V = () => $('#v');
const MINE = S.NS + ':mine';
const mine = () => { try { return JSON.parse(localStorage.getItem(MINE)) || []; } catch (e) { return []; } };
const saveMine = a => localStorage.setItem(MINE, JSON.stringify(a.slice(0, 500)));
const DAY = 864e5, fmtN = n => Number(n || 0).toLocaleString(), pct = (a, b) => b ? Math.round(1000 * a / b) / 10 + '%' : '—';
const when = t => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
function toast(m) { let t = $('#toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); } t.textContent = m; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 3200); }
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/csv' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
const csvCell = v => { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
function distM(a, b, c, d) { const R = 6371e3, r = x => x * Math.PI / 180, dl = r(c - a), dn = r(d - b); const h = Math.sin(dl / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }

/* ---------- shared reports ---------- */
let REPORTS = [], loadedAt = 0, loading = null;
const SIZES = C.sizes || [];
const sizeOf = k => SIZES.find(s => s[0] === k);
function valid(e) {
  const d = e.data || {}; if (d.deleted) return false;
  if (!(Math.abs(d.lat) <= 90 && Math.abs(d.lng) <= 180) || !(d.acc > 0 && d.acc <= 150) || !(d.t > 0) || d.t > Date.now() + 6e5) return false;
  if (DRIP) return !!sizeOf(d.size) && typeof d.st === 'object' && d.st && d.st.name;
  return d.n >= 1 && d.n <= 500 && typeof d.brand === 'string';
}
function clean(evs) {
  const out = [], perDay = {}, seenPh = new Set();
  evs.filter(valid).sort((a, b) => a.data.t - b.data.t).forEach(e => {
    const d = e.data, k = e.pubkey + '|' + new Date(d.t).toISOString().slice(0, 10);
    perDay[k] = (perDay[k] || 0) + 1; if (perDay[k] > (C.dailyCap || 25)) return; // cap per device per day
    if (d.ph) { if (seenPh.has(d.ph)) return; seenPh.add(d.ph); } // same photo twice counts once
    out.push(Object.assign({ id: e.d, by: e.pubkey }, d));
  });
  return out.reverse();
}
async function load(force) {
  if (!force && loadedAt && Date.now() - loadedAt < 60000) return REPORTS;
  if (loading) return loading;
  loading = S.query([S.T('r')], 5000, { since: now() - 365 * 86400, wait: 5000 }).then(evs => { REPORTS = clean(evs); loadedAt = Date.now(); return REPORTS; }).finally(() => { loading = null; });
  return loading;
}
let _pk; const me = () => _pk || (_pk = getPublicKey(S.deviceKey()));

/* ---------- router & layout ---------- */
const VIEWS = {};
const NAV = [['', 'Home'], ['report', C.reportNav], ['map', 'Map'], ['data', 'Data'], ['me', 'My reports']];
function nav(h) { $('#nav').innerHTML = NAV.map(([k, t]) => `<a href="#/${k}" class="${k === h ? 'on' : ''}">${t}</a>`).join(''); }
let stopCam = null, GEN = 0;
async function route() {
  const g = ++GEN;
  const h = location.hash.replace(/^#\/?/, '').split('?')[0]; const v = VIEWS[h] ? h : '';
  if (stopCam) { stopCam(); stopCam = null; }
  nav(v); window.scrollTo(0, 0); document.title = (v ? ((NAV.find(n => n[0] === v) || [, 'About'])[1]) + ' · ' : '') + C.name;
  try { await VIEWS[v](); } catch (e) { console.warn(e); if (g !== GEN) return; V().innerHTML = `<div class="card"><p class="err">Something went wrong: ${esc(e.message)}</p><button class="btn" onclick="location.reload()">Reload</button></div>`; }
}
const spinner = t => `<div class="card"><p class="muted">⏳ ${esc(t || 'Loading live reports…')}</p></div>`;

/* ---------- stats ---------- */
function stats(R) {
  const since = Date.now() - 30 * DAY, r30 = R.filter(r => r.t >= since);
  const o = { total: R.length, r30: r30.length, devices: new Set(R.map(r => r.by)).size };
  if (DRIP) {
    o.drips = R.filter(r => r.size !== 'none').length; o.rate = pct(o.drips, o.total);
    const g = (key) => { const m = {}; R.forEach(r => { const k = key(r) || 'Unbranded / unknown'; const x = m[k] = m[k] || { k, n: 0, d: 0, big: 0 }; x.n++; if (r.size !== 'none') x.d++; if ((sizeOf(r.size) || [])[2] >= 3) x.big++; }); return Object.values(m).sort((a, b) => b.n - a.n); };
    o.brands = g(r => r.st.brand); o.stations = g(r => r.st.name + (r.st.id ? ' ·' + r.st.id : ''));
    o.sizes = SIZES.map(s => ({ k: s[1], n: R.filter(r => r.size === s[0]).length }));
  } else {
    o.butts = R.reduce((a, r) => a + r.n, 0);
    const g = key => { const m = {}; R.forEach(r => { const k = key(r) || 'Unknown'; const x = m[k] = m[k] || { k, n: 0, butts: 0 }; x.n++; x.butts += r.n; }); return Object.values(m).sort((a, b) => b.butts - a.butts); };
    o.brands = g(r => r.brand); o.places = g(r => r.where);
    const cells = {}; R.forEach(r => { const k = (Math.round(r.lat * 200) / 200).toFixed(3) + ',' + (Math.round(r.lng * 200) / 200).toFixed(3); const x = cells[k] = cells[k] || { k, n: 0, butts: 0, area: r.area || '' }; x.n++; x.butts += r.n; if (!x.area && r.area) x.area = r.area; });
    o.hot = Object.values(cells).sort((a, b) => b.butts - a.butts).slice(0, 10);
  }
  const days = []; for (let i = 29; i >= 0; i--) { const d0 = new Date(Date.now() - i * DAY).toISOString().slice(0, 10); days.push({ d: d0, n: 0 }); }
  const di = Object.fromEntries(days.map((d, i) => [d.d, i])); r30.forEach(r => { const i = di[new Date(r.t).toISOString().slice(0, 10)]; if (i != null) days[i].n += DRIP ? 1 : r.n; });
  o.days = days; return o;
}
const bars = days => { const mx = Math.max(1, ...days.map(d => d.n)); return `<div class="chart" role="img" aria-label="Last 30 days">${days.map(d => `<span title="${d.d}: ${d.n}" style="height:${Math.max(2, 100 * d.n / mx)}%"></span>`).join('')}</div><div class="row sb sub"><span>30 days ago</span><span>today</span></div>`; };

/* ---------- home ---------- */
VIEWS[''] = async () => {
  V().innerHTML = `<section class="hero"><p class="tag">${esc(C.tagline)}</p><h1>${C.headline}</h1><p class="lead">${C.lead}</p>
   <div class="cta"><a class="btn big" href="#/report">${C.reportCta}</a><a class="btn big alt" href="#/map">🗺 See the map</a></div></section>
   <div id="homeStats">${spinner()}</div>
   <div class="card"><h2>How it works</h2><ol class="steps">${C.how.map(x => `<li>${x}</li>`).join('')}</ol>
    <p class="sub">No account. Your reports are signed by a key made on this device and shared on free public relays, so anyone can check the numbers. Photos never leave your phone.</p></div>
   <div class="card"><h2>Ask the free AI</h2><p>${esc(C.aiPitch)}</p><button class="btn alt" data-ai>✨ Open the helper</button></div>`;
  const g = GEN; let R; try { R = await load(); } catch (e) { if (g !== GEN) return; $('#homeStats').innerHTML = `<div class="card"><p class="err">Could not reach the live network. Check your connection.</p></div>`; return; }
  if (g !== GEN) return; const o = stats(R);
  $('#homeStats').innerHTML = o.total ? `<div class="grid g3">
   <div class="card stat"><div class="k">${fmtN(o.total)}</div><div class="sub">reports in the last year</div></div>
   <div class="card stat"><div class="k">${DRIP ? o.rate : fmtN(o.butts)}</div><div class="sub">${DRIP ? 'of fill-ups had a drip' : 'butts logged'}</div></div>
   <div class="card stat"><div class="k">${fmtN(o.devices)}</div><div class="sub">people reporting</div></div></div>
   <div class="card"><h3>Last 30 days</h3>${bars(o.days)}</div>`
    : `<div class="card empty"><p><b>No reports yet${TEST ? ' in the test area' : ''}.</b></p><p>Be the first: it takes about 10 seconds.</p><a class="btn" href="#/report">${C.reportCta}</a></div>`;
};

/* ---------- live place data ---------- */
async function timed(url, opt, ms) { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms || 12000); try { return await fetch(url, Object.assign({ signal: c.signal }, opt || {})); } finally { clearTimeout(t); } }
let LOCAL_ST = null; const BAD = {}; const ST_CACHE = {};
async function stationsNear(lat, lng) {
  const ck = lat.toFixed(3) + ',' + lng.toFixed(3); if (ST_CACHE[ck]) return ST_CACHE[ck];
  const r0 = await stationsLive(lat, lng); if (r0.list.length) ST_CACHE[ck] = r0; return r0;
}
async function stationsLive(lat, lng) {
  const q = `[out:json][timeout:12];nwr["amenity"="fuel"](around:400,${lat},${lng});out center 25;`;
  for (const u of ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter']) {
    if (BAD[u] > Date.now()) continue; // skip a mirror that just failed
    try {
      const r = await timed(u, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, 9000); if (!r.ok) { BAD[u] = Date.now() + 120000; continue; }
      const j = await r.json();
      return { src: 'OpenStreetMap (live)', list: j.elements.map(e => { const t = e.tags || {}, la = e.lat || (e.center || {}).lat, lo = e.lon || (e.center || {}).lon; return { id: e.type[0] + e.id, name: t.name || t.brand || 'Gas station', brand: t.brand || t.operator || '', lat: la, lng: lo, addr: [t['addr:housenumber'], t['addr:street'], t['addr:city']].filter(Boolean).join(' ') }; }).filter(s => s.lat) };
    } catch (e) { BAD[u] = Date.now() + 120000; console.warn('overpass', u, e.name); }
  }
  // Fallback when Overpass is down: the saved OpenStreetMap snapshot in stations.json (Chattanooga / North GA)
  try { LOCAL_ST = LOCAL_ST || await (await fetch('stations.json')).json(); return { src: 'OpenStreetMap (saved copy)', list: LOCAL_ST.map(s => ({ id: s.osm, name: s.name, brand: s.brand, lat: s.lat, lng: s.lng, addr: [s.addr, s.city].filter(Boolean).join(', ') })) }; } catch (e) { return { src: '', list: [] }; }
}
async function areaName(lat, lng) {
  try { const r = await timed(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`, {}, 8000); const j = await r.json(); return [j.locality || j.city, j.principalSubdivisionCode ? j.principalSubdivisionCode.split('-').pop() : j.principalSubdivision].filter(Boolean).join(', '); } catch (e) { return ''; }
}
/* 64-bit difference hash of a photo: lets the network drop a reused photo without the photo ever leaving the phone */
async function photoHash(file) {
  const bmp = await createImageBitmap(file); const c = document.createElement('canvas'); c.width = 9; c.height = 8; const x = c.getContext('2d'); x.drawImage(bmp, 0, 0, 9, 8);
  const p = x.getImageData(0, 0, 9, 8).data; let bits = '';
  for (let y = 0; y < 8; y++) for (let i = 0; i < 8; i++) { const a = (y * 9 + i) * 4, b = a + 4; bits += (p[a] + p[a + 1] + p[a + 2]) > (p[b] + p[b + 1] + p[b + 2]) ? 1 : 0; }
  return BigInt('0b' + bits).toString(16).padStart(16, '0');
}
function locate() {
  return new Promise((res, rej) => { if (!navigator.geolocation) return rej(new Error('This browser cannot share location.')); navigator.geolocation.getCurrentPosition(p => res(p.coords), e => rej(new Error(e.code === 1 ? 'Location permission was blocked. Allow location for this site in your browser settings, then tap Try again.' : 'Could not get your location. Step outside or turn on GPS, then tap Try again.')), { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 }); });
}

/* ---------- report ---------- */
const MAXACC = 150, MAXST = 150;
VIEWS.report = async () => {
  const F = { pos: null, st: null, size: '', ph: '', area: '', brand: '', n: 1, where: '' };
  V().innerHTML = `<h1>${esc(C.reportTitle)}</h1>
   <div class="card"><h2>1 · Where are you?</h2><p id="gps" class="muted">📍 Finding your location…</p><button class="btn alt" id="regps" hidden>Try again</button>${DRIP ? '<div id="sts" class="stack"></div>' : ''}</div>
   ${DRIP ? `<div class="card"><h2>2 · Pump number</h2><input id="pump" inputmode="numeric" maxlength="4" placeholder="Pump #" aria-label="Pump number" class="pumpin">
     <h2 style="margin-top:18px">3 · Did it drip?</h2><p class="sub">“No drip” counts too: it is how drip rates are worked out. A drip is an equipment issue, never the driver's fault.</p>
     <div class="opts" id="sizes">${SIZES.map(s => `<button type="button" data-size="${s[0]}">${s[3] || ''} ${esc(s[1])}</button>`).join('')}</div></div>`
    : `<div class="card"><h2>2 · Brand</h2><p class="sub">Read it off the filter if you can. Not sure? Pick “Can't tell”.</p><div class="opts" id="brands">${C.brands.map(b => `<button type="button" data-brand="${esc(b)}">${esc(b)}</button>`).join('')}</div>
     <h2 style="margin-top:18px">3 · How many?</h2><div class="stepper"><button type="button" id="nMinus" aria-label="Fewer">−</button><output id="nOut">1</output><button type="button" id="nPlus" aria-label="More">+</button></div>
     <h2 style="margin-top:18px">4 · Where exactly?</h2><div class="opts" id="wheres">${C.wheres.map(b => `<button type="button" data-where="${esc(b)}">${esc(b)}</button>`).join('')}</div></div>`}
   <div class="card"><h2>${DRIP ? '4' : '5'} · Photo (optional)</h2><p class="sub">The photo stays on your phone. Only a fingerprint is shared, so the same photo can't be counted twice.</p>
    <label class="btn alt file"><input type="file" id="photo" accept="image/*" capture="environment">📸 ${DRIP ? 'Snap the nozzle' : 'Snap the butt'}</label><div id="prev"></div></div>
   <button class="btn big wide" id="send">Send report</button><div id="res"></div>
   <p class="sub">Your report (${DRIP ? 'station, pump, drip size and time' : 'brand, count, place, time and location to about 10 m'}) is public, so anyone can check the totals. No name, phone or photo is shared.</p>`;
  const pick = (box, attr, key) => $(box).addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; F[key] = b.dataset[attr]; $$(box + ' button').forEach(x => x.classList.toggle('on', x === b)); });
  if (DRIP) pick('#sizes', 'size', 'size'); else { pick('#brands', 'brand', 'brand'); pick('#wheres', 'where', 'where'); const set = n => { F.n = Math.max(1, Math.min(500, n)); $('#nOut').textContent = F.n; }; $('#nMinus').onclick = () => set(F.n - 1); $('#nPlus').onclick = () => set(F.n + (F.n >= 10 ? 5 : 1)); }
  $('#photo').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { F.ph = await photoHash(f); const u = URL.createObjectURL(f); $('#prev').innerHTML = `<img src="${u}" alt="Your photo" class="prev"><p class="sub">✓ Photo fingerprinted on this phone.</p>`; } catch (err) { F.ph = ''; toast('Could not read that photo.'); } };
  const box = V().firstElementChild, alive = () => document.body.contains(box);
  const gps = async () => {
    $('#regps').hidden = true; $('#gps').className = 'muted'; $('#gps').textContent = '📍 Finding your location…';
    try { F.pos = await locate(); } catch (e) { if (!alive()) return; $('#gps').className = 'err'; $('#gps').textContent = e.message; $('#regps').hidden = false; return; }
    if (!alive()) return; const acc = Math.round(F.pos.accuracy);
    if (acc > MAXACC) { $('#gps').className = 'err'; $('#gps').textContent = `Your location is too rough (±${acc} m). Turn on precise location or step outside, then try again.`; $('#regps').hidden = false; return; }
    $('#gps').textContent = `✓ Location found (±${acc} m)`;
    if (!DRIP) { F.area = await areaName(F.pos.latitude, F.pos.longitude); if (alive() && F.area) $('#gps').textContent += ' · ' + F.area; return; }
    $('#sts').innerHTML = '<p class="muted">Looking up gas stations near you…</p>';
    const { src, list } = await stationsNear(F.pos.latitude, F.pos.longitude); if (!alive()) return;
    const near = list.map(s => Object.assign(s, { m: Math.round(distM(F.pos.latitude, F.pos.longitude, s.lat, s.lng)) })).filter(s => s.m <= 400).sort((a, b) => a.m - b.m).slice(0, 5);
    if (!near.length) { $('#sts').innerHTML = `<p class="err">No gas station found within 400 m of you on OpenStreetMap.</p><p class="sub">Reports must be made at the pump. If the station is missing from the map, you can <a href="https://www.openstreetmap.org/edit#map=19/${F.pos.latitude}/${F.pos.longitude}" target="_blank" rel="noopener">add it to OpenStreetMap</a>.</p>`; return; }
    $('#sts').innerHTML = near.map(s => `<button type="button" class="st" data-id="${esc(s.id)}" ${s.m > MAXST ? 'disabled' : ''}><b>${esc(s.name)}</b>${s.brand && s.brand !== s.name ? ' · ' + esc(s.brand) : ''}<span class="sub"> ${s.m} m${s.addr ? ' · ' + esc(s.addr) : ''}${s.m > MAXST ? ' · too far to report' : ''}</span></button>`).join('') + `<p class="sub">Stations: ${esc(src)} © OpenStreetMap contributors</p>`;
    const choose = s => { F.st = s; $$('.st').forEach(x => x.classList.toggle('on', x.dataset.id === s.id)); };
    $('#sts').onclick = e => { const b = e.target.closest('.st'); if (b && !b.disabled) choose(near.find(s => s.id === b.dataset.id)); };
    if (near[0].m <= MAXST) choose(near[0]);
  };
  $('#regps').onclick = gps; gps();
  $('#send').onclick = async () => {
    const err = m => { $('#res').innerHTML = `<p class="err">${esc(m)}</p>`; };
    if (!F.pos || F.pos.accuracy > MAXACC) return err('We need your location first (step 1).');
    if (DRIP && !F.st) return err('Pick your station in step 1.');
    if (DRIP && !/^\d{1,3}$/.test($('#pump').value.trim())) return err('Enter the pump number (step 2).');
    if (DRIP && !F.size) return err('Pick a drip size. “No drip” counts too.');
    if (!DRIP && !F.brand) return err('Pick a brand, or “Can\u2019t tell” (step 2).');
    if (!DRIP && !F.where) return err('Pick where you found it (step 4).');
    if (F.ph && mine().some(m => m.ph === F.ph)) return err('You already sent a report with this photo.');
    const t = Date.now(), r4 = x => Math.round(x * 1e4) / 1e4;
    const d = DRIP ? { v: 1, t, size: F.size, pump: $('#pump').value.trim(), st: { id: F.st.id, name: F.st.name, brand: F.st.brand || '' }, lat: r4(F.st.lat), lng: r4(F.st.lng), acc: Math.round(F.pos.accuracy), dist: F.st.m, ph: F.ph || undefined }
      : { v: 1, t, brand: F.brand, n: F.n, where: F.where, area: F.area || '', lat: r4(F.pos.latitude), lng: r4(F.pos.longitude), acc: Math.round(F.pos.accuracy), ph: F.ph || undefined };
    const b = $('#send'); b.disabled = true; b.textContent = 'Sending…';
    try {
      const id = 'r' + t.toString(36) + rid(6);
      await S.put(S.deviceKey(), id, [S.T('r')], d);
      const m = mine(); m.unshift(Object.assign({ id }, d)); saveMine(m); loadedAt = 0;
      V().innerHTML = `<div class="card done"><div class="check">✓</div><h2>Report sent. Thank you!</h2><p>${DRIP ? `${esc(F.st.name)} · pump ${esc(d.pump)} · ${esc(sizeOf(d.size)[1])}` : `${d.n} × ${esc(d.brand)} · ${esc(d.where)}${d.area ? ' · ' + esc(d.area) : ''}`}</p><p class="sub">${when(t)}${d.ph ? ' · photo fingerprint only' : ''}</p>
        <div class="cta"><a class="btn big" href="#/report" id="again">Report another</a><a class="btn big alt" href="#/map">See it on the map</a></div></div>`;
      $('#again').onclick = e => { e.preventDefault(); route(); };
    } catch (e) { b.disabled = false; b.textContent = 'Send report'; err(e.message); }
  };
};

/* ---------- map ---------- */
function leaflet() {
  if (window.L) return Promise.resolve(window.L);
  return new Promise((res, rej) => {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(l);
    const s = document.createElement('script'); s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; s.onload = () => res(window.L); s.onerror = () => rej(new Error('Map library did not load. Check your connection.')); document.head.appendChild(s);
  });
}
function groups(R) {
  const m = {};
  R.forEach(r => { const k = DRIP ? r.st.id || r.st.name : r.lat.toFixed(3) + ',' + r.lng.toFixed(3); const g = m[k] = m[k] || { k, lat: r.lat, lng: r.lng, name: DRIP ? r.st.name : (r.area || 'Spot'), brand: DRIP ? r.st.brand : '', n: 0, d: 0, butts: 0, last: 0, pumps: {} }; g.n++; if (DRIP && r.size !== 'none') { g.d++; g.pumps[r.pump] = (g.pumps[r.pump] || 0) + 1; } g.butts += r.n || 0; g.last = Math.max(g.last, r.t); });
  return Object.values(m).sort((a, b) => (DRIP ? b.d - a.d : b.butts - a.butts));
}
VIEWS.map = async () => {
  V().innerHTML = `<h1>Map</h1><div id="map" class="map" aria-label="Map of reports"></div><div id="mapList">${spinner()}</div>`;
  const g = GEN; const [L, R] = await Promise.all([leaflet(), load()]); if (g !== GEN) return;
  const G = groups(R);
  const map = L.map('map', { scrollWheelZoom: false }).setView(C.center, C.zoom);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
  const pts = [];
  G.forEach(g => {
    const rate = g.n ? g.d / g.n : 0, col = DRIP ? (rate >= .5 ? '#dc2626' : rate > 0 ? '#f59e0b' : '#16a34a') : C.color;
    const rad = DRIP ? 7 + Math.min(10, g.n) : 6 + Math.min(16, Math.sqrt(g.butts) * 2);
    L.circleMarker([g.lat, g.lng], { radius: rad, color: col, fillColor: col, fillOpacity: .55, weight: 2 }).addTo(map)
      .bindPopup(DRIP ? `<b>${esc(g.name)}</b><br>${g.d} drip${g.d === 1 ? '' : 's'} in ${g.n} report${g.n === 1 ? '' : 's'} (${pct(g.d, g.n)})${Object.keys(g.pumps).length ? '<br>Pumps: ' + Object.entries(g.pumps).map(([p, n]) => esc(p) + ' (' + n + ')').join(', ') : ''}<br><small>Last: ${when(g.last)}</small>` : `<b>${esc(g.name)}</b><br>${g.butts} butts in ${g.n} report${g.n === 1 ? '' : 's'}<br><small>Last: ${when(g.last)}</small>`);
    pts.push([g.lat, g.lng]);
  });
  if (pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 15 });
  $('#mapList').innerHTML = G.length ? `<div class="card"><h2>${DRIP ? 'Stations' : 'Spots'} (${G.length})</h2>${DRIP ? '<p class="sub">🟢 no drips · 🟠 some drips · 🔴 half or more</p>' : ''}<div class="tw"><table><thead><tr><th>${DRIP ? 'Station' : 'Area'}</th><th>Reports</th><th>${DRIP ? 'Drips' : 'Butts'}</th><th>Last</th></tr></thead><tbody>${G.slice(0, 100).map(g => `<tr><td>${esc(g.name)}${g.brand && g.brand !== g.name ? ' <span class="sub">' + esc(g.brand) + '</span>' : ''}</td><td>${g.n}</td><td>${DRIP ? g.d + ' (' + pct(g.d, g.n) + ')' : g.butts}</td><td>${when(g.last)}</td></tr>`).join('')}</tbody></table></div></div>`
    : `<div class="card empty"><p><b>No reports on the map yet.</b></p><a class="btn" href="#/report">${C.reportCta}</a></div>`;
};

/* ---------- data ---------- */
const table = (rows, cols) => `<div class="tw"><table><thead><tr>${cols.map(c => `<th>${c[0]}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${c[1](r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
VIEWS.data = async () => {
  V().innerHTML = `<h1>Open data</h1>${spinner()}`;
  const g = GEN; const R = await load(); if (g !== GEN) return; const o = stats(R);
  if (!R.length) { V().innerHTML = `<h1>Open data</h1><div class="card empty"><p><b>No reports yet, so there is nothing to show.</b></p><p>Numbers here are counted live from real reports. Nothing is made up.</p><a class="btn" href="#/report">${C.reportCta}</a></div>`; return; }
  const small = R.length < 30 ? `<p class="warn">⚠ Only ${R.length} report${R.length === 1 ? '' : 's'} so far. Too few to draw firm conclusions.</p>` : '';
  V().innerHTML = `<h1>Open data</h1>${small}
   <div class="grid g3"><div class="card stat"><div class="k">${fmtN(o.total)}</div><div class="sub">reports</div></div><div class="card stat"><div class="k">${DRIP ? o.rate : fmtN(o.butts)}</div><div class="sub">${DRIP ? 'drip rate' : 'butts'}</div></div><div class="card stat"><div class="k">${fmtN(o.r30)}</div><div class="sub">reports in 30 days</div></div></div>
   <div class="card"><h3>Last 30 days (${DRIP ? 'reports' : 'butts'})</h3>${bars(o.days)}</div>
   ${DRIP ? `<div class="card"><h2>By brand</h2>${table(o.brands.slice(0, 20), [['Brand', r => esc(r.k)], ['Reports', r => r.n], ['Drips', r => r.d], ['Rate', r => pct(r.d, r.n)], ['Puddle+', r => r.big]])}</div>
     <div class="card"><h2>Drip sizes</h2>${table(o.sizes, [['Size', r => esc(r.k)], ['Reports', r => r.n], ['Share', r => pct(r.n, o.total)]])}</div>`
    : `<div class="card"><h2>By brand</h2>${table(o.brands.slice(0, 20), [['Brand', r => esc(r.k)], ['Reports', r => r.n], ['Butts', r => r.butts], ['Share', r => pct(r.butts, o.butts)]])}</div>
     <div class="card"><h2>Where they're found</h2>${table(o.places, [['Place', r => esc(r.k)], ['Butts', r => r.butts]])}</div>
     <div class="card"><h2>Hot spots (about 500 m squares)</h2>${table(o.hot, [['Area', r => esc(r.area || r.k)], ['Reports', r => r.n], ['Butts', r => r.butts]])}</div>`}
   <div class="card"><h2>AI summary</h2><p class="sub">Free AI reads only the totals above. It can be wrong, so check it against the tables.</p><button class="btn" id="aiSum">✨ Summarize the data</button><div id="aiOut"></div></div>
   <div class="card"><h2>Download</h2><p>Every report, as a CSV file anyone can check.</p><button class="btn alt" id="csv">⬇ Download CSV</button></div>`;
  $('#csv').onclick = () => {
    const cols = DRIP ? ['time', 'station', 'brand', 'osm_id', 'pump', 'size', 'lat', 'lng', 'gps_accuracy_m', 'distance_m', 'photo_hash', 'reporter_key'] : ['time', 'brand', 'count', 'where', 'area', 'lat', 'lng', 'gps_accuracy_m', 'photo_hash', 'reporter_key'];
    const rows = R.map(r => DRIP ? [new Date(r.t).toISOString(), r.st.name, r.st.brand, r.st.id, r.pump, r.size, r.lat, r.lng, r.acc, r.dist, r.ph, r.by] : [new Date(r.t).toISOString(), r.brand, r.n, r.where, r.area, r.lat, r.lng, r.acc, r.ph, r.by]);
    download(C.app + '-reports.csv', [cols, ...rows].map(r => r.map(csvCell).join(',')).join('\n')); toast('CSV downloaded');
  };
  $('#aiSum').onclick = async () => {
    const b = $('#aiSum'); b.disabled = true; $('#aiOut').innerHTML = '<p class="muted">Thinking…</p>';
    const facts = DRIP ? { reports: o.total, reportsLast30Days: o.r30, dripRate: o.rate, sizes: o.sizes, byBrand: o.brands.slice(0, 10).map(x => ({ brand: x.k, reports: x.n, drips: x.d })), worstStations: o.stations.filter(x => x.d).slice(0, 5).map(x => ({ station: x.k, reports: x.n, drips: x.d })) }
      : { reports: o.total, butts: o.butts, reportsLast30Days: o.r30, byBrand: o.brands.slice(0, 10).map(x => ({ brand: x.k, butts: x.butts })), places: o.places.map(x => ({ place: x.k, butts: x.butts })), hotSpots: o.hot.slice(0, 5).map(x => ({ area: x.area || x.k, butts: x.butts })) };
    try {
      const t = await AIHelper.ask(`You summarize crowd-sourced ${C.topic} data for the public. Use ONLY the numbers given. Never invent numbers, places or causes. If there are fewer than 30 reports, say clearly the sample is too small for conclusions. Give 3-5 short bullet points in plain English, then one practical suggestion.`, 'Data: ' + JSON.stringify(facts));
      $('#aiOut').innerHTML = `<div class="aitext">${esc(t).replace(/\n/g, '<br>')}</div>`;
    } catch (e) { $('#aiOut').innerHTML = `<p class="err">The free AI is busy (${esc(e.message)}). Try again in a minute.</p>`; }
    b.disabled = false;
  };
};

/* ---------- my reports ---------- */
VIEWS.me = async () => {
  const M = mine();
  V().innerHTML = `<h1>My reports</h1>
   ${M.length ? `<div class="card"><p>${M.length} report${M.length === 1 ? '' : 's'} sent from this device.</p>${M.map(r => `<div class="item" data-id="${esc(r.id)}"><div><b>${DRIP ? esc(r.st.name) + ' · pump ' + esc(r.pump) : r.n + ' × ' + esc(r.brand)}</b><div class="sub">${DRIP ? esc((sizeOf(r.size) || [, r.size])[1]) : esc(r.where) + (r.area ? ' · ' + esc(r.area) : '')} · ${when(r.t)}${r.gone ? ' · withdrawn' : ''}</div></div>${r.gone ? '' : '<button class="btn small danger" data-wd>Withdraw</button>'}</div>`).join('')}</div>`
    : `<div class="card empty"><p><b>You haven't sent any reports from this device yet.</b></p><a class="btn" href="#/report">${C.reportCta}</a></div>`}
   <div class="card"><h2>Your data</h2><p class="sub">Your reporting key and this list live only in this browser. If you clear site data, you can't withdraw old reports any more.</p>
    <div class="row"><button class="btn alt" id="exp">⬇ Export my reports</button></div>
    <p class="sub">Reporter key (public): <code>${esc(me().slice(0, 16))}…</code></p></div>`;
  V().onclick = async e => {
    const b = e.target.closest('[data-wd]'); if (!b) return;
    const id = b.closest('.item').dataset.id; if (!confirm('Withdraw this report? It will be removed from the public totals.')) return;
    b.disabled = true; b.textContent = 'Withdrawing…';
    try { await S.put(S.deviceKey(), id, [S.T('r')], { deleted: true, t: Date.now() }); const m = mine(); const r = m.find(x => x.id === id); if (r) r.gone = true; saveMine(m); loadedAt = 0; toast('Report withdrawn'); VIEWS.me(); }
    catch (err) { b.disabled = false; b.textContent = 'Withdraw'; toast(err.message); }
  };
  const ex = $('#exp'); if (ex) ex.onclick = () => { download(C.app + '-my-reports.json', JSON.stringify(mine(), null, 2), 'application/json'); toast('Exported'); };
};

/* ---------- about ---------- */
VIEWS.about = async () => {
  V().innerHTML = `<h1>About ${esc(C.name)}</h1><div class="card">${C.about}</div>
   <div class="card"><h2>Rewards</h2><p>There are <b>no cash rewards, prizes or payouts right now</b>. Reporting is free and voluntary.</p></div>
   <div class="card"><h2>How the data is kept honest</h2><ul><li>You must be at the spot: GPS must be accurate to ${MAXACC} m${DRIP ? `, and within ${MAXST} m of a real gas station on OpenStreetMap` : ''}.</li><li>Each device signs its reports. At most ${C.dailyCap || 25} per device per day count.</li><li>A photo can only be used once. Only its fingerprint is shared.</li><li>All reports can be downloaded and checked by anyone.</li></ul></div>
   <div class="card"><h2>Privacy</h2><p>No account, no name, no phone, no tracking. Reports are public: ${DRIP ? 'the station (not your exact spot), pump, drip size and time' : 'brand, count, place, time and location rounded to about 10 m'}. Photos never leave your phone.</p></div>
   <p class="sub">Map data © OpenStreetMap contributors. Free AI by Pollinations. Shared data on public Nostr relays.${TEST ? ' <b>Test area (?ns=test): reports here are kept apart from real data.</b>' : ''}</p>`;
};

/* ---------- start ---------- */
document.addEventListener('click', e => { const a = e.target.closest('[data-ai]'); if (a) { e.preventDefault(); window.AIHelper && AIHelper.open(); } });
window.addEventListener('hashchange', route);
if (TEST) document.body.classList.add('test');
route();
