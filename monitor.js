// Bandlab+ monitoring and input. Runs in BandLab's own page (world: MAIN).
//
// "Monitor" in the toolbar, with its own volume slider and an FX toggle:
//  - FX on: BandLab's own monitoring, switched on for whichever track you select (through its
//    own controls: the track's monitoring setting and the player's setMonitoring, which also
//    turns it off on the other tracks). You hear the track's effects; its volume is the track's.
//  - FX off: Bandlab+ plays your mic straight to your output itself, without effects, at the
//    slider's volume. BandLab records the raw input either way (effects are applied on
//    playback), so recordings keep their effects.
// Instrument tracks and recording are left alone, as BandLab leaves them. Turning Monitor off
// switches monitoring back off on every track it switched on.
//
// Input defaults (set in the Bandlab+ menu, mirrored onto <html> by content.js): your chosen
// mic and Channel 1 + 2, applied when a project opens and whenever you switch tracks (a mic or
// channel picked by hand holds until the next switch). The mic list is sent to the menu.
(() => {
  'use strict';
  const ls = {
    get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* fine */ } },
  };
  const STEREO = 3;           // BandLab's track.channel: 1 left, 2 right, 3 = "Channel 1 + 2"
  let inj = null;
  let on = ls.get('bp:autoMonitor', '0') === '1';
  let fx = ls.get('bp:monFx', '1') === '1';
  let volume = Number(ls.get('bp:monVol', '100')) || 0;   // percent, for Bandlab+'s own monitoring
  let applied = null;          // track we last switched BandLab monitoring on for
  const touched = new Set();   // every track we switched it on for
  let lastTrack = null;        // for "you switched tracks"
  let appliedProject = '';     // the project mic and channel were applied for
  let appliedChoice = '';      // and the menu choice they were applied with
  let busy = false;

  function services() {
    try {
      inj ||= window.angular?.element(document).injector() || null;
      if (!inj) return null;
      return {
        player: inj.get('EditorPlayer'), revision: inj.get('EditorRevision'), state: inj.get('EditorState'),
        root: inj.get('$rootScope'), input: inj.get('InputDevice'), history: inj.get('EditorHistory'),
      };
    } catch {
      return null;
    }
  }
  const monitorable = (t) => t && t.canEdit !== false && !t.soundbank;
  const prefs = () => { try { return JSON.parse(document.documentElement.dataset.bpAudio || '{}'); } catch { return {}; } };

  async function setTrack(s, track, value) {
    s.revision.trackMonitoring?.set?.(track, value);
    await s.player.current?.setMonitoring?.(track, value);
    s.root.$applyAsync();
  }
  async function releaseTracks(s) {
    const sel = s.revision.selectedTrack;
    for (const t of touched) {
      if (t === sel && !s.state.isRecording) await setTrack(s, t, false);
      else s.revision.trackMonitoring.set(t, false);
    }
    touched.clear();
    applied = null;
  }

  // ---------- Bandlab+'s own (effect-free) monitoring ----------
  const dry = { ctx: null, stream: null, gain: null, device: null, starting: null };
  async function startDry(deviceId) {
    if (dry.ctx && dry.device === deviceId) return;
    if (dry.starting) return dry.starting;
    stopDry();
    dry.starting = (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId && deviceId !== 'default' ? { exact: deviceId } : undefined,
          echoCancellation: false, noiseSuppression: false, autoGainControl: false, latency: 0,
        },
      });
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      const gain = ctx.createGain();
      gain.gain.value = volume / 100;
      ctx.createMediaStreamSource(stream).connect(gain).connect(ctx.destination);
      Object.assign(dry, { ctx, stream, gain, device: deviceId });
    })().catch((e) => console.warn('[Bandlab+] could not start monitoring', e)).finally(() => { dry.starting = null; });
    return dry.starting;
  }
  function stopDry() {
    dry.stream?.getTracks().forEach((t) => t.stop());
    dry.ctx?.close().catch(() => {});
    Object.assign(dry, { ctx: null, stream: null, gain: null, device: null });
  }
  // (Browsers start sound only after a click; a monitor left on from last time waits for one.)
  addEventListener('pointerdown', () => { if (dry.ctx?.state === 'suspended') dry.ctx.resume(); }, true);

  // ---------- input defaults ----------
  let devices = [];
  let devicesAt = 0;
  async function audioDevices(s) {
    if (Date.now() - devicesAt > 5000) {
      devicesAt = Date.now();
      try {
        devices = (await s.input.getAudioDevices()) || [];
        // The Bandlab+ menu lists these to pick from (content.js keeps them).
        window.postMessage({ bp: 'mics-v1', list: devices.map((d) => ({ deviceId: d.deviceId, name: d.name })) }, location.origin);
      } catch { /* no mic access yet */ }
    }
    return devices;
  }
  function preferredDevice(list) {
    const p = prefs();
    if (!p.micName && !p.micId) return null;
    return list.find((d) => d.deviceId === p.micId) || list.find((d) => d.name === p.micName) || null;
  }
  let micShown = '';
  let micMissing = '';
  async function applyInput(s) {
    const p = prefs();
    const list = await audioDevices(s);
    const mic = preferredDevice(list);
    if (mic) {
      await s.input.switchTo(mic);  // (BandLab does nothing if it's already the one)
      if (micShown !== mic.deviceId) { micShown = mic.deviceId; console.info('[Bandlab+] microphone:', mic.name); }
    } else if ((p.micName || p.micId) && list.length && micMissing !== p.micName) {
      micMissing = p.micName;
      console.warn('[Bandlab+] chosen microphone not found:', p.micName, '- available:', list.map((d) => d.name));
    }
    // Channel 1 + 2 on every audio track (not just the selected one).
    if (p.stereo === false) return;
    let changed = false;
    for (const t of s.revision.current?.tracks || []) {
      if (!monitorable(t) || t.channel === STEREO) continue;
      t.channel = STEREO;
      changed = true;
      if (t === s.revision.selectedTrack && s.revision.trackMonitoring.get(t)) await s.player.current.setMonitoring(t, true);  // (re-applies the input)
    }
    if (changed) s.root.$applyAsync();
  }

  // ---------- every 300ms ----------
  async function tick() {
    if (busy) return;
    const s = services();
    if (!s?.player.current?.setMonitoring || !s.revision.trackMonitoring) { if (dry.ctx) stopDry(); return; }
    ensureUi();
    const t = s.revision.selectedTrack;
    busy = true;
    try {
      // Mic and channel: once when a project opens (and again only if the menu choice
      // changes). A track added later gets Channel 1 + 2 when you first select it.
      const project = s.revision.current?.id || '';
      const choice = document.documentElement.dataset.bpAudio || '';
      if ((project !== appliedProject || choice !== appliedChoice) && s.revision.current?.tracks?.length && !s.state.isRecording) {
        appliedProject = project;
        appliedChoice = choice;
        await applyInput(s);
      } else if (t !== lastTrack && monitorable(t) && t.channel !== STEREO && prefs().stereo !== false && !s.state.isRecording) {
        t.channel = STEREO;
        if (s.revision.trackMonitoring.get(t)) await s.player.current.setMonitoring(t, true);
        s.root.$applyAsync();
      }
      lastTrack = t;
      syncSlider(s, t);
      if (!on) return;
      if (!fx) {
        if (touched.size) await releaseTracks(s);
        await startDry(preferredDevice(await audioDevices(s))?.deviceId || 'default');
        return;
      }
      if (dry.ctx) stopDry();
      if (s.state.isRecording || !monitorable(t)) return;
      if (t === applied && s.revision.trackMonitoring.get(t)) return;
      await setTrack(s, t, true);
      applied = t;
      touched.add(t);
    } catch (e) {
      console.warn('[Bandlab+] monitoring', e);
    } finally {
      busy = false;
    }
  }

  async function setOn(value) {
    on = value;
    ls.set('bp:autoMonitor', value ? '1' : '0');
    paint();
    if (value) return tick();
    stopDry();
    const s = services();
    if (s) { busy = true; try { await releaseTracks(s); } finally { busy = false; } }
  }
  function setFx(value) {
    fx = value;
    ls.set('bp:monFx', value ? '1' : '0');
    paint();
    const s = services();
    if (s && fx) syncSlider(s, s.revision.selectedTrack);
    if (on) tick();
  }

  // ---------- the toolbar group: [Monitor] [volume] [FX] ----------
  const group = document.createElement('div');
  group.className = 'bp-mon-group';
  group.dataset.bp = '';
  const button = document.createElement('button');
  button.type = 'button';
  button.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/></svg>'
    + '<span>Monitor</span>';
  button.addEventListener('click', (e) => { e.stopPropagation(); setOn(!on); });
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '150';
  slider.value = String(volume);
  slider.className = 'bp-mon-vol';
  const label = document.createElement('span');
  label.className = 'bp-mon-vol-label';
  // FX off: Bandlab+'s own monitoring volume. FX on: the selected track's own volume (its fader,
  // 0..1 in BandLab), since BandLab's monitoring has no volume of its own.
  let dragging = false;
  let undoTaken = false;
  slider.addEventListener('pointerdown', () => { dragging = true; undoTaken = false; });
  addEventListener('pointerup', () => { dragging = false; }, true);
  slider.addEventListener('input', () => {
    if (fx) {
      const s = services();
      const t = s?.revision.selectedTrack;
      if (!t || !monitorable(t)) return;
      if (!undoTaken) { s.history?.pushUndo?.(s.revision.current); undoTaken = true; }  // (one undo step per drag)
      const v = Number(slider.value) / 100;
      t.volume = v;
      s.player.current?.setTrackVolume?.(t, v);
      s.state.hasRevisionChanges = true;
      s.root.$applyAsync();
    } else {
      volume = Number(slider.value);
      ls.set('bp:monVol', String(volume));
      dry.gain?.gain.setTargetAtTime(volume / 100, dry.ctx.currentTime, 0.02);
    }
    paint();
  });
  slider.addEventListener('change', () => { if (!dragging) undoTaken = false; });
  slider.addEventListener('dblclick', () => { slider.value = '100'; slider.dispatchEvent(new Event('input')); undoTaken = false; });
  for (const ev of ['pointerdown', 'mousedown', 'keydown']) slider.addEventListener(ev, (e) => e.stopPropagation());
  // With FX on the slider follows the track's fader (moved there, or a different track picked).
  function syncSlider(s, t) {
    if (!fx || dragging) return;
    const v = monitorable(t) && Number.isFinite(t.volume) ? Math.round(t.volume * 100) : null;
    if (v !== null && String(v) !== slider.value) { slider.value = String(v); paint(); }
    slider.disabled = v === null;
  }
  const fxChip = document.createElement('div');
  fxChip.className = 'bp-mon-fx';
  fxChip.textContent = 'FX';
  fxChip.addEventListener('click', (e) => { e.stopPropagation(); setFx(!fx); });
  group.append(button, label, slider, fxChip);

  function paint() {
    button.classList.toggle('bp-mon-on', on);
    button.title = on ? 'Bandlab+: monitoring is ON for the track you select. Click to turn off.'
      : 'Bandlab+: monitoring is off. Click to monitor whichever track you select.';
    fxChip.classList.toggle('bp-on', fx);
    fxChip.title = fx ? 'FX on: you hear the track\'s effects (BandLab\'s monitoring, at the track\'s volume). Click for no effects.'
      : 'FX off: you hear your mic without effects, at the slider\'s volume. Recordings still get their effects. Click for effects.';
    label.textContent = fx ? 'Track Volume' : 'Monitor Volume';
    slider.max = fx ? '100' : '150';
    if (!fx) { slider.value = String(volume); slider.disabled = false; }
    slider.title = fx ? `Track volume ${slider.value}% (the selected track's own volume). Double-click: 100%`
      : `Monitor volume ${volume}% (Bandlab+'s monitoring, separate from the track). Double-click: 100%`;
  }
  function ensureUi() {
    if (group.isConnected) return;
    const save = [...document.querySelectorAll('.mix-editor-header button, .mix-editor-header-content button')]
      .find((b) => /^\s*save\s*$/i.test(b.textContent));
    if (!save) return;
    // BandLab's own button look, minus states like "disabled" that Save has with nothing to save.
    // (No aria-pressed: BandLab paints pressed buttons in its primary colour, white here.)
    const look = [...save.classList].filter((c) => !/disabled|loading|active|busy|saving/i.test(c));
    button.className = [...look, 'bp-mon-btn'].join(' ');
    paint();
    // Left side of the toolbar, after undo / redo.
    const left = document.querySelector('.mix-editor-toolbar-left');
    if (left) left.appendChild(group);
    else (document.querySelector('.bp-fix-btn') || save).before(group);
  }

  setInterval(tick, 300);
})();
