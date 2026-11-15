// Bandlab+ editing fixes. Runs in BandLab's own page (world: MAIN) so it can reach the editor.
//
// 1. Edits that never finish. BandLab runs every edit (slice, remove takes, merge...) through
//    one queue, one at a time, and each edit asks the audio engine (in the audio thread) a few
//    questions. If the engine hits an error it never answers, that edit waits forever and so
//    does every edit behind it: Slice and Remove Takes go dead while playback keeps going,
//    until a reload. So the engine's quick editing questions get a time limit; one that isn't
//    answered in time is given up on and the queue moves on. (Not while saving: a big save
//    can take a while, and cutting it short would break it.)
//
// 2. Saving while editing. A save takes a copy of the project partway through and checks
//    which sounds it uses; editing in between makes the two disagree and the save fails. So
//    while BandLab saves, clicks and keys in the editor are held back (scrolling still works,
//    save dialogs are never blocked) and a banner says so. It lets go after 2 minutes at most.
//
// 3. "Fix editing" button next to Save. Slice can also grey out because the engine's playhead
//    or selection has drifted from the screen's; the button sends both again, asks the engine
//    again, and turns Slice back on if it agrees (rebuilding the engine's copy of the mix if
//    the first try doesn't do it). It only runs when pressed.
//
// 4. Markers: Shift+1..9 sets one at the playhead, 1..9 jumps to it, Alt+1..9 removes it.
(() => {
  'use strict';
  const TAG = '[Bandlab+]';
  let inj = null;
  let saving = false;

  // Quick questions only: freezing, mixdowns, AI tools and exports can legitimately take long.
  const QUICK = new Set([
    'getCurrentMix', 'rememberCurrentState', 'forgetState', 'getChangeSet', 'setSelection',
    'canSlice', 'sliceSelection', 'canMerge', 'mergeSelection', 'canPaste', 'canDenoise', 'canVocaltrim',
    'removeAllTakesForSelection', 'removeAllTakesForTrack', 'setTakeForRegion', 'deleteTake', 'getRegions',
  ]);
  const TIMEOUT = 10000;
  function guardPort(port) {
    if (!port || port.__bpGuard || typeof port.request !== 'function') return;
    const request = port.request;
    port.request = (msg, ...rest) => {
      const p = request.call(port, msg, ...rest);
      const name = msg?.method || msg?.command || '?';
      // Anything else (effects, freezing, exports...) may rightly take long: left alone, unlogged.
      if (!QUICK.has(name) || saving) return p;
      let timer;
      const late = new Promise((_, reject) => {
        timer = setTimeout(() => {
          console.warn(TAG, `the audio engine never answered "${name}" - gave up on it so editing keeps working`);
          reject(new Error(`Bandlab+: no answer from the audio engine for ${name}`));
        }, TIMEOUT);
      });
      p.then(() => clearTimeout(timer), () => clearTimeout(timer));
      return Promise.race([p, late]);
    };
    port.__bpGuard = true;
  }

  function services() {
    try {
      inj ||= window.angular?.element(document).injector() || null;
      if (!inj) return null;
      return {
        player: inj.get('EditorPlayer'),
        revision: inj.get('EditorRevision'),
        state: inj.get('EditorState'),
        root: inj.get('$rootScope'),
        scroll: optional('EditorScroll'),
        scrollState: optional('EditorScrollState'),
        soundbank: optional('Soundbank'),
      };
    } catch {
      return null;  // not in the studio
    }
  }
  function optional(name) {
    try { return inj.get(name); } catch { return null; }
  }

  function findStudio(root) {
    const stack = [root];
    while (stack.length) {
      const s = stack.pop();
      if (Object.prototype.hasOwnProperty.call(s, 'canSliceRegions')) return s;
      for (let c = s.$$childHead; c; c = c.$$nextSibling) stack.push(c);
    }
    return null;
  }

  function toast(text, ms = 2500) {
    const t = document.createElement('div');
    t.className = 'bp-page-toast';
    t.dataset.bp = '';
    t.textContent = text;
    document.documentElement.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  // ---------- 3. Fix editing button ----------
  let fixing = false;
  async function fixEditing() {
    const s = services();
    const mh = s?.player.current?.mixHandler;
    if (!mh || fixing) return;
    if (s.state.isPlaying || s.state.isRecording) return toast('Stop playback first');
    fixing = true;
    try {
      const sel = [...(s.revision.selectedRegions || [])];
      const ids = sel.map((r) => r.id);
      await s.player.setPlaybackPosition(s.state.crTime);
      await mh.setSelection(ids);
      let ok = ids.length ? await mh.canSlice() : false;
      if (ids.length && !ok) {
        await s.player.current.updateMix(true);
        await mh.setSelection(ids);
        ok = await mh.canSlice();
      }
      const studio = findStudio(s.root);
      if (studio && ids.length) {
        studio.canSliceRegions = ok;
        studio.$applyAsync();
      }
      console.info(TAG, 'editing refreshed', { time: s.state.crTime, selected: ids.length, canSlice: ok });
      toast(!ids.length ? 'Editing refreshed'
        : ok ? 'Editing refreshed: Slice is ready'
          : 'Refreshed, but BandLab still can\'t slice here (is the playhead inside the selected clip?)', 3500);
    } catch (e) {
      console.warn(TAG, 'could not refresh editing', e);
      toast('Couldn\'t refresh editing; a reload may be needed', 3500);
    } finally {
      fixing = false;
    }
  }

  const button = document.createElement('div');
  button.className = 'bp-fix-btn';
  button.dataset.bp = '';
  button.textContent = '↻ Fix editing';
  button.title = 'Bandlab+: re-sync the editor with the audio engine (when Slice greys out or edits stop working)';
  button.addEventListener('click', (e) => { e.stopPropagation(); fixEditing(); });
  function ensureButton() {
    if (button.isConnected) return;
    const save = [...document.querySelectorAll('.mix-editor-header button, .mix-editor-header-content button')]
      .find((b) => /^\s*save\s*$/i.test(b.textContent));
    if (save) save.before(button);
  }

  // ---------- 2. Save lock ----------
  const banner = document.createElement('div');
  banner.className = 'bp-save-banner';
  banner.dataset.bp = '';
  banner.textContent = 'Saving… editing is paused until it finishes, so the save can\'t break';
  let lockedAt = 0;
  let gaveUp = false;
  const LOCK_MAX = 120000;
  const SPARE = 'input, textarea, select, [contenteditable="true"], [role="dialog"], [class*="modal"], [class*="dialog"], [data-bp]';
  function hold(e) {
    if (!lockedAt) return;
    const t = e.target;
    if (!(t instanceof Element) || t.closest(SPARE)) return;
    // (Shortcuts usually land on <body>, so keys are held everywhere except text fields.)
    if (e.type !== 'keydown' && !t.closest('.mix-editor')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'keydown', 'dragstart', 'drop']) {
    window.addEventListener(type, hold, true);
  }
  function setSaving(on) {
    if (on && !lockedAt) {
      lockedAt = Date.now();
      document.documentElement.appendChild(banner);
    } else if (!on && lockedAt) {
      lockedAt = 0;
      banner.remove();
    }
  }

  // ---------- 4. Markers ----------
  // Shift+1..9 drops marker 1..9 at the playhead (during playback too), 1..9 jumps there,
  // Alt+1..9 removes it. They're drawn as numbered flags over the timeline: click one to
  // jump, right-click to remove. Saved in this browser per song, so they survive saves
  // (which change the project's address) and reloads. Number keys are left alone while
  // Musical Typing is on, since it plays notes with them.
  let markers = {};         // '1'..'9' -> time in seconds
  let songKey = null;
  const markerLayer = document.createElement('div');
  markerLayer.className = 'bp-markers';
  markerLayer.dataset.bp = '';
  const markerEls = {};

  const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
  function loadMarkers(s) {
    const song = s.revision.current;
    const key = song && `bp:markers:${song.song?.id || song.id}`;
    if (key === songKey) return;
    songKey = key;
    try { markers = (key && JSON.parse(localStorage.getItem(key) || '{}')) || {}; } catch { markers = {}; }
  }
  function saveMarkers() {
    if (!songKey) return;
    try {
      if (Object.keys(markers).length) localStorage.setItem(songKey, JSON.stringify(markers));
      else localStorage.removeItem(songKey);
    } catch { /* storage full or blocked: markers just won't outlive the tab */ }
  }

  async function jumpTo(n) {
    const s = services();
    const t = markers[n];
    if (!s || t === undefined) return;
    await s.player.setPlaybackPosition(t);
    const st = s.scrollState;
    const w = st?.timelineEl?.clientWidth || 0;
    const x = t * s.state.scalePx;
    if (s.scroll && st && (x < st.timelineLeft || x > st.timelineLeft + w - 40)) {
      s.scroll.scrollToX({ time: t, scalePx: s.state.scalePx });
    }
    s.root.$applyAsync();
  }
  function setMarker(n, t) {
    markers[n] = Math.max(0, t);
    saveMarkers();
    toast(`Marker ${n} at ${fmt(markers[n])}`, 1500);
  }
  function removeMarker(n) {
    if (markers[n] === undefined) return;
    delete markers[n];
    saveMarkers();
    toast(`Marker ${n} removed`, 1500);
  }

  window.addEventListener('keydown', (e) => {
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (!m || e.ctrlKey || e.metaKey || e.repeat) return;
    const t = e.target;
    if (t instanceof Element && t.closest('input, textarea, select, [contenteditable="true"]')) return;
    const s = services();
    if (!s?.player.current?.mixHandler || s.soundbank?.isMusicalTypingActive?.()) return;
    const n = m[1];
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.altKey) removeMarker(n);
    else if (e.shiftKey) setMarker(n, s.state.crTime);
    else if (markers[n] !== undefined) jumpTo(n);
    else toast(`No marker ${n} yet (Shift+${n} sets it)`, 1500);
  }, true);

  function markerEl(n) {
    if (markerEls[n]) return markerEls[n];
    const el = document.createElement('div');
    el.className = 'bp-marker';
    el.innerHTML = `<div class="bp-marker-flag">${n}</div><div class="bp-marker-line"></div>`;
    const flag = el.firstChild;
    flag.title = `Marker ${n}: click to jump, right-click to remove`;
    flag.addEventListener('pointerdown', (e) => e.stopPropagation());
    flag.addEventListener('click', (e) => { e.stopPropagation(); jumpTo(n); });
    flag.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); removeMarker(n); });
    markerLayer.appendChild(el);
    return (markerEls[n] = el);
  }

  // Placed from the playhead, which BandLab keeps at the current time: x = playhead + (t - now) * zoom.
  // Every frame while there are markers to show, otherwise a few times a second.
  function drawMarkers() {
    const s = Object.keys(markers).length ? services() : null;
    const playhead = s && document.querySelector('.mix-editor-playhead');
    const box = s?.scrollState?.timelineEl?.getBoundingClientRect();
    if (!playhead || !box) {
      markerLayer.remove();
      setTimeout(() => requestAnimationFrame(drawMarkers), 250);
      return;
    }
    requestAnimationFrame(drawMarkers);
    if (!markerLayer.isConnected) document.documentElement.appendChild(markerLayer);
    const p = playhead.getBoundingClientRect();
    const px = p.left + p.width / 2;
    markerLayer.style.cssText = `left:${box.left}px;width:${box.width}px;top:${p.top}px;height:${p.height}px`;
    for (const n of '123456789') {
      const t = markers[n];
      if (t === undefined) { markerEls[n]?.remove(); delete markerEls[n]; continue; }
      const x = px + (t - s.state.crTime) * s.state.scalePx - box.left;
      const el = markerEl(n);
      el.style.display = x < -10 || x > box.width + 10 ? 'none' : '';
      el.style.transform = `translateX(${x}px)`;
    }
  }
  requestAnimationFrame(drawMarkers);

  // ---------- once a second: cheap checks only ----------
  setInterval(() => {
    const s = services();
    const mh = s?.player.current?.mixHandler;
    if (!mh) { setSaving(false); return; }
    guardPort(mh._port);
    ensureButton();
    loadMarkers(s);
    saving = !!(s.state.isSaving || s.state.isPreSaving);
    if (!saving) gaveUp = false;
    if (saving && lockedAt && Date.now() - lockedAt > LOCK_MAX) {
      console.warn(TAG, 'save is taking over 2 minutes; letting go of the editing pause');
      gaveUp = true;  // (not again for this save)
    }
    setSaving(saving && !gaveUp);
  }, 1000);
})();
