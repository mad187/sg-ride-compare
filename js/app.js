import { searchAddress, reverseLabel } from './geocode.js';
import { getRoute } from './route.js';
import { loadFares, estimate, fmtRange, fmtSGD } from './fares.js';
import { launchApp, copyText, buildLaunchUrl } from './deeplinks.js';

// ---------- storage ----------
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) {
      return fallback;
    }
  },
  set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  },
};

const KEYS = { settings: 'trc.settings', recents: 'trc.recents', quotes: 'trc.quotes', favs: 'trc.favs' };

// What lands on the clipboard for pasting into provider apps. In Singapore
// the 6-digit postal code is the fastest exact search term everywhere.
function pasteText(place) {
  return place.postal ? place.postal : place.label.replace(/^📍 /, '');
}

// ---------- state ----------
const state = {
  providers: [],
  settings: store.get(KEYS.settings, { enabled: {} }),
  from: null,
  to: null,
  route: null,
  ranked: [],
  activeInput: null,
  run: null, // { order, idx, quotes: {}, trip }
};

const $ = (id) => document.getElementById(id);

function show(screenId) {
  for (const s of document.querySelectorAll('.screen')) s.classList.add('hidden');
  $(screenId).classList.remove('hidden');
}

let toastTimer = null;
function toast(msg, ms = 2500) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

function enabledProviders() {
  return state.providers.filter((p) => state.settings.enabled[p.id] !== false);
}

// ---------- quote memory ----------
const round3 = (n) => Math.round(n * 1000) / 1000;
const routeKey = (from, to) => `${round3(from.lat)},${round3(from.lng)}|${round3(to.lat)},${round3(to.lng)}`;

function timeBucket(date = new Date()) {
  const day = date.getDay();
  const mins = date.getHours() * 60 + date.getMinutes();
  const weekday = day >= 1 && day <= 5;
  if (mins >= 23 * 60 || mins < 6 * 60) return 'night';
  if (weekday && mins >= 7 * 60 && mins < 9.5 * 60) return 'am';
  if (weekday && mins >= 17 * 60 && mins < 20 * 60) return 'pm';
  return 'day';
}

const QUOTE_MAX_AGE_DAYS = 90;

function rememberedQuote(key, bucket, providerId) {
  const cutoff = Date.now() - QUOTE_MAX_AGE_DAYS * 86400e3;
  const all = store
    .get(KEYS.quotes, [])
    .filter((q) => q.routeKey === key && q.provider === providerId && q.ts > cutoff);
  if (!all.length) return null;
  const sameBucket = all.filter((q) => q.bucket === bucket);
  const pool = sameBucket.length ? sameBucket : all;
  const prices = pool.map((q) => q.price).sort((a, b) => a - b);
  const median = prices[Math.floor(prices.length / 2)];
  return { price: median, samples: pool.length, exactBucket: sameBucket.length > 0 };
}

function saveQuotes(trip, quotes) {
  const key = routeKey(trip.from, trip.to);
  const bucket = timeBucket();
  const entries = store.get(KEYS.quotes, []);
  for (const [provider, price] of Object.entries(quotes)) {
    entries.push({ routeKey: key, bucket, provider, price, ts: Date.now() });
  }
  store.set(KEYS.quotes, entries.slice(-300));
}

// ---------- recents ----------
function addRecent(place) {
  const recents = store.get(KEYS.recents, []).filter((r) => r.address !== place.address);
  recents.unshift(place);
  store.set(KEYS.recents, recents.slice(0, 8));
  renderRecents();
}

function renderRecents() {
  const el = $('recents');
  const favs = store.get(KEYS.favs, []);
  const recents = store.get(KEYS.recents, []);
  if ((!favs.length && !recents.length) || (state.from && state.to)) {
    el.innerHTML = '';
    return;
  }
  let html = '';
  if (favs.length) {
    html +=
      '<div class="recents-title">Saved places</div>' +
      favs.map((f, i) => `<button class="chip fav" data-fav="${i}">★ ${f.name}</button>`).join('');
  }
  if (recents.length) {
    html +=
      '<div class="recents-title">Recent places</div>' +
      recents.map((r, i) => `<button class="chip" data-recent="${i}">${r.label}</button>`).join('');
  }
  el.innerHTML = html;
}

function onRecentTap(e) {
  const favBtn = e.target.closest('[data-fav]');
  const recBtn = e.target.closest('[data-recent]');
  let place = null;
  if (favBtn) {
    const fav = store.get(KEYS.favs, [])[Number(favBtn.dataset.fav)];
    if (fav) place = fav.place;
  } else if (recBtn) {
    place = store.get(KEYS.recents, [])[Number(recBtn.dataset.recent)];
  }
  if (!place) return;
  if (!state.from) setPlace('from', place);
  else setPlace('to', place);
}

function saveFavorite(which) {
  const place = state[which];
  if (!place) {
    toast('Pick an address first, then tap ☆ to save it');
    return;
  }
  const suggested = place.label.replace(/^📍 /, '');
  const name = prompt('Name this place (e.g. Home, Office):', suggested);
  if (!name) return;
  const favs = store.get(KEYS.favs, []).filter((f) => f.name !== name.trim());
  favs.push({ name: name.trim(), place });
  store.set(KEYS.favs, favs.slice(0, 12));
  toast(`Saved ★ ${name.trim()}`);
  renderRecents();
}

// ---------- address inputs ----------
let searchTimer = null;
let searchSeq = 0;
let currentSuggestions = { results: [], which: null };

function wireInput(inputEl, which) {
  inputEl.addEventListener('focus', () => (state.activeInput = which));
  inputEl.addEventListener('input', () => {
    state[which] = null;
    hideQuickBook();
    clearTimeout(searchTimer);
    const q = inputEl.value;
    searchTimer = setTimeout(async () => {
      const seq = ++searchSeq;
      const results = await searchAddress(q);
      if (seq !== searchSeq) return; // stale response
      renderSuggestions(results, which);
    }, 250);
  });
}

function renderSuggestions(results, which) {
  const el = $('suggestions');
  currentSuggestions = { results, which };
  if (!results.length) {
    el.classList.add('hidden');
    return;
  }
  el.innerHTML = results
    .map(
      (r, i) => `
      <button class="suggestion" data-i="${i}">
        <div class="s-label">${r.label}</div>
        <div class="s-addr">${r.address}${r.postal ? ' · S' + r.postal : ''}</div>
      </button>`
    )
    .join('');
  el.classList.remove('hidden');
}

function onSuggestionTap(e) {
  const btn = e.target.closest('.suggestion');
  if (!btn) return;
  const { results, which } = currentSuggestions;
  const place = results[Number(btn.dataset.i)];
  if (place && which) setPlace(which, place);
  $('suggestions').classList.add('hidden');
}

function setPlace(which, place) {
  state[which] = place;
  $(which === 'from' ? 'input-from' : 'input-to').value = place.label;
  addRecent(place);
  if (state.from && !state.to) $('input-to').focus();
  maybeCompute();
}

async function useMyLocation() {
  if (!navigator.geolocation) {
    toast('Location not available — type your pickup address');
    return;
  }
  toast('Getting your location…');
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      const label = await reverseLabel(lat, lng);
      setPlace('from', { label: `📍 ${label}`, address: label, postal: '', lat, lng });
    },
    () => toast('Could not get location — type your pickup address'),
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

// ---------- Quick Book ----------
function hideQuickBook() {
  $('quickbook').classList.add('hidden');
}

async function maybeCompute() {
  renderRecents();
  if (!state.from || !state.to) return;
  const summary = $('route-summary');
  $('quickbook').classList.remove('hidden');
  summary.textContent = 'Calculating route…';
  $('estimate-list').innerHTML = '';
  $('btn-book-best').textContent = '…';

  state.route = await getRoute(state.from, state.to);
  const { km, min, approx } = state.route;
  summary.textContent = `${km.toFixed(1)} km · ~${Math.round(min)} min${approx ? ' (approx route)' : ''}`;

  const key = routeKey(state.from, state.to);
  const bucket = timeBucket();
  state.ranked = enabledProviders()
    .map((p) => {
      const est = estimate(p.id, km, min, state.from);
      const mem = rememberedQuote(key, bucket, p.id);
      return {
        provider: p,
        est,
        mem,
        sortPrice: mem ? mem.price : est ? est.mid : Infinity,
      };
    })
    .filter((r) => r.est || r.mem)
    .sort((a, b) => a.sortPrice - b.sortPrice);

  renderQuickBook();
}

function renderQuickBook() {
  if (!state.ranked.length) {
    $('btn-book-best').textContent = 'No apps enabled — check Settings';
    $('estimate-list').innerHTML = '';
    $('btn-check-all').textContent = 'Check all prices';
    return;
  }
  const best = state.ranked[0];
  const bestPrice = best.mem ? `~${fmtSGD(best.mem.price)}` : fmtRange(best.est);
  $('btn-book-best').innerHTML =
    `Book with ${best.provider.name} <span class="price">${bestPrice}</span>` +
    `<span class="sub">${best.mem ? 'usually cheapest on this route' : 'estimated cheapest'}</span>`;

  $('estimate-list').innerHTML = state.ranked
    .map((r, i) => {
      const price = r.mem ? `~${fmtSGD(r.mem.price)}` : fmtRange(r.est);
      const tag = r.mem
        ? `remembered ×${r.mem.samples}`
        : r.est.notes.length
          ? `est · ${r.est.notes.join(', ')}`
          : 'estimate';
      return `
        <button class="est-row ${i === 0 ? 'best' : ''}" data-book="${r.provider.id}">
          <span class="est-dot" style="background:${r.provider.color}"></span>
          <span class="est-name">${r.provider.name} <small>${r.provider.product}</small></span>
          <span class="est-tag">${tag}</span>
          <span class="est-price">${price}</span>
        </button>`;
    })
    .join('');

  const n = enabledProviders().length;
  $('btn-check-all').textContent = `Check all live prices (${n} app${n === 1 ? '' : 's'})`;
}

function currentTrip() {
  return { from: state.from, to: state.to };
}

async function bookWith(providerId) {
  const provider = state.providers.find((p) => p.id === providerId);
  const trip = currentTrip();
  const paste = pasteText(trip.to);
  const copied = await copyText(paste);
  toast(
    provider.prefill
      ? `Opening ${provider.name} with your trip…`
      : `Opening ${provider.name} — "${paste}" copied${copied ? '' : ' FAILED'}, paste into its search`
  );
  const { opened } = await launchApp(provider, trip);
  // Universal-link launches handle the not-installed case themselves
  // (they land on the provider's install page), so no warning needed.
  if (!opened && !provider.universal) {
    toast(`${provider.name} didn't open — is it installed?`, 4000);
  }
}

// ---------- Check-all run ----------
function startRun() {
  const order = enabledProviders();
  if (!order.length) {
    toast('No apps enabled — check Settings');
    return;
  }
  state.run = { order, idx: 0, quotes: {}, trip: currentTrip(), pad: '' };
  show('screen-run');
  launchCurrent();
}

async function launchCurrent() {
  const run = state.run;
  const provider = run.order[run.idx];
  run.pad = '';
  renderRun('Opening…');
  const paste = pasteText(run.trip.to);
  const copied = await copyText(paste);
  const result = await launchApp(provider, run.trip);
  const opened = result.opened || !!provider.universal;
  renderRun(
    opened
      ? `Check the price in ${provider.name}, then come back and tap it in.` +
          (provider.prefill ? '' : ` "${paste}" is on your clipboard — paste into its search.`)
      : `${provider.name} didn't seem to open. Reopen, get it from the App Store, or skip.`
  );
  $('btn-run-appstore').classList.toggle('hidden', opened);
  if (!opened) return;
  if (!provider.prefill) {
    toast(copied ? `"${paste}" copied — paste it in the app` : 'Copy failed — tap Copy address', 3500);
  }
}

function renderRun(hint) {
  const run = state.run;
  const provider = run.order[run.idx];
  $('run-progress').textContent = `${run.idx + 1} of ${run.order.length}`;
  $('run-provider').innerHTML =
    `<span class="est-dot big" style="background:${provider.color}"></span>${provider.name}`;
  if (hint) $('run-hint').textContent = hint;
  $('pad-value').textContent = run.pad || '0';
  $('btn-run-save').disabled = !(parseFloat(run.pad) > 0);
}

function padPress(key) {
  const run = state.run;
  if (!run) return;
  if (key === 'back') run.pad = run.pad.slice(0, -1);
  else if (key === '.') {
    if (!run.pad.includes('.')) run.pad = (run.pad || '0') + '.';
  } else if (run.pad.replace('.', '').length < 5) {
    run.pad = run.pad === '0' ? key : run.pad + key;
  }
  renderRun();
}

function advanceRun(savePrice) {
  const run = state.run;
  const provider = run.order[run.idx];
  if (savePrice) {
    const price = parseFloat(run.pad);
    if (!(price > 0)) return;
    run.quotes[provider.id] = price;
  }
  run.idx += 1;
  if (run.idx < run.order.length) {
    launchCurrent();
  } else {
    finishRun();
  }
}

function finishRun() {
  const run = state.run;
  const entries = Object.entries(run.quotes)
    .map(([id, price]) => ({ provider: state.providers.find((p) => p.id === id), price }))
    .sort((a, b) => a.price - b.price);
  show('screen-report');
  if (!entries.length) {
    $('report-list').innerHTML = '<p class="run-hint">No prices entered.</p>';
    $('btn-report-book').classList.add('hidden');
    return;
  }
  saveQuotes(run.trip, run.quotes);
  $('report-list').innerHTML = entries
    .map(
      (e, i) => `
      <div class="est-row static ${i === 0 ? 'best' : ''}">
        <span class="est-dot" style="background:${e.provider.color}"></span>
        <span class="est-name">${e.provider.name}</span>
        ${i === 0 ? '<span class="est-tag">cheapest</span>' : ''}
        <span class="est-price">${fmtSGD(e.price)}</span>
      </div>`
    )
    .join('');
  const winner = entries[0];
  const btn = $('btn-report-book');
  btn.classList.remove('hidden');
  btn.innerHTML = `Book with ${winner.provider.name} <span class="price">${fmtSGD(winner.price)}</span>`;
  btn.onclick = () => bookWith(winner.provider.id);
}

// ---------- settings ----------
function renderSettings() {
  $('provider-toggles').innerHTML = state.providers
    .map((p) => {
      const on = state.settings.enabled[p.id] !== false;
      return `
      <label class="toggle-row">
        <span class="est-dot" style="background:${p.color}"></span>
        <span class="est-name">${p.name} <small>${p.product}</small></span>
        <input type="checkbox" data-provider="${p.id}" ${on ? 'checked' : ''} />
        <span class="switch"></span>
      </label>`;
    })
    .join('');
  $('provider-toggles')
    .querySelectorAll('input[data-provider]')
    .forEach((cb) =>
      cb.addEventListener('change', () => {
        state.settings.enabled[cb.dataset.provider] = cb.checked;
        store.set(KEYS.settings, state.settings);
      })
    );
  renderFavList();
}

function renderFavList() {
  const favs = store.get(KEYS.favs, []);
  $('fav-list').innerHTML = favs.length
    ? favs
        .map(
          (f, i) => `
      <div class="toggle-row">
        <span class="est-name">★ ${f.name} <small>${f.place.label.replace(/^📍 /, '')}</small></span>
        <button class="small-btn" data-del-fav="${i}">Remove</button>
      </div>`
        )
        .join('')
    : '<p class="fine-print">No saved places yet.</p>';
}

// ---------- init ----------
async function init() {
  const [providersData] = await Promise.all([
    fetch('./providers.json').then((r) => r.json()),
    loadFares(),
  ]);
  state.providers = providersData.providers;

  wireInput($('input-from'), 'from');
  wireInput($('input-to'), 'to');
  $('suggestions').addEventListener('click', onSuggestionTap);
  $('recents').addEventListener('click', onRecentTap);
  $('estimate-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-book]');
    if (btn) bookWith(btn.dataset.book);
  });
  $('btn-locate').addEventListener('click', useMyLocation);
  $('btn-fav-from').addEventListener('click', () => saveFavorite('from'));
  $('btn-fav-to').addEventListener('click', () => saveFavorite('to'));
  $('fav-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-del-fav]');
    if (!btn) return;
    const favs = store.get(KEYS.favs, []);
    favs.splice(Number(btn.dataset.delFav), 1);
    store.set(KEYS.favs, favs);
    renderFavList();
    renderRecents();
  });
  $('btn-run-copy').addEventListener('click', async () => {
    const paste = pasteText(state.run.trip.to);
    const ok = await copyText(paste);
    toast(ok ? `"${paste}" copied` : 'Copy failed — long-press to type it', 2500);
  });
  $('btn-swap').addEventListener('click', () => {
    [state.from, state.to] = [state.to, state.from];
    $('input-from').value = state.from ? state.from.label : '';
    $('input-to').value = state.to ? state.to.label : '';
    maybeCompute();
  });
  $('btn-clear-to').addEventListener('click', () => {
    state.to = null;
    $('input-to').value = '';
    hideQuickBook();
    renderRecents();
    $('input-to').focus();
  });
  $('btn-book-best').addEventListener('click', () => {
    if (state.ranked.length) bookWith(state.ranked[0].provider.id);
  });
  $('btn-check-all').addEventListener('click', startRun);

  // run screen
  document.querySelectorAll('.pad-key').forEach((btn) =>
    btn.addEventListener('click', () => padPress(btn.dataset.key))
  );
  $('btn-run-save').addEventListener('click', () => advanceRun(true));
  $('btn-run-skip').addEventListener('click', () => advanceRun(false));
  $('btn-run-reopen').addEventListener('click', launchCurrent);
  $('btn-run-appstore').addEventListener('click', () => {
    const provider = state.run.order[state.run.idx];
    window.open(provider.appStore, '_blank');
  });
  $('btn-run-cancel').addEventListener('click', () => {
    state.run = null;
    show('screen-home');
  });

  // report screen
  $('btn-report-done').addEventListener('click', () => {
    state.run = null;
    show('screen-home');
    maybeCompute();
  });

  // settings
  $('btn-settings').addEventListener('click', () => {
    renderSettings();
    show('screen-settings');
  });
  $('btn-settings-back').addEventListener('click', () => {
    show('screen-home');
    maybeCompute();
  });
  $('btn-clear-history').addEventListener('click', () => {
    localStorage.removeItem(KEYS.quotes);
    localStorage.removeItem(KEYS.recents);
    toast('Saved quotes and recents cleared');
    renderRecents();
  });

  renderRecents();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

init();
