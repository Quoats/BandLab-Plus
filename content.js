// Bandlab+ — extra track colors for BandLab Studio. Purely visual, client-side.
//
// How it works without knowing BandLab's markup:
//  - A track header is found by climbing up from its "M" (mute) button.
//  - Each track keeps its native BandLab color; we remember that color's hue and
//    repaint every element inside the track's horizontal band whose color has that
//    hue (header pill, clip backgrounds, selection tint...).
//  - Waveforms are BandLab's canvases. They're only ever recolored with a CSS color filter,
//    which changes pixel colors but can't move a pixel, so they stay 1:1 with the audio.
function bandlabPlus() {
  'use strict';
  const TAG = '[Bandlab+]';
  // 10-column grid, one hue per column: vivid, pastel, deep rows, then neutrals (+ picker and reset).
  const HUES = [355, 25, 52, 85, 140, 185, 210, 240, 275, 320];
  const hex = (h, s, l) => '#' + hslToRgb([h, s, l]).map((v) => v.toString(16).padStart(2, '0')).join('');
  const PRESETS = [
    ...HUES.map((h) => hex(h, 1, 0.55)),
    ...HUES.map((h) => hex(h, 0.9, 0.82)),
    ...HUES.map((h) => hex(h, 0.7, 0.28)),
    '#ffffff', '#d4d4d8', '#a1a1aa', '#71717a', '#3f3f46', '#18181b', '#7a4a1f', '#c2a878',
  ];
  const PROPS = [
    'background-color', 'color', 'fill', 'stroke', 'stop-color',
    'border-top-color', 'border-bottom-color', 'border-left-color', 'border-right-color',
  ];

  let projectId;             // the studio's ?id= (undefined while off the studio)
  let colors = {};          // trackKey -> { native: [h,s,l], custom: '#rrggbb', wave: '#rrggbb' }
  let mode = 'track';       // which part the menu's swatches color: 'track' or 'wave'
  let themeWave = null;     // the theme's waveform color, used for tracks without their own
  let target = null;        // { key } for the track whose menu is open
  let themeRgb = [];        // theme surface colors, never mistaken for a track color
  const orig = new Map();   // el -> { prop: { inline, prio, computed } }

  // ---------- color math ----------
  function parseColor(str) {
    const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?/.exec(str || '');
    if (!m) return null;
    let a = m[4] === undefined ? 1 : parseFloat(m[4]);
    if (m[4] && m[4].endsWith('%')) a /= 100;
    return { r: +m[1], g: +m[2], b: +m[3], a };
  }
  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return { r: n >> 16, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  function rgbToHsl({ r, g, b }) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  }
  function hslToRgb([h, s, l]) {
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
  }
  const clamp = (v) => Math.max(0, Math.min(1, v));
  // Move v the same "distance" that native -> custom moved, keeping 0 and 1 fixed.
  function shift(v, from, to) {
    if (to <= from) return from > 0 ? v * (to / from) : v;
    return from < 1 ? v + (1 - v) * ((to - from) / (1 - from)) : v;
  }
  function hueDist(a, b) { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); }
  function matchesNative(hsl, native) {
    return hsl[1] >= 0.18 && hsl[2] > 0.05 && hsl[2] < 0.97 && hueDist(hsl[0], native[0]) <= 14;
  }
  const isThemeColor = (c) => themeRgb.some((t) => Math.abs(t.r - c.r) + Math.abs(t.g - c.g) + Math.abs(t.b - c.b) < 12);
  function setTheme(theme) {
    const c = theme?.colors || {};
    themeRgb = theme && !theme.isAnimated
      ? [c.primary, c.secondary, c.accent].filter((x) => /^#[0-9a-f]{6}$/i.test(x || '')).map(hexToRgb)
      : [];
    themeWave = theme?.waveOn && /^#[0-9a-f]{6}$/i.test(c.waveform1 || '') ? c.waveform1 : null;
    schedule();
  }
  function remap(rgba, native, customHsl) {
    const [, s, l] = rgbToHsl(rgba);
    const out = [customHsl[0], clamp(shift(s, native[1], customHsl[1])), clamp(shift(l, native[2], customHsl[2]))];
    const [r, g, b] = hslToRgb(out);
    return `rgba(${r}, ${g}, ${b}, ${rgba.a})`;
  }

  // ---------- track discovery ----------
  function muteButtons() {
    let out = [...document.querySelectorAll('button, [role="button"]')]
      .filter((el) => /^m$/i.test(el.textContent.trim()) && !el.closest('[data-bp]'));
    if (!out.length) {
      out = [...document.querySelectorAll('body *')]
        .filter((el) => el.childElementCount === 0 && /^m$/i.test(el.textContent.trim()));
    }
    return out;
  }
  function getHeaders() {
    // Fast path: BandLab's own header elements, each widened to its whole track row (the
    // largest block holding just that one header), as the mute-button search below would.
    const hs = [...document.querySelectorAll('.mix-editor-track-header')];
    if (hs.length) {
      return hs.map((x) => {
        let h = x;
        for (let p = h.parentElement; p && p !== document.body; p = p.parentElement) {
          if (p.querySelectorAll('.mix-editor-track-header').length > 1 || p.getBoundingClientRect().height > 250) break;
          h = p;
        }
        return h;
      });
    }
    const ms = muteButtons();
    return ms.map((m) => {
      let h = m;
      for (;;) {
        const p = h.parentElement;
        if (!p || p === document.body) break;
        if (ms.some((o) => o !== m && p.contains(o))) break;
        if (p.getBoundingClientRect().height > 250) break;
        h = p;
      }
      return h;
    });
  }
  // A track's key: its BandLab track id (the header's data-id), which stays the same through
  // moves, renames and renumbering. Falls back to the header's label ("02 Jealousy").
  function trackIdOf(h) {
    const el = h.matches?.('.mix-editor-track-header[data-id]') ? h
      : h.querySelector('.mix-editor-track-header[data-id]') || h.closest('.mix-editor-track-header[data-id]');
    return el?.dataset.id || '';
  }
  function keyOf(h) {
    const id = trackIdOf(h);
    return id ? `id:${id}` : labelOf(h);
  }
  function labelOf(h) {
    const lines = (h.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const out = [];
    for (const l of lines) {
      if (/^fx\b/i.test(l) || l === 'M' || l === 'S') break;
      out.push(l);
      if (out.length === 2 || /^\d+\s+\S/.test(l)) break;
    }
    return out.join(' ');
  }
  function headerAt(el, y) {
    const hs = getHeaders();
    return hs.find((h) => h.contains(el)) || hs.find((h) => {
      const r = h.getBoundingClientRect();
      return y >= r.top && y <= r.bottom;
    }) || null;
  }
  // The track's current BandLab color = the most saturated solid background in its header.
  function detectNative(h) {
    let best = null;
    for (const el of [h, ...h.querySelectorAll('*')]) {
      const c = parseColor(getComputedStyle(el).backgroundColor);
      if (!c || c.a < 0.5) continue;
      const hsl = rgbToHsl(c);
      if (hsl[1] > 0.35 && hsl[2] > 0.2 && hsl[2] < 0.85 && (!best || hsl[1] > best[1])) best = hsl;
    }
    return best;
  }

  // ---------- repainting ----------
  function rectOf(el) {
    let r = el.getBoundingClientRect();
    if (!r.width && !r.height && el.ownerSVGElement) r = el.ownerSVGElement.getBoundingClientRect();
    return r;
  }
  function record(el, prop, computed) {
    let rec = orig.get(el);
    if (!rec) orig.set(el, (rec = {}));
    if (!rec[prop]) {
      rec[prop] = { inline: el.style.getPropertyValue(prop), prio: el.style.getPropertyPriority(prop), computed };
    }
    return rec[prop];
  }
  function restore(el) {
    const rec = orig.get(el);
    if (!rec) return;
    for (const [prop, r] of Object.entries(rec)) {
      if (r.inline) el.style.setProperty(prop, r.inline, r.prio);
      else el.style.removeProperty(prop);
    }
    orig.delete(el);
  }

  // BandLab colors a track through variables set by its .studio-accent-color-<name> class;
  // pseudo-elements (selection highlight, edge glow) only follow those, not inline colors.
  function accentVars(hex) {
    return {
      '--accent-color': hex,
      '--accent-color-20': `${hex}33`,
      '--accent-color-50': `${hex}80`,
      '--accent-color-feedback': `color-mix(in srgb, ${hex} 80%, #000)`,
      '--accent-color-text': `color-mix(in srgb, ${hex} 70%, #fff)`,
    };
  }

  // Waveforms are canvases. To paint them one exact color we flatten them to black and then
  // run CSS filter functions solved to land on the target color. (No SVG url() filter: Chrome
  // renders those through a size-limited region, which cut off and shifted wide waveforms.)
  // The math mirrors the CSS filter spec; the solver is plain SPSA optimisation.
  class FilterColor {
    constructor(r, g, b) { this.set(r, g, b); }
    set(r, g, b) { this.r = cl(r); this.g = cl(g); this.b = cl(b); }
    mult(m) {
      const { r, g, b } = this;
      this.set(r * m[0] + g * m[1] + b * m[2], r * m[3] + g * m[4] + b * m[5], r * m[6] + g * m[7] + b * m[8]);
    }
    hueRotate(deg) {
      const a = (deg / 180) * Math.PI, s = Math.sin(a), c = Math.cos(a);
      this.mult([
        0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
        0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283,
        0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
      ]);
    }
    sepia(v) {
      this.mult([
        0.393 + 0.607 * (1 - v), 0.769 - 0.769 * (1 - v), 0.189 - 0.189 * (1 - v),
        0.349 - 0.349 * (1 - v), 0.686 + 0.314 * (1 - v), 0.168 - 0.168 * (1 - v),
        0.272 - 0.272 * (1 - v), 0.534 - 0.534 * (1 - v), 0.131 + 0.869 * (1 - v),
      ]);
    }
    saturate(v) {
      this.mult([
        0.213 + 0.787 * v, 0.715 - 0.715 * v, 0.072 - 0.072 * v,
        0.213 - 0.213 * v, 0.715 + 0.285 * v, 0.072 - 0.072 * v,
        0.213 - 0.213 * v, 0.715 - 0.715 * v, 0.072 + 0.928 * v,
      ]);
    }
    linear(slope, icept = 0) { this.set(this.r * slope + icept * 255, this.g * slope + icept * 255, this.b * slope + icept * 255); }
    invert(v) {
      this.set((v + (this.r / 255) * (1 - 2 * v)) * 255, (v + (this.g / 255) * (1 - 2 * v)) * 255, (v + (this.b / 255) * (1 - 2 * v)) * 255);
    }
  }
  function cl(v) { return Math.max(0, Math.min(255, v)); }

  const filterCache = new Map();
  function waveFilter(hex) {
    if (filterCache.has(hex)) return filterCache.get(hex);
    const t = hexToRgb(hex);
    const th = rgbToHsl(t);
    const MAX = [100, 100, 7500, 100, 200, 200];
    const apply = (f) => {
      const c = new FilterColor(0, 0, 0);
      c.invert(f[0] / 100); c.sepia(f[1] / 100); c.saturate(f[2] / 100);
      c.hueRotate(f[3] * 3.6); c.linear(f[4] / 100); c.linear(f[5] / 100, -(0.5 * f[5] / 100) + 0.5);
      return c;
    };
    const loss = (f) => {
      const c = apply(f);
      const h = rgbToHsl(c);
      return Math.abs(c.r - t.r) + Math.abs(c.g - t.g) + Math.abs(c.b - t.b)
        + Math.abs(h[0] - th[0]) / 3.6 + Math.abs(h[1] - th[1]) * 100 + Math.abs(h[2] - th[2]) * 100;
    };
    const fix = (v, i) => {
      if (i === 3) return ((v % 100) + 100) % 100;
      return Math.max(0, Math.min(MAX[i], v));
    };
    const spsa = (A, a, c, start, iters) => {
      const v = start.slice();
      let best = v.slice(), bestLoss = Infinity;
      for (let k = 0; k < iters; k++) {
        const ck = c / Math.pow(k + 1, 1 / 6);
        const d = v.map(() => (Math.random() > 0.5 ? 1 : -1));
        const hi = v.map((x, i) => x + ck * d[i]);
        const lo = v.map((x, i) => x - ck * d[i]);
        const diff = loss(hi) - loss(lo);
        for (let i = 0; i < 6; i++) v[i] = fix(v[i] - (a[i] / (A + k + 1)) * (diff / (2 * ck)) * d[i], i);
        const l = loss(v);
        if (l < bestLoss) { best = v.slice(); bestLoss = l; }
      }
      return { values: best, loss: bestLoss };
    };
    let best = { loss: Infinity };
    for (let tries = 0; tries < 30 && best.loss > 1; tries++) {
      const wide = spsa(5, [60, 180, 18000, 600, 1.2, 1.2], 15, [50, 20, 3750, 50, 100, 100], 1000);
      const A = wide.loss, A1 = A + 1;
      const narrow = spsa(A, [0.25 * A1, 0.25 * A1, A1, 0.25 * A1, 0.2 * A1, 0.2 * A1], 2, wide.values, 500);
      if (narrow.loss < best.loss) best = narrow;
    }
    const f = best.values.map((x) => Math.round(x * 10) / 10);
    const css = `brightness(0) saturate(100%) invert(${f[0]}%) sepia(${f[1]}%) saturate(${f[2]}%) `
      + `hue-rotate(${Math.round(f[3] * 3.6)}deg) brightness(${f[4]}%) contrast(${f[5]}%)`;
    filterCache.set(hex, css);
    return css;
  }

  // Per-track rules keyed on a data-bp-t attribute we put on BandLab's track containers.
  // Containers survive timeline zoom while clips/canvases get rebuilt, and the new ones
  // pick up these rules instantly instead of flashing until the next paint.
  const trackStyle = document.createElement('style');
  trackStyle.dataset.bp = '';
  document.documentElement.appendChild(trackStyle);
  const CONTAINER = /studio-accent-color-|mix-editor-track-inner/;

  function trackRules(bands) {
    let css = themeWave ? `.mix-editor-region :is(.mix-editor-region-waveform, canvas) { filter: ${waveFilter(themeWave)} !important; }\n` : '';
    for (const b of bands) {
      const sel = `[data-bp-t="${CSS.escape(b.key)}"]`;
      if (b.vars) {
        css += `${sel} { ${Object.entries(b.vars).map(([k, v]) => `${k}: ${v} !important;`).join(' ')} }\n`;
        // The live recording bar is BandLab's blue whatever the track's colour; give it the track's.
        css += `${sel} .mix-editor-region-recording, ${sel} .mix-editor-record-take-placeholder { --region-background-color: ${b.vars['--accent-color']} !important; background-color: ${b.vars['--accent-color']} !important; }\n`;
      }
      if (b.wave) css += `${sel} .mix-editor-region :is(.mix-editor-region-waveform, canvas) { filter: ${waveFilter(b.wave)} !important; }\n`;
    }
    return css;
  }

  function paint() {
    const bands = [];
    if (Object.keys(colors).length) {
      for (const h of getHeaders()) {
        const key = keyOf(h);
        const c = colors[key];
        const tint = c?.custom && c.native;
        if (!tint && !c?.wave) continue;
        const r = h.getBoundingClientRect();
        bands.push({
          key, top: r.top, bottom: r.bottom, native: c.native, wave: c.wave,
          hsl: tint ? rgbToHsl(hexToRgb(c.custom)) : null, vars: tint ? accentVars(c.custom) : null,
        });
      }
    }
    const css = trackRules(bands);
    if (trackStyle.textContent !== css) trackStyle.textContent = css;
    const tagged = new Set();
    const seen = new Set();
    if (bands.length) {
      // Only inside the editor: tracks never live in the page around it.
      const scope = document.querySelector('.state-mixeditor, .state-playground-mixeditor') || document.body;
      for (const el of scope.querySelectorAll('*')) {
        // Canvases/images (waveforms) are BandLab's; only the stylesheet's color filter reaches them.
        if (el.tagName === 'CANVAS' || el.tagName === 'IMG' || el.tagName === 'VIDEO') continue;
        if (el.closest('[data-bp], [data-bp-menu]')) continue;
        const r = rectOf(el);
        if (!r.width && !r.height) continue;
        const b = bands.find((b) => r.top >= b.top - 1 && r.bottom <= b.bottom + 1);
        if (!b) continue;
        if (CONTAINER.test(el.className?.baseVal ?? el.className)) {
          if (el.getAttribute('data-bp-t') !== b.key) el.setAttribute('data-bp-t', b.key);
          tagged.add(el);
        }
        if (!b.hsl) continue;
        let cs = null;
        for (const prop of PROPS) {
          const prev = orig.get(el)?.[prop];
          let computed = prev?.computed;
          if (computed === undefined) computed = (cs ||= getComputedStyle(el)).getPropertyValue(prop);
          const c = parseColor(computed);
          if (!c || c.a === 0 || isThemeColor(c) || !matchesNative(rgbToHsl(c), b.native)) continue;
          record(el, prop, computed);
          el.style.setProperty(prop, remap(c, b.native, b.hsl), 'important');
          seen.add(el);
        }
      }
    }
    for (const el of [...orig.keys()]) if (!seen.has(el)) restore(el);
    for (const el of document.querySelectorAll('[data-bp-t]')) {
      if (!tagged.has(el)) el.removeAttribute('data-bp-t');
    }
  }

  // After the extension is reloaded or updated, this copy keeps running in already-open
  // tabs but can no longer reach chrome.storage; it shuts itself down instead of throwing.
  let dead = false;
  const alive = () => {
    if (!dead && !chrome.runtime?.id) {
      dead = true;
      observer.disconnect();
      clearInterval(tick);
    }
    return !dead;
  };

  // One pass at most every 80ms, and less often when a pass is slow (huge projects), so this
  // never eats into the frame time BandLab needs for playback and editing.
  let scheduled = false;
  let cost = 0;             // smoothed time a pass takes, in ms
  function schedule() {
    if (scheduled || !alive()) return;
    scheduled = true;
    setTimeout(runPass, Math.min(1000, Math.max(80, cost * 4)));
  }
  function runPass() {
    scheduled = false;
    if (!alive()) return;
    const t0 = performance.now();
    checkProject();
    followTracks();
    ensureHandle();
    paint();
    cost = cost * 0.7 + (performance.now() - t0) * 0.3;
  }

  // ---------- tracks changing place ----------
  // Colors are stored under the header's label, and that label starts with the track's row
  // number ("02 Jealousy"). Adding, deleting, duplicating or moving a track renumbers others,
  // so whenever the rows change, colors are moved to follow their tracks.
  const nameOf = (key) => key.replace(/^\d+\s+/, '');
  // For each row in keys: the index in prev it used to be, or -1 for a new track.
  // newAt = row the new track went into, when we know it (same-named rows can't tell us);
  // it's ignored if it would pair rows with different names.
  function matchRows(prev, keys, newAt = -1) {
    if (newAt >= 0 && keys.length === prev.length + 1) {
      const m = keys.map((_, i) => (i === newAt ? -1 : i < newAt ? i : i - 1));
      if (m.every((f, i) => f < 0 || nameOf(prev[f]) === nameOf(keys[i]))) return m;
    }
    const left = prev.map((_, i) => i);
    const from = keys.map((k) => {
      const at = left.findIndex((j) => nameOf(prev[j]) === nameOf(k));
      return at < 0 ? -1 : left.splice(at, 1)[0];
    });
    // One name gone and one new one: that's a rename.
    const fresh = from.filter((f) => f < 0).length;
    if (fresh === 1 && left.length === 1) from[from.indexOf(-1)] = left[0];
    return from;
  }

  let rows = null;          // header labels at the last check, top to bottom
  let rowEls = [];          // and their elements
  let rowLabels = [];       // and their labels
  let seenSig = '';         // the labels last seen, and when they last changed
  let seenAt = 0;
  let settleUntil = 0;      // tracks are still loading in until then
  let pendingDup = null;    // { key, from, count, until }: "Duplicate" was picked on this track
  let copyWait = null;      // { key, src, until }: maybe a copy, waiting to see its clips

  function onMenuPress(e) {
    if (!target) return;
    let el = e.target;
    for (let i = 0; i < 3 && el && !/^duplicate/i.test(el.textContent.trim()); i++) el = el.parentElement;
    if (!el || el.textContent.trim().length > 30 || !/^duplicate/i.test(el.textContent.trim())) return;
    const keys = getHeaders().map(keyOf);
    pendingDup = { key: target.key, from: keys.indexOf(target.key), count: keys.length, until: Date.now() + 15000 };
  }
  const hasClips = (h) => {
    const r = h.getBoundingClientRect();
    return [...document.querySelectorAll('.mix-editor-region')].some((el) => {
      const c = el.getBoundingClientRect();
      return (c.top + c.bottom) / 2 > r.top && (c.top + c.bottom) / 2 < r.bottom;
    });
  };
  function giveColors(h, key, src) {
    colors[key] = { ...src, native: (src.custom && detectNative(h)) || src.native };
    console.info(TAG, `track "${key}" took its copied colors`);
  }

  function followTracks() {
    // Nothing to keep track of without colors (and reading headers makes the browser lay out).
    if (!Object.keys(colors).length) { rows = null; return; }
    const hs = getHeaders();
    const keys = hs.map(keyOf);
    if (!keys.length) return;
    const labels = hs.map(labelOf);
    if (pendingDup && Date.now() > pendingDup.until) pendingDup = null;
    // Colors saved under labels by earlier versions move to their track's id (labels as shown now).
    let moved = false;
    keys.forEach((k, i) => {
      if (k.startsWith('id:') && colors[labels[i]] && !colors[k]) { colors[k] = colors[labels[i]]; delete colors[labels[i]]; moved = true; }
    });
    if (moved) save();
    const header = (key) => hs[keys.indexOf(key)];
    if (copyWait) {
      const h = header(copyWait.key);
      if (!h || colors[copyWait.key] || Date.now() > copyWait.until) copyWait = null;
      else if (hasClips(h)) { giveColors(h, copyWait.key, copyWait.src); copyWait = null; save(); }
    }
    // Mid-drag, BandLab shows a dragged copy of the track (so one appears twice): wait for the
    // drop, comparing against the last settled list, not these in-between ones.
    if (new Set(keys).size !== keys.length) return;
    // BandLab renumbers in stages, so only act once the labels have held still for a moment.
    const sig = keys.join('\n');
    if (sig !== seenSig) { seenSig = sig; seenAt = Date.now(); }
    if (rows && sig !== rows.join('\n') && Date.now() - seenAt < 300) { setTimeout(schedule, 320); return; }
    const prev = rows;
    const prevEls = rowEls;
    const prevLabels = rowLabels;
    rows = keys;
    rowEls = hs;
    rowLabels = labels;
    if (!prev || Date.now() < settleUntil || keys.join('\n') === prev.join('\n')) return;

    if (keys.every((k) => k.startsWith('id:')) && prev.every((k) => k.startsWith('id:'))) {
      // By track id nothing needs moving: moves, renames and deletes can't mix colors up.
      // Only a new track might need its colors: a duplicate gets its source's.
      const fresh = keys.map((_, i) => i).filter((i) => !prev.includes(keys[i]));
      const dup = pendingDup && fresh.length === 1 ? pendingDup : null;
      if (dup) pendingDup = null;
      if (fresh.length !== 1 || colors[keys[fresh[0]]]) return;
      const i = fresh[0];
      const src = dup && colors[dup.key];
      const above = i > 0 && nameOf(labels[i]) === nameOf(labels[i - 1]) ? colors[keys[i - 1]] : null;
      console.info(TAG, 'new track', { key: keys[i], label: labels[i], dup, prevLabels });
      if (src || (dup && above)) { giveColors(hs[i], keys[i], src || above); save(); }
      // Duplicated some other way: same name as the row above, and it comes with clips.
      else if (above) copyWait = { key: keys[i], src: above, until: Date.now() + 3000 };
      return;
    }
    if (Math.abs(keys.length - prev.length) > 1) return; // the whole list changed, not one track
    const dup = pendingDup && keys.length === pendingDup.count + 1 ? pendingDup : null;
    if (dup) pendingDup = null;
    // A brand-new header element shows where the track went, unless it's just last in the list
    // (which is also what reused elements look like); then a copy goes right below its source.
    const born = keys.map((_, i) => i).filter((i) => !prevEls.includes(hs[i]));
    const mid = born.length === 1 && born[0] < keys.length - 1 ? born[0] : -1;
    const from = matchRows(prev, keys, mid >= 0 ? mid : dup && dup.from >= 0 ? dup.from + 1 : -1);

    // Keep colors of tracks off the list, but never let an old entry land on a current row.
    const next = {};
    for (const [k, c] of Object.entries(colors)) if (!prev.includes(k) && !keys.includes(k)) next[k] = c;
    keys.forEach((k, i) => { if (from[i] >= 0 && colors[prev[from[i]]]) next[k] = colors[prev[from[i]]]; });
    const src = dup && colors[dup.key];
    colors = next;

    console.info(TAG, 'tracks changed', { prev, keys, from, dup });
    const i = from.indexOf(-1);
    if (i >= 0 && !colors[keys[i]]) {
      const above = i > 0 && nameOf(keys[i]) === nameOf(keys[i - 1]) ? colors[keys[i - 1]] : null;
      if (src || (dup && above)) giveColors(hs[i], keys[i], src || above);
      // Duplicated some other way: same name as the row above, and it comes with clips.
      else if (above) copyWait = { key: keys[i], src: above, until: Date.now() + 3000 };
    }
    save();
  }

  // ---------- storage ----------
  const storeKey = () => `bp:${projectId}`;
  function checkProject() {
    const id = location.pathname.startsWith('/studio') ? new URLSearchParams(location.search).get('id') : undefined;
    if (id === projectId) return;
    // Saving in BandLab creates a new revision, which changes ?id= while you stay in the studio,
    // so the open project's colors move along. Leaving the studio (library, feed) forgets them,
    // so they never leak into a different project.
    const carried = projectId !== undefined && id !== undefined ? colors : {};
    projectId = id;
    colors = {};
    rows = null;
    settleUntil = Date.now() + 3000;
    if (id === undefined) return schedule();
    chrome.storage.local.get(storeKey(), (res) => {
      if (projectId !== id) return;
      colors = res[storeKey()] || carried;
      if (!res[storeKey()] && Object.keys(carried).length) save();
      schedule();
    });
  }
  function save() { if (alive()) chrome.storage.local.set({ [storeKey()]: colors }); schedule(); }
  chrome.storage.local.get('bp:theme', (r) => setTheme(r['bp:theme']));
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'local' && ch['bp:theme']) setTheme(ch['bp:theme'].newValue);
  });

  function setColor(hex) {
    if (!target) return console.warn(TAG, 'no track selected for this menu');
    const key = target.key;
    if (mode === 'wave') {
      colors[key] = { ...colors[key], wave: hex };
      save();
      return injectMenu();
    }
    // Drop our override first so we read BandLab's real current color,
    // which may have changed since we last looked.
    clearColor(key, 'track', false);
    paint();
    const h = getHeaders().find((x) => keyOf(x) === key);
    const native = h && detectNative(h);
    if (!native) { console.warn(TAG, 'could not read native color for track', key); return save(); }
    colors[key] = { ...colors[key], native, custom: hex };
    console.info(TAG, `track "${key}" -> ${hex}`);
    save();
    injectMenu();
  }
  // Drops one part of a track's override: its track color ('track') or waveform color ('wave').
  function clearColor(key, part = 'track', persist = true) {
    const c = colors[key];
    if (!c) return;
    if (part === 'wave') delete c.wave;
    else { delete c.custom; delete c.native; }
    if (!c.custom && !c.wave) delete colors[key];
    if (persist) save();
  }

  // ---------- menu injection ----------
  // In-menu HSL picker (Chrome's native color popup gets closed by BandLab's menu).
  const custom = { open: false, h: 330, s: 90, l: 60 };
  const toHex = (h, s, l) => '#' + hslToRgb([h, s / 100, l / 100]).map((v) => v.toString(16).padStart(2, '0')).join('');

  // Only a label that's actually on screen: BandLab keeps closed menus around hidden.
  function findLabel() {
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (/^\s*change\s+colou?r\s*$/i.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
    });
    for (let n; (n = walk.nextNode());) {
      const el = n.parentElement;
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (top && (el.contains(top) || top.contains(el))) return el;
    }
    return null;
  }

  // Undo everything we did to the previous menu.
  let movedBox = null;
  function cleanupMenu() {
    document.querySelectorAll('.bp-row').forEach((r) => r.remove());
    document.querySelectorAll('[data-bp-menu]').forEach((m) => m.removeAttribute('data-bp-menu'));
    if (movedBox) { movedBox.style.removeProperty('translate'); movedBox = null; }
  }
  // BandLab's swatches: 5+ same-size, roughly square/round siblings near the label.
  function findSwatchRow(label) {
    let scope = label.parentElement;
    for (let i = 0; i < 4 && scope; i++, scope = scope.parentElement) {
      const parents = new Map();
      for (const el of scope.querySelectorAll('*')) {
        if (el.closest('[data-bp]')) continue;
        // Layout size, not getBoundingClientRect: the menu's open animation scales it down.
        let w, h;
        if (el instanceof HTMLElement) { w = el.offsetWidth; h = el.offsetHeight; }
        else if (el.getBBox) { try { ({ width: w, height: h } = el.getBBox()); } catch { continue; } }
        else continue;
        if (w < 10 || w > 44 || Math.abs(w - h) > 3) continue;
        const p = el.parentElement;
        parents.set(p, [...(parents.get(p) || []), w]);
      }
      for (const [p, sizes] of parents) {
        if (sizes.length >= 5 && sizes.every((s) => Math.abs(s - sizes[0]) < 2)) return { row: p, size: sizes[0] };
      }
    }
    return null;
  }
  // Our rows make the menu taller; nudge it up if it now runs off the bottom of the window.
  function fitOnScreen(menu) {
    let box = menu;
    while (box && !/fixed|absolute/.test(getComputedStyle(box).position)) box = box.parentElement;
    box ||= menu;
    box.style.removeProperty('translate');
    const r = box.getBoundingClientRect();
    const over = Math.min(r.bottom - innerHeight + 8, r.top - 8);
    if (over > 0) { box.style.setProperty('translate', `0 -${over}px`); movedBox = box; }
  }

  function customPanel(guard) {
    const panel = document.createElement('div');
    panel.className = 'bp-custom';
    const top = document.createElement('div');
    top.className = 'bp-custom-top';
    const preview = document.createElement('div');
    preview.className = 'bp-preview';
    const hexLabel = document.createElement('span');
    const apply = document.createElement('div');
    apply.className = 'bp-apply';
    apply.textContent = 'Apply';
    guard(apply, () => setColor(toHex(custom.h, custom.s, custom.l)));
    top.append(preview, hexLabel, apply);
    panel.appendChild(top);

    const sliders = {};
    const refresh = () => {
      const { h, s, l } = custom;
      const hex = toHex(h, s, l);
      preview.style.background = hex;
      hexLabel.textContent = hex.toUpperCase();
      sliders.s.style.background = `linear-gradient(to right, ${toHex(h, 0, l)}, ${toHex(h, 100, l)})`;
      sliders.l.style.background = `linear-gradient(to right, #000, ${toHex(h, s, 50)}, #fff)`;
    };
    for (const [k, max] of [['h', 360], ['s', 100], ['l', 100]]) {
      const input = document.createElement('input');
      input.type = 'range';
      input.min = 0;
      input.max = max;
      input.value = custom[k];
      input.className = 'bp-slider';
      if (k === 'h') input.style.background = 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)';
      // Keep BandLab from seeing these events (it would close the menu), but don't block dragging.
      for (const ev of ['pointerdown', 'mousedown', 'click', 'keydown', 'keyup']) {
        input.addEventListener(ev, (e) => e.stopPropagation());
      }
      input.addEventListener('input', () => { custom[k] = +input.value; refresh(); });
      sliders[k] = input;
      panel.appendChild(input);
    }
    refresh();
    return panel;
  }

  function injectMenu() {
    const label = findLabel();
    if (!label) { if (document.querySelector('.bp-row')) cleanupMenu(); return; }
    let found = findSwatchRow(label);
    if (!found) {
      console.warn(TAG, 'found "Change Color" but no swatch row; inserting after label', label);
      found = { row: label, size: 22 };
    }
    const { row: native } = found;
    let menu = label;
    while (menu.parentElement && !/rename|delete/i.test(menu.textContent)) menu = menu.parentElement;
    menu.setAttribute('data-bp-menu', '');

    document.querySelectorAll('.bp-row').forEach((r) => r.remove());
    const row = document.createElement('div');
    row.className = 'bp-row';
    row.dataset.bp = '';
    const entry = target && colors[target.key];
    const current = mode === 'wave' ? entry?.wave : entry?.custom;
    const stop = (e) => { e.stopPropagation(); e.preventDefault(); };
    const guard = (el, onPick) => {
      el.addEventListener('mousedown', stop);
      el.addEventListener('pointerdown', stop);
      el.addEventListener('click', (e) => { stop(e); onPick(); });
    };

    const modes = document.createElement('div');
    modes.className = 'bp-modes';
    for (const [m, text] of [['track', 'Track'], ['wave', 'Waveform']]) {
      const b = document.createElement('div');
      b.className = `bp-mode${mode === m ? ' bp-on' : ''}`;
      b.textContent = text;
      guard(b, () => { mode = m; injectMenu(); });
      modes.appendChild(b);
    }
    row.appendChild(modes);
    const grid = document.createElement('div');
    grid.className = 'bp-grid';
    row.appendChild(grid);
    const mk = (cls, bg, title, onPick, text = '') => {
      const s = document.createElement('div');
      s.className = `bp-swatch ${cls}`;
      if (bg) s.style.background = bg;
      s.title = title;
      s.textContent = text;
      guard(s, onPick);
      grid.appendChild(s);
      return s;
    };
    for (const hex of PRESETS) {
      mk(hex === current ? 'bp-current' : '', hex, hex, () => setColor(hex));
    }
    mk(`bp-picker${custom.open ? ' bp-current' : ''}`, null, 'Custom color…', () => { custom.open = !custom.open; injectMenu(); });
    mk('bp-reset', null, mode === 'wave' ? 'Back to normal waveform color' : 'Back to BandLab color',
      () => { if (target) clearColor(target.key, mode); injectMenu(); }, '×');
    if (custom.open) row.appendChild(customPanel(guard));
    const ns = getComputedStyle(native);
    for (const p of ['padding-left', 'padding-right', 'margin-left', 'margin-right']) {
      row.style.setProperty(p, ns.getPropertyValue(p));
    }
    native.after(row);
    requestAnimationFrame(() => fitOnScreen(menu));

    // Picking one of BandLab's own colors drops our override for that track.
    if (!native.dataset.bpHooked) {
      native.dataset.bpHooked = '1';
      native.addEventListener('click', () => { if (target) clearColor(target.key, 'track'); }, true);
    }
  }

  // ---------- events ----------
  let menuUntil = 0;        // a menu may be opening until then
  function onOpen(e) {
    if (e.type === 'contextmenu') cleanupMenu();
    menuUntil = Date.now() + 3000;
    const h = headerAt(e.target, e.clientY);
    if (h) target = { key: keyOf(h) };
    for (const ms of [0, 80, 300, 600]) setTimeout(injectMenu, ms);
  }
  document.addEventListener('contextmenu', onOpen, true);
  document.addEventListener('pointerdown', onMenuPress, true);
  document.addEventListener('pointerdown', (e) => {
    // (Measured after BandLab has had the click, so clicks and drags start without waiting on us.)
    if (e.button === 0 && !e.target.closest('[data-bp], [data-bp-menu]')) setTimeout(() => onOpen(e));
  }, true);

  // Only element changes matter: text-only ones (the clock, meters' readouts) tick every frame.
  const elementChange = (m) => [...m.addedNodes, ...m.removedNodes].some((n) => n.nodeType === 1);
  let menuQueued = false;
  const observer = new MutationObserver((muts) => {
    if (muts.every((m) => m.target.closest?.('[data-bp]') || !elementChange(m))) return;
    // Searching the page for a menu is only worth it while one may be open.
    if (!menuQueued && (Date.now() < menuUntil || document.querySelector('[data-bp-menu]'))) {
      menuQueued = true;
      requestAnimationFrame(() => { menuQueued = false; if (!document.querySelector('.bp-row')) injectMenu(); });
    }
    schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule);
  window.addEventListener('wheel', schedule, { passive: true, capture: true });
  const tick = setInterval(schedule, 1500);

  // ---------- focus mode ----------
  // theme.js hides the header row and footer; this adds Ctrl+Shift+F and a small pill
  // that keeps Save reachable (it clicks BandLab's own, now hidden, Save button).
  let layout = {};
  const pill = document.createElement('div');
  pill.className = 'bp-focus-pill';
  pill.dataset.bp = '';
  // divs, not buttons: BandLab's global button styles would restyle them.
  pill.innerHTML = '<span>Focus</span><div class="bp-pill-btn" data-act="save">Save</div><div class="bp-pill-btn" data-act="exit">Exit</div>';
  pill.addEventListener('click', (e) => {
    const act = e.target.dataset?.act;
    if (act === 'exit') setFocus(false);
    if (act === 'save') {
      const btn = [...document.querySelectorAll('.mix-editor-header-content button, .mix-editor-header button')]
        .find((b) => /^\s*save\s*$/i.test(b.textContent));
      if (btn) btn.click(); else console.warn(TAG, 'Save button not found');
    }
  });
  function setFocus(on) {
    if (alive()) chrome.storage.local.set({ 'bp:layout': { ...layout, focus: on } });
  }
  function showLayout(l) {
    layout = l || {};
    if (layout.focus) document.documentElement.appendChild(pill);
    else pill.remove();
  }
  chrome.storage.local.get('bp:layout', (r) => showLayout(r['bp:layout']));
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'local' && ch['bp:layout']) showLayout(ch['bp:layout'].newValue);
  });
  // ---------- resizable side panel ----------
  // theme.js sizes the panel from --bp-side-w; this drag handle sets it and saves it.
  const handle = document.createElement('div');
  handle.className = 'bp-side-handle';
  handle.dataset.bp = '';
  handle.title = 'Drag to resize · double-click to reset';
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('bp-dragging');
    let w = 400;
    const move = (ev) => {
      w = Math.round(Math.max(260, Math.min(innerWidth * 0.75, innerWidth - ev.clientX)));
      document.documentElement.style.setProperty('--bp-side-w', `${w}px`);
    };
    const up = () => {
      handle.classList.remove('bp-dragging');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      if (alive()) chrome.storage.local.set({ 'bp:layout': { ...layout, sideW: w } });
    };
    move(e);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
  handle.addEventListener('dblclick', () => {
    document.documentElement.style.removeProperty('--bp-side-w');
    if (alive()) chrome.storage.local.set({ 'bp:layout': { ...layout, sideW: 400 } });
  });
  function ensureHandle() {
    const panel = document.querySelector('.mix-editor-sidetabs');
    if (panel && handle.parentElement !== panel) panel.appendChild(handle);
  }

  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey && e.shiftKey && e.code === 'KeyF')) return;
    if (e.target.closest?.('input, textarea, [contenteditable="true"]')) return;
    e.preventDefault();
    e.stopPropagation();
    setFocus(!layout.focus);
  }, true);

  // "Publish to Genius" (genius-send.js, in the page) hands the song over here; genius.js on
  // genius.com picks it up from storage. Only messages from this page itself count.
  // Songs already on Genius (song id -> page) are mirrored onto <html> for that script to read.
  const str = (v, max) => String(v ?? '').slice(0, max);
  const isGeniusPage = (u) => /^https:\/\/genius\.com\/[^\s"?#]+$/.test(u || '');
  window.addEventListener('message', (e) => {
    if (e.source !== window || !alive()) return;
    if (e.data?.bp === 'genius-v1') {
      const s = e.data.song || {};
      chrome.storage.local.set({
        'bp:genius': {
          songId: str(s.songId, 100), title: str(s.title, 200), artist: str(s.artist, 200), album: str(s.album, 200),
          date: str(s.date, 10), lyrics: str(s.lyrics, 100000), cover: /^https:\/\/[^\s"]+$/.test(s.cover || '') ? s.cover : '', at: Date.now(),
        },
      });
    } else if (e.data?.bp === 'genius-link-v1' && e.data.songId) {
      // An empty link means "not on Genius": kept as null, so auto-matching leaves it alone.
      chrome.storage.local.get('bp:genius:links', (r) => {
        const links = r['bp:genius:links'] || {};
        links[str(e.data.songId, 100)] = isGeniusPage(e.data.url) ? e.data.url : null;
        chrome.storage.local.set({ 'bp:genius:links': links });
      });
    } else if (e.data?.bp === 'genius-match-v1' && e.data.reqId) {
      // Which Genius song is this track? background.js works it out (match.js).
      const t = e.data.track || {};
      const artist = str(e.data.artist, 200);
      chrome.storage.local.set({ 'bp:genius:artistName': artist });
      chrome.runtime.sendMessage({
        type: 'bp-genius-match', artist,
        track: { title: str(t.title, 200), cover: /^https:\/\/[^\s"]+$/.test(t.cover || '') ? t.cover : '', date: str(t.date, 10), lyrics: str(t.lyrics, 100000) },
      }, (res) => {
        void chrome.runtime.lastError;  // (no answer if the background was restarting)
        window.postMessage({ bp: 'genius-match-result', reqId: e.data.reqId, res: res || { error: 'no answer' } }, location.origin);
      });
    }
  });
  const showLinks = (links) => { document.documentElement.dataset.bpGeniusLinks = JSON.stringify(links || {}); };
  // Input defaults (mic, Channel 1 + 2) from the Bandlab+ menu, for monitor.js in the page.
  const showAudio = (a) => { document.documentElement.dataset.bpAudio = JSON.stringify(a || {}); };
  chrome.storage.local.get(['bp:genius:links', 'bp:audio'], (r) => { showLinks(r['bp:genius:links']); showAudio(r['bp:audio']); });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch['bp:genius:links']) showLinks(ch['bp:genius:links'].newValue);
    if (ch['bp:audio']) showAudio(ch['bp:audio'].newValue);
  });
  // The mic list monitor.js reads from BandLab, kept for the menu to pick from.
  let micsShown = '';
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.bp !== 'mics-v1' || !Array.isArray(e.data.list) || !alive()) return;
    const list = e.data.list.slice(0, 50).map((d) => ({ deviceId: str(d.deviceId, 200), name: str(d.name, 200) })).filter((d) => d.name);
    const sig = JSON.stringify(list);
    if (sig !== micsShown) { micsShown = sig; chrome.storage.local.set({ 'bp:mics': list }); }
  });

  checkProject();
  console.info(TAG, 'loaded');
  const toast = document.createElement('div');
  toast.dataset.bp = '';
  toast.textContent = 'Bandlab+ loaded';
  toast.style.cssText = 'position:fixed;bottom:70px;left:50%;transform:translateX(-50%);z-index:2147483647;'
    + 'background:#ff4fa3;color:#fff;font:600 13px sans-serif;padding:6px 12px;border-radius:6px;pointer-events:none';
  document.documentElement.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

// BandLab is a single-page app: opening a project from the feed or library changes the
// URL to /studio without a page load, so this script loads on every BandLab page and
// starts the first time the studio shows up.
// (A copy left behind in an open tab after the extension is reloaded can't use chrome.* any
// more, so it never starts, and stops waiting.)
(() => {
  const inStudio = () => location.pathname.startsWith('/studio');
  const alive = () => !!chrome.runtime?.id;
  if (inStudio()) return alive() && bandlabPlus();
  const timer = setInterval(() => {
    if (!alive()) { clearInterval(timer); return; }
    if (!inStudio()) return;
    clearInterval(timer);
    bandlabPlus();
  }, 400);
})();
