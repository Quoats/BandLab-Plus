// Bandlab+ theme manager. The active theme lives in storage key 'bp:theme' (theme.js and
// content.js react to it live); saved user themes live in 'bp:themes'.
'use strict';

const PRESETS = [
  { id: 'p_midnight', name: 'Midnight', colors: { primary: '#0b0f1a', secondary: '#121a2b', accent: '#5b8cff', text: '#e6ecff', waveform1: '#8fb3ff' } },
  { id: 'p_ember', name: 'Ember', colors: { primary: '#160b08', secondary: '#24120c', accent: '#ff6a3d', text: '#ffe9e0', waveform1: '#ffb08f' } },
  { id: 'p_ruby', name: 'Ruby', colors: { primary: '#1a0509', secondary: '#2a0a10', accent: '#ff3b5c', text: '#ffe3e8', waveform1: '#ff8fa3' } },
  { id: 'p_sakura', name: 'Sakura', colors: { primary: '#1a0c14', secondary: '#2a1220', accent: '#ff79c6', text: '#ffe6f3', waveform1: '#ffb3dd' } },
  { id: 'p_grape', name: 'Grape', colors: { primary: '#140a1f', secondary: '#1f1030', accent: '#b46bff', text: '#f1e6ff', waveform1: '#d3a6ff' } },
  { id: 'p_ocean', name: 'Ocean', colors: { primary: '#04161c', secondary: '#08242d', accent: '#22d3ee', text: '#e0fbff', waveform1: '#7ee8f7' } },
  { id: 'p_forest', name: 'Forest', colors: { primary: '#08140d', secondary: '#0f2318', accent: '#3ddc84', text: '#e3fff0', waveform1: '#8ff0b8' } },
  { id: 'p_mono', name: 'Mono', colors: { primary: '#111111', secondary: '#1c1c1c', accent: '#bbbbbb', text: '#f2f2f2', waveform1: '#ffffff' } },
  { id: 'p_paper', name: 'Paper', colors: { primary: '#f4f1ea', secondary: '#e8e3d8', accent: '#d9480f', text: '#1f1b16', waveform1: '#3a3a3a' } },
  { id: 'p_rainbow', name: 'Rainbow', isAnimated: true, colors: { primary: '#141414', secondary: '#1e1e1e', accent: '#ff4fa3', text: '#ffffff', waveform1: '#ffffff' } },
];
PRESETS.forEach((p) => { p.preset = true; });

const $ = (id) => document.getElementById(id);
const clone = (o) => JSON.parse(JSON.stringify(o));
const store = chrome.storage.local;

let library = [];   // user themes
let active = null;  // the theme currently applied (possibly edited and unsaved)
let saved = null;   // JSON of the saved version of `active`, to show "unsaved"

if (new URLSearchParams(location.search).has('tab')) document.body.classList.add('tab');

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 1600);
}

let pushTimer = 0;
function pushActive(now = false) {
  clearTimeout(pushTimer);
  const go = () => store.set({ 'bp:theme': active });
  if (now) go(); else pushTimer = setTimeout(go, 60);
}

function preview(t) {
  const el = document.createElement('div');
  el.className = 'preview';
  if (!t) { el.classList.add('off'); return el; }
  const c = t.colors;
  el.style.background = c.primary;
  if (t.isAnimated) el.classList.add('rainbow');
  el.innerHTML = '<div class="side"></div><div class="line"></div><div class="wave"></div><div class="dot"></div>';
  el.querySelector('.side').style.background = c.secondary;
  el.querySelector('.line').style.background = c.text;
  el.querySelector('.dot').style.background = c.accent;
  const w = el.querySelector('.wave');
  w.style.background = t.waveOn ? c.waveform1 : c.accent;
  w.style.opacity = t.waveOn ? 1 : 0.55;
  return el;
}

function renderGrid() {
  const grid = $('grid');
  grid.textContent = '';
  const items = [null, ...PRESETS, ...library];
  for (const t of items) {
    const b = document.createElement('button');
    b.className = 'card';
    if ((t?.id ?? null) === (active?.id ?? null)) b.classList.add('active');
    b.appendChild(preview(t && t.id === active?.id ? active : t));
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = t ? t.name : 'BandLab default';
    if (t && !t.preset) label.insertAdjacentHTML('beforeend', ' <small>· mine</small>');
    b.appendChild(label);
    b.addEventListener('click', () => select(t));
    grid.appendChild(b);
  }
}

function renderEditor() {
  $('editor').hidden = !active;
  if (!active) return;
  for (const input of document.querySelectorAll('input[type=color]')) {
    input.value = active.colors[input.dataset.k] || '#ffffff';
  }
  $('animated').checked = !!active.isAnimated;
  $('waveOn').checked = !!active.waveOn;
  $('name').value = active.preset ? '' : active.name;
  $('name').placeholder = active.preset ? `My ${active.name}` : 'Theme name';
  $('save').hidden = !!active.preset;
  $('del').hidden = !!active.preset;
  $('dirty').hidden = JSON.stringify(active) === saved;
}

function render() { renderGrid(); renderEditor(); }

function select(t) {
  active = t ? clone(t) : null;
  saved = JSON.stringify(active);
  pushActive(true);
  render();
}

function edited() {
  pushActive();
  $('dirty').hidden = JSON.stringify(active) === saved;
  renderGrid();
}

for (const input of document.querySelectorAll('input[type=color]')) {
  input.addEventListener('input', () => {
    active.colors[input.dataset.k] = input.value;
    edited();
  });
}
$('animated').addEventListener('change', (e) => { active.isAnimated = e.target.checked; edited(); });
$('waveOn').addEventListener('change', (e) => { active.waveOn = e.target.checked; edited(); });

function saveLibrary(done) { store.set({ 'bp:themes': library }, done); }

$('save').addEventListener('click', () => {
  const name = $('name').value.trim();
  if (name) active.name = name;
  const i = library.findIndex((t) => t.id === active.id);
  if (i < 0) return $('saveNew').click();
  library[i] = clone(active);
  saved = JSON.stringify(active);
  saveLibrary(() => { pushActive(true); render(); toast('Saved'); });
});

$('saveNew').addEventListener('click', () => {
  const name = $('name').value.trim() || $('name').placeholder || 'My theme';
  const t = clone(active);
  t.id = `u_${Date.now()}`;
  t.name = name;
  delete t.preset;
  library.push(t);
  active = clone(t);
  saved = JSON.stringify(active);
  saveLibrary(() => { pushActive(true); render(); toast(`Saved “${name}”`); });
});

$('del').addEventListener('click', () => {
  const b = $('del');
  if (b.dataset.armed !== '1') {
    b.dataset.armed = '1';
    b.textContent = 'Sure?';
    setTimeout(() => { b.dataset.armed = ''; b.textContent = 'Delete'; }, 2500);
    return;
  }
  library = library.filter((t) => t.id !== active.id);
  b.dataset.armed = '';
  b.textContent = 'Delete';
  saveLibrary(() => { select(null); toast('Deleted'); });
});

// ---------- import / export ----------
const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
function normHex(v) {
  if (typeof v !== 'string' || !HEX.test(v.trim())) return null;
  let h = v.trim().replace('#', '').toLowerCase();
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  return `#${h}`;
}
function importTheme(data) {
  const list = Array.isArray(data) ? data : [data];
  let last = null;
  for (const d of list) {
    const c = d && d.colors;
    if (!c) continue;
    const colors = {};
    for (const k of ['primary', 'secondary', 'accent', 'text', 'waveform1']) {
      colors[k] = normHex(c[k]) || PRESETS[0].colors[k];
    }
    last = {
      id: `u_${Date.now()}_${library.length}`,
      name: String(d.name || 'Imported theme').slice(0, 40),
      colors,
      isAnimated: !!d.isAnimated,
      waveOn: d.waveOn ?? !!normHex(c.waveform1),
    };
    library.push(last);
  }
  if (!last) return toast('No colors found in that file');
  saveLibrary(() => { select(last); toast(`Imported “${last.name}”`); });
}

$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try { importTheme(JSON.parse(await f.text())); } catch { toast('That file isn’t valid theme JSON'); }
  e.target.value = '';
});
$('pasteBtn').addEventListener('click', () => {
  try { importTheme(JSON.parse($('paste').value)); $('paste').value = ''; } catch { toast('That isn’t valid theme JSON'); }
});

$('export').addEventListener('click', () => {
  if (!active) return toast('Pick a theme first');
  const name = $('name').value.trim() || active.name;
  const out = { name, type: 'custom', colors: active.colors, isAnimated: !!active.isAnimated, waveOn: !!active.waveOn };
  const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'theme'}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$('popout').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?tab') });
  window.close();
});

// ---------- tabs ----------
const remember = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const recall = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
function showTab(name) {
  for (const t of document.querySelectorAll('.tab')) t.hidden = t.dataset.tab !== name;
  for (const b of document.querySelectorAll('.tab-btn')) b.classList.toggle('on', b.dataset.tab === name);
  remember('bp:tab', name);
}
for (const b of document.querySelectorAll('.tab-btn')) b.addEventListener('click', () => showTab(b.dataset.tab));
showTab(document.querySelector(`.tab[data-tab="${recall('bp:tab')}"]`) ? recall('bp:tab') : 'themes');

// ---------- layout ----------
const LAYOUT_DEFAULTS = { focus: false };
let layout = { ...LAYOUT_DEFAULTS };
let layoutTimer = 0;
function pushLayout() {
  clearTimeout(layoutTimer);
  layoutTimer = setTimeout(() => store.set({ 'bp:layout': layout }), 40);
}
function renderLayout() {
  $('focus').checked = !!layout.focus;
}
$('focus').addEventListener('change', (e) => { layout.focus = e.target.checked; pushLayout(); });
store.get('bp:layout', (r) => { layout = { ...LAYOUT_DEFAULTS, ...r['bp:layout'] }; renderLayout(); });
chrome.storage.onChanged.addListener((ch, area) => {
  // Focus can also be toggled from the page with Ctrl+Shift+F.
  if (area === 'local' && ch['bp:layout']) { layout = { ...LAYOUT_DEFAULTS, ...ch['bp:layout'].newValue }; renderLayout(); }
});

// ---------- audio: one mic and Channel 1 + 2 for every track (applied by monitor.js) ----------
let audio = { micName: '', micId: '', stereo: true };
let mics = [];
function renderAudio() {
  const box = $('mics');
  box.textContent = '';
  const rows = [{ name: '', deviceId: '', label: 'BandLab\'s default (don\'t change it)' }, ...mics];
  for (const m of rows) {
    const row = document.createElement('button');
    row.className = 'mic';
    const chosen = m.name ? (audio.micId === m.deviceId || audio.micName === m.name) : !audio.micName;
    row.classList.toggle('on', chosen);
    row.textContent = m.label || m.name;
    row.title = m.name || 'Leave the microphone as BandLab sets it';
    row.addEventListener('click', () => {
      audio = { ...audio, micName: m.name, micId: m.deviceId };
      store.set({ 'bp:audio': audio });
      renderAudio();
    });
    box.appendChild(row);
  }
  // The chosen mic isn't plugged in right now: still show it, so the choice is visible.
  if (audio.micName && !mics.some((m) => m.name === audio.micName)) {
    const row = document.createElement('div');
    row.className = 'mic on missing';
    row.textContent = `${audio.micName} (not connected)`;
    box.appendChild(row);
  }
  $('micsHint').textContent = mics.length
    ? 'Used on every track: set when a project opens and whenever you switch tracks.'
    : 'Open a project in BandLab Studio once and your mics will show up here.';
  $('stereo').checked = audio.stereo !== false;
}
$('stereo').addEventListener('change', (e) => {
  audio = { ...audio, stereo: e.target.checked };
  store.set({ 'bp:audio': audio });
});
store.get(['bp:audio', 'bp:mics'], (r) => {
  audio = { ...audio, ...r['bp:audio'] };
  mics = r['bp:mics'] || [];
  renderAudio();
});
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && ch['bp:mics']) { mics = ch['bp:mics'].newValue || []; renderAudio(); }
});

store.get(['bp:theme', 'bp:themes'], (r) => {
  library = r['bp:themes'] || [];
  active = r['bp:theme'] || null;
  const savedVersion = active && (library.find((t) => t.id === active.id) || PRESETS.find((t) => t.id === active.id));
  saved = JSON.stringify(savedVersion || active);
  render();
});
