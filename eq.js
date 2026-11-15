// Bandlab+ Master EQ. Runs in BandLab's own page (world: MAIN).
//
// A free master EQ in place of the Mastering tab's paid "EQ" card. BandLab's own mastering EQ
// needs a higher membership, so this uses BandLab's free 3-Band EQ track effect instead: one
// copy at the very end of every track's FX chain, all on the same settings. An EQ (a linear
// filter) placed last on every track adds up to the same thing as that EQ on the whole mix, so
// it acts as a master EQ sitting just before BandLab's mastering. It's saved in the project, so
// exports and publishes include it, and editing stays live (new tracks get it too).
//
//  - Low / Mid / High (and Mid frequency) knobs: drag (Shift: fine), wheel, double-click
//    resets, click the readout to type. Knobs change the effects' settings live, without
//    rebuilding anyone's FX chain.
//  - The switch bypasses it everywhere; all gains at 0 dB takes it off every track.
//  - Each change is one BandLab undo step. Tracks with a full FX chain (the free limit) or
//    frozen tracks are skipped, and the card says which.
//  - In the FX panel its title reads "Master EQ" instead of the effect's own name.
// BandLab's paid EQ is reset to 0 dB and off, so Apply never asks for an upgrade.
(() => {
  'use strict';
  const SLUG = 'threeBandEq';
  const EVENT = 'Audio:effectsChanged';  // BandLab's "this track's FX chain changed"
  const GAINS = [['lowGain', 'Low'], ['midGain', 'Mid'], ['highGain', 'High']];
  let inj = null;

  function services() {
    try {
      inj ||= window.angular?.element(document).injector() || null;
      if (!inj) return null;
      return {
        revision: inj.get('EditorRevision'), player: inj.get('EditorPlayer'), state: inj.get('EditorState'),
        history: inj.get('EditorHistory'), root: inj.get('$rootScope'), katnip: inj.get('Katnip'),
      };
    } catch {
      return null;
    }
  }
  const meta = (s) => s?.katnip?.metadata?.[SLUG] || null;
  const paramMeta = (s, k) => meta(s)?.params?.[k] || {};
  function range(s, k) {
    const m = paramMeta(s, k);
    const min = Number.isFinite(m.min) ? m.min : k === 'midFreq' ? 200 : -12;
    const max = Number.isFinite(m.max) ? m.max : k === 'midFreq' ? 5000 : 12;
    const def = Number.isFinite(m.default) ? m.default : k === 'midFreq' ? 1000 : 0;
    return { min, max, def };
  }
  const songId = (s) => s.revision.current?.song?.id || s.revision.current?.id || '';
  // Tracks it goes on: everything you can edit, except frozen ones (their FX are baked in).
  const eligible = (t) => t && Array.isArray(t.effects) && t.canEdit !== false && !t.isFrozen;
  const isOurs = (e) => e?.slug === SLUG;
  const lastOf = (t) => t.effects[t.effects.length - 1];

  // ---------- this song's settings ----------
  let cfg = null;           // { on, lowGain, midGain, highGain, midFreq } or null (not in use)
  let cfgSong = '';
  const store = (id) => `bp:mastereq:${id}`;
  function load(s) {
    const id = songId(s);
    if (id === cfgSong) return;
    cfgSong = id;
    cfg = null;
    try { cfg = JSON.parse(localStorage.getItem(store(id)) || 'null'); } catch { /* none */ }
    if (!cfg) {
      // Opened elsewhere: every track ending in the same 3-Band EQ means it's in use.
      const ts = s.revision.current.tracks.filter(eligible);
      const ends = ts.map(lastOf);
      if (ts.length && ends.every(isOurs)) {
        const p = ends[0].params || {};
        if (ends.every((e) => GAINS.every(([k]) => e.params?.[k] === p[k]))) {
          cfg = { on: !ends[0].bypass, lowGain: p.lowGain, midGain: p.midGain, highGain: p.highGain, midFreq: p.midFreq };
        }
      }
    }
  }
  function save() {
    try {
      if (cfg) localStorage.setItem(store(cfgSong), JSON.stringify(cfg));
      else localStorage.removeItem(store(cfgSong));
    } catch { /* fine */ }
  }
  const flat = () => GAINS.every(([k]) => Math.abs(cfg?.[k] || 0) < 0.05);

  // ---------- writing it into the tracks ----------
  let skipped = [];
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  function makeEffect(s) {
    const params = {};
    for (const [k, m] of Object.entries(meta(s).params || {})) if ('default' in m) params[k] = m.default;
    return { id: newId(), slug: SLUG, bypass: !cfg.on, params: { ...params, ...settings() }, automation: {} };
  }
  const settings = () => ({ lowGain: cfg.lowGain, midGain: cfg.midGain, highGain: cfg.highGain, midFreq: cfg.midFreq });
  function setChain(s, t, effects) {
    // BandLab's own "FX chain changed" (as its FX panel sends it). It renames the track's preset
    // "custom"; the preset's name is put back, since only a master EQ was added at the end.
    const preset = t.preset;
    const data = t.effectsData;
    s.root.$broadcast(EVENT, { effects, track: t });
    if (preset && preset !== 'none') { t.preset = preset; t.effectsData = data; }
  }
  function limitOf(s) {
    const ui = s.katnip.effectsJson?.effectsUI || {};
    return ui.maxEffectsPerChainWithoutMembership || ui.maxEffectsPerChain || 8;  // (the free limit, to be safe)
  }
  // Adds it where it's missing, removes it when it's off for good, refreshes the rest.
  function sync(s, { live = false } = {}) {
    if (!cfg || !meta(s)) return;
    const tracks = s.revision.current.tracks.filter(eligible);
    const remove = flat();
    // Tracks with a full FX chain are left out (and listed), before anything is touched.
    const full = (t) => t.effects.length + 1 > limitOf(s);
    skipped = remove ? [] : tracks.filter((t) => !isOurs(lastOf(t)) && full(t)).map((t) => t.name || 'a track');
    const structural = tracks.filter((t) => (remove ? isOurs(lastOf(t)) : !isOurs(lastOf(t)) && !full(t)));
    if (structural.length) {
      s.history.pushUndo(s.revision.current);
      s.history.startToIgnorePushUndo();  // (one undo step for all of it)
      try {
        for (const t of structural) {
          if (remove) setChain(s, t, t.effects.slice(0, -1));
          else setChain(s, t, [...t.effects, makeEffect(s)]);
        }
      } finally {
        s.history.stopToIgnorePushUndo();
      }
    }
    if (remove) { cfg = null; save(); s.root.$applyAsync(); return; }
    // Settings only: change the effects in place (no chain rebuild, so playback doesn't glitch).
    let changed = false;
    const want = { ...settings(), bypass: !cfg.on };
    for (const t of tracks) {
      const i = t.effects.length - 1;
      const e = t.effects[i];
      if (!isOurs(e)) continue;
      for (const [k, v] of Object.entries(want)) {
        const cur = k === 'bypass' ? e.bypass : e.params?.[k];
        if (cur === v || v === undefined) continue;
        if (!changed && !live) s.history.pushUndo(s.revision.current);
        changed = true;
        if (k === 'bypass') e.bypass = v; else e.params[k] = v;
        s.player.current?.setTrackEffectParameter?.(t, i, k, v);
      }
    }
    if (changed) s.state.hasRevisionChanges = true;
    s.root.$applyAsync();
  }

  // ---------- knobs ----------
  // Dragging changes the sound live; the undo step is taken once, when the drag starts.
  let dragUndo = false;
  function set(key, v, { live = false } = {}) {
    const s = services();
    if (!s || !meta(s)) return;
    load(s);
    const { min, max } = range(s, key);
    const step = key === 'midFreq' ? 1 : 0.1;
    const clean = Number(Math.min(max, Math.max(min, Math.round(v / step) * step)).toFixed(key === 'midFreq' ? 0 : 1));
    if (!cfg) cfg = { on: true, lowGain: 0, midGain: 0, highGain: 0, midFreq: range(s, 'midFreq').def };
    cfg[key] = clean;
    if (key !== 'midFreq') cfg.on = true;  // (as BandLab's own EQ knobs do: turning one switches it on)
    save();
    if (live && !dragUndo) { s.history.pushUndo(s.revision.current); dragUndo = true; }
    sync(s, { live: live || dragUndo });
  }
  function toggle() {
    const s = services();
    if (!s || !meta(s)) return;
    load(s);
    if (!cfg) return;
    cfg.on = !cfg.on;
    save();
    sync(s);
  }
  const valueOf = (key) => {
    const s = services();
    if (cfg?.[key] !== undefined) return cfg[key];
    return s ? range(s, key).def : 0;
  };

  // ---------- the card ----------
  const card = document.createElement('div');
  card.className = 'mastering-controls-card bp-eq';
  card.dataset.bp = '';
  card.innerHTML = `
    <div class="bp-eq-head"><span>Master EQ <small>free · Bandlab+</small></span><div class="bp-eq-switch" role="switch" tabindex="0" title="Master EQ on/off"><div></div></div></div>
    <div class="bp-eq-knobs"></div>
    <div class="bp-eq-note"></div>`;
  const sw = card.querySelector('.bp-eq-switch');
  const note = card.querySelector('.bp-eq-note');
  sw.addEventListener('click', toggle);

  const knobs = {};
  const ARC = 270;
  function arcPath(from, to) {
    const r = 22;
    const pt = (deg) => {
      const a = ((deg - 90) * Math.PI) / 180;
      return `${(28 + r * Math.cos(a)).toFixed(2)} ${(28 + r * Math.sin(a)).toFixed(2)}`;
    };
    const [a, b] = from <= to ? [from, to] : [to, from];
    return `M ${pt(a)} A ${r} ${r} 0 ${b - a > 180 ? 1 : 0} 1 ${pt(b)}`;
  }
  // Knob position 0..1 <-> value (frequency on a log scale, gains straight).
  function toPos(s, key, v) {
    const { min, max } = range(s, key);
    if (key === 'midFreq') return Math.log(v / min) / Math.log(max / min);
    return (v - min) / (max - min);
  }
  function fromPos(s, key, p) {
    const { min, max } = range(s, key);
    p = Math.min(1, Math.max(0, p));
    if (key === 'midFreq') return min * (max / min) ** p;
    return min + p * (max - min);
  }
  const fmt = (key, v) => (key === 'midFreq' ? (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} kHz` : `${Math.round(v)} Hz`)
    : `${v > 0 ? '+' : ''}${(Math.abs(v) < 0.05 ? 0 : v).toFixed(1)} dB`);

  for (const [key, label] of [...GAINS, ['midFreq', 'Mid freq']]) {
    const el = document.createElement('div');
    el.className = `bp-knob${key === 'midFreq' ? ' bp-knob-small' : ''}`;
    el.innerHTML = `
      <svg viewBox="0 0 56 56" class="bp-knob-dial">
        <path class="bp-knob-track" d="${arcPath(-ARC / 2, ARC / 2)}"/>
        <path class="bp-knob-fill" d=""/>
        <circle class="bp-knob-cap" cx="28" cy="28" r="15"/>
        <line class="bp-knob-tick" x1="28" y1="28" x2="28" y2="16"/>
      </svg>
      <div class="bp-knob-label">${label}</div>
      <input class="bp-knob-value" spellcheck="false">`;
    const dial = el.querySelector('svg');
    const input = el.querySelector('input');
    knobs[key] = { el, fill: el.querySelector('.bp-knob-fill'), tick: el.querySelector('.bp-knob-tick'), input, shown: NaN };
    // Drag: 150px covers the whole range; Shift for 10x finer.
    dial.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const s = services();
      if (!s || !meta(s)) return;
      e.preventDefault();
      e.stopPropagation();
      dial.setPointerCapture(e.pointerId);
      let last = e.clientY;
      let pos = toPos(s, key, valueOf(key));
      dragUndo = false;
      const move = (ev) => {
        pos += ((last - ev.clientY) / 150) * (ev.shiftKey ? 0.1 : 1);
        last = ev.clientY;
        set(key, fromPos(s, key, pos), { live: true });
      };
      const up = () => {
        dragUndo = false;
        dial.removeEventListener('pointermove', move);
        dial.removeEventListener('pointerup', up);
        dial.removeEventListener('pointercancel', up);
      };
      dial.addEventListener('pointermove', move);
      dial.addEventListener('pointerup', up);
      dial.addEventListener('pointercancel', up);
    });
    dial.addEventListener('dblclick', (e) => {
      e.preventDefault();
      const s = services();
      if (s) set(key, range(s, key).def);
    });
    dial.addEventListener('wheel', (e) => {
      e.preventDefault();
      const s = services();
      if (!s || !meta(s)) return;
      const step = (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 0.01 : 0.04);
      set(key, fromPos(s, key, toPos(s, key, valueOf(key)) + step));
    }, { passive: false });
    input.addEventListener('focus', () => input.select());
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();  // (BandLab shortcuts stay quiet while typing)
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') { knobs[key].shown = NaN; input.blur(); }
    });
    input.addEventListener('blur', () => {
      let v = parseFloat(input.value.replace(',', '.'));
      if (key === 'midFreq' && /k/i.test(input.value)) v *= 1000;
      if (Number.isFinite(v) && !Number.isNaN(knobs[key].shown)) set(key, v);
      knobs[key].shown = NaN;
    });
    card.querySelector('.bp-eq-knobs').appendChild(el);
  }

  function draw(s) {
    const on = !!cfg?.on && !flat();
    sw.classList.toggle('bp-on', on);
    sw.setAttribute('aria-checked', String(on));
    card.classList.toggle('bp-eq-off', !on);
    for (const key of Object.keys(knobs)) {
      const k = knobs[key];
      const v = valueOf(key);
      if (v === k.shown && document.activeElement !== k.input) continue;
      const centre = key === 'midFreq' ? toPos(s, key, range(s, key).def) : toPos(s, key, 0);
      const deg = (toPos(s, key, v) - 0.5) * ARC;
      const zero = (centre - 0.5) * ARC;
      k.fill.setAttribute('d', Math.abs(deg - zero) < 1 ? '' : arcPath(zero, deg));
      k.tick.setAttribute('transform', `rotate(${deg} 28 28)`);
      if (document.activeElement !== k.input) k.input.value = fmt(key, v);
      k.shown = v;
    }
    note.textContent = skipped.length
      ? `Not on ${skipped.length} track${skipped.length > 1 ? 's' : ''} (FX chain full): ${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? '…' : ''}`
      : cfg && !flat() ? 'On every track as its last effect. 0 dB on all three removes it.' : 'Free, on every track. Turn a knob to start.';
  }

  // BandLab's paid EQ back to 0 dB and off (left over from earlier versions of these knobs),
  // so Apply doesn't ask for an upgrade.
  function resetPaid() {
    try {
      const studio = (function find(root) {
        const stack = [root];
        while (stack.length) {
          const sc = stack.pop();
          if (Object.prototype.hasOwnProperty.call(sc, 'studioMasteringState')) return sc;
          for (let c = sc.$$childHead; c; c = c.$$nextSibling) stack.push(c);
        }
        return null;
      })(inj.get('$rootScope'));
      const m = studio?.studioMasteringState;
      if (!m?.eqControlModels) return;
      const unref = (v) => (v && typeof v === 'object' && 'value' in v ? v.value : v);
      let touched = false;
      for (const [k] of GAINS.map(([g]) => [g.replace('Gain', 'FreqGain')])) {
        const model = m.eqControlModels[k];
        if (model && Math.abs(Number(unref(unref(model.value))) || 0) >= 0.05) { model.setter(0); touched = true; }
      }
      if (touched || !unref(m.eqBypass)) m.setEqBypass(false);  // (setEqBypass(false) = bypassed)
      studio.$applyAsync();
    } catch { /* leave it */ }
  }

  // ---------- the "Master EQ" name, wherever BandLab shows the effect ----------
  // (FX panel title, automation menu heading, the "EQ3-M - High" automation button...) for the
  // selected track. If the track also has a 3-Band EQ of its own, only the last one (the Master
  // EQ) is renamed, and the automation button only while it's set to the Master EQ.
  const NAME = /EQ3-M/;
  const MASTER = 'Master EQ';
  function renameMode(s) {
    const t = s?.revision.selectedTrack;
    if (!cfg || flat() || !t || !isOurs(lastOf(t) || null)) return null;
    const ownToo = t.effects.filter(isOurs).length > 1;
    const auto = s.revision.trackAutomationParameters?.get?.(t);
    return { ownToo, autoIsOurs: !!auto && typeof auto === 'object' && auto.effect === lastOf(t) };
  }
  function renameIn(root, mode) {
    if (!root || root.closest?.('[data-bp]')) return;
    const nodes = [];
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (NAME.test(n.nodeValue) && !n.parentElement?.closest('[data-bp]') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
    });
    for (let n; (n = walk.nextNode());) nodes.push(n);
    if (root.nodeType === 3 && NAME.test(root.nodeValue)) nodes.push(root);
    const button = nodes.filter((n) => /EQ3-M\s*-\s*\S/.test(n.nodeValue));  // the automation button
    const rest = nodes.filter((n) => !button.includes(n));
    for (const n of button) if (!mode.ownToo || mode.autoIsOurs) n.nodeValue = n.nodeValue.replace(NAME, MASTER);
    for (const n of mode.ownToo ? rest.slice(-1) : rest) n.nodeValue = n.nodeValue.replace(NAME, MASTER);
  }
  // Only text that changes is looked at (menus opening, labels updating), not the whole page.
  let renameQueued = false;
  const queued = new Set();
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'characterData') { if (NAME.test(m.target.nodeValue)) queued.add(m.target.parentElement); continue; }
      // (The container they were added to, so "only the last one" sees the whole list.)
      if ([...m.addedNodes].some((n) => (n.nodeType === 1 ? NAME.test(n.textContent) : n.nodeType === 3 && NAME.test(n.nodeValue)))) queued.add(m.target);
    }
    if (!queued.size || renameQueued) return;
    renameQueued = true;
    setTimeout(() => {
      renameQueued = false;
      const mode = renameMode(services());
      if (mode) for (const el of queued) if (el?.isConnected) renameIn(el, mode);
      queued.clear();
    });
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  let renamedFor = null;
  function renameAll(s) {
    if (s.revision.selectedTrack === renamedFor) return;  // (once per track picked; changes are caught above)
    renamedFor = s.revision.selectedTrack;
    const mode = renameMode(s);
    if (mode && document.body) renameIn(document.body, mode);
  }

  // ---------- running ----------
  let lastSync = 0;
  let paidReset = false;
  function frame() {
    const s = services();
    const ok = s?.revision.current && meta(s);
    if (ok) {
      load(s);
      // New tracks get it too (checked now and then, not every frame).
      if (cfg && !flat() && Date.now() - lastSync > 1500) {
        lastSync = Date.now();
        if (s.revision.current.tracks.some((t) => eligible(t) && !isOurs(lastOf(t)) && t.effects.length < limitOf(s))) sync(s);
        renameAll(s);
      }
    }
    const theirs = document.querySelector('.mastering-controls-card-eq');
    if (!theirs || !ok) {
      if (theirs) theirs.style.removeProperty('display');
      card.remove();
      paidReset = false;
      setTimeout(() => requestAnimationFrame(frame), 250);
      return;
    }
    requestAnimationFrame(frame);
    if (card.previousElementSibling !== theirs) {
      card.style.margin = getComputedStyle(theirs).margin;
      theirs.after(card);
    }
    if (theirs.style.display !== 'none') theirs.style.setProperty('display', 'none', 'important');
    if (!paidReset) { paidReset = true; resetPaid(); }
    draw(s);
  }
  requestAnimationFrame(frame);
})();
