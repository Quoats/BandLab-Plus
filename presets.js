// Bandlab+ preset icons (MAIN world).
// Adds a "Colour icon" maker to BandLab's Save / Edit Preset dialog: pick a pattern,
// any colour and an optional short label, and the icon is drawn on a canvas and handed
// to BandLab's own "Upload from Device" slot, so it's saved with the preset and shows
// everywhere in BandLab like any uploaded cover.
(() => {
  if (window.__bpPresetIcons) return;
  window.__bpPresetIcons = true;

  const KEY = 'bp:presetIcon';
  const SIZE = 512;
  const SWATCHES = ['#e5383b', '#ff7a1a', '#ffb000', '#f5d10f', '#8bd346', '#1fbf7a', '#14b8a6',
    '#22c3e6', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#d4d4d8', '#3f3f46'];
  const PATTERNS = ['waves', 'scales', 'contours', 'cubes', 'stripes', 'zigzag', 'dots', 'rings', 'plain'];

  let state = { pattern: 'waves', color: '#22c3e6', label: '' };
  try { Object.assign(state, JSON.parse(localStorage.getItem(KEY) || '{}'), { label: '' }); } catch {}
  if (!PATTERNS.includes(state.pattern)) state.pattern = 'waves';
  const remember = () => { try { localStorage.setItem(KEY, JSON.stringify({ pattern: state.pattern, color: state.color })); } catch {} };

  // ---------- colour helpers ----------
  const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  const lum = (c) => { const [r, g, b] = rgb(c); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
  const mix = (c, to, k) => { const a = rgb(c), b = rgb(to); return hex(a.map((v, i) => v + (b[i] - v) * k)); };
  const lineColor = (c) => lum(c) < 0.22 ? mix(c, '#ffffff', 0.22) : mix(c, '#000000', 0.24);

  // ---------- drawing ----------
  function draw(ctx, s, pattern, color, label) {
    ctx.clearRect(0, 0, s, s);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = ctx.fillStyle = lineColor(color);
    ctx.lineWidth = Math.max(1, s / 34);
    ctx.lineCap = ctx.lineJoin = 'round';
    const path = (fn) => { ctx.beginPath(); fn(); ctx.stroke(); };

    if (pattern === 'waves') {
      const step = s / 7, amp = s / 26, len = s / 2.6;
      for (let y = -step; y < s + step; y += step) path(() => {
        for (let x = 0; x <= s; x += s / 64) ctx[x ? 'lineTo' : 'moveTo'](x, y + Math.sin((x / len) * Math.PI * 2 + y / 40) * amp);
      });
    } else if (pattern === 'scales') {
      const r = s / 7;
      for (let row = 0, y = 0; y < s + r * 2; row++, y += r) {
        const off = row % 2 ? r : 0;
        for (let x = -r * 2 + off; x < s + r * 2; x += r * 2) path(() => ctx.arc(x, y, r, 0, Math.PI));
      }
    } else if (pattern === 'contours') {
      const step = s / 8;
      for (let k = -2; k < 11; k++) path(() => {
        for (let x = 0; x <= s; x += s / 64) {
          const y = k * step + x * 0.35 + Math.sin(x / s * 5 + k * 0.7) * s / 18 + Math.sin(x / s * 11) * s / 60;
          ctx[x ? 'lineTo' : 'moveTo'](x, y);
        }
      });
    } else if (pattern === 'cubes') {
      const r = s / 6, w = r * Math.sqrt(3);
      for (let row = -1, y = 0; y < s + r * 2; row++, y = row * r * 1.5) {
        for (let x = (row % 2 ? w / 2 : 0) - w; x < s + w; x += w) {
          path(() => {
            for (let i = 0; i <= 6; i++) {
              const a = Math.PI / 3 * i + Math.PI / 6;
              ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r, y + Math.sin(a) * r);
            }
          });
          path(() => {
            for (const a of [-Math.PI / 2, Math.PI / 6, Math.PI * 5 / 6]) { ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
          });
        }
      }
    } else if (pattern === 'stripes') {
      const step = s / 8;
      for (let x = -s; x < s * 2; x += step) path(() => { ctx.moveTo(x, 0); ctx.lineTo(x + s, s); });
    } else if (pattern === 'zigzag') {
      const step = s / 7, w = s / 8;
      for (let y = 0; y < s + step; y += step) path(() => {
        for (let i = 0, x = 0; x <= s + w; i++, x += w) ctx[i ? 'lineTo' : 'moveTo'](x, y + (i % 2 ? step / 2.4 : 0));
      });
    } else if (pattern === 'dots') {
      const step = s / 6, r = s / 26;
      for (let row = 0, y = step / 2; y < s + step; row++, y += step * 0.87)
        for (let x = row % 2 ? step : step / 2; x < s + step; x += step) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
    } else if (pattern === 'rings') {
      for (let r = s / 9; r < s * 1.5; r += s / 9) path(() => ctx.arc(0, s, r, -Math.PI / 2, 0));
    }

    const text = (label || '').trim().slice(0, 3);
    if (text) {
      const fs = s * (text.length === 1 ? 0.56 : text.length === 2 ? 0.44 : 0.33);
      ctx.font = `800 ${fs}px system-ui, "Segoe UI", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const light = lum(color) < 0.6;
      ctx.shadowColor = light ? 'rgba(0,0,0,.45)' : 'rgba(255,255,255,.35)';
      ctx.shadowBlur = s / 30;
      ctx.shadowOffsetY = s / 90;
      ctx.fillStyle = light ? '#ffffff' : '#141414';
      ctx.fillText(text, s / 2, s / 2 + fs * 0.04);
      ctx.shadowColor = 'transparent';
    }
  }

  // ---------- handing the file to BandLab ----------
  // BandLab's picker creates a hidden <input type=file> and calls .click() on it.
  // While armed, that click receives our generated file instead of opening a dialog.
  let pendingFile = null, armedUntil = 0;
  const nativeClick = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function () {
    if (pendingFile && this.type === 'file' && Date.now() < armedUntil) {
      const dt = new DataTransfer();
      dt.items.add(pendingFile);
      pendingFile = null;
      this.files = dt.files;
      setTimeout(() => this.dispatchEvent(new Event('change', { bubbles: true })), 0);
      return;
    }
    return nativeClick.apply(this, arguments);
  };

  const waitFor = (fn, ms) => new Promise((res) => {
    const end = Date.now() + ms;
    (function poll() { const v = fn(); if (v || Date.now() > end) res(v); else setTimeout(poll, 30); })();
  });

  let applyToken = 0;
  async function apply(panel) {
    const covers = panel.previousElementSibling;
    if (!covers || !covers.isConnected) return;
    const token = ++applyToken;
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    draw(c.getContext('2d'), SIZE, state.pattern, state.color, state.label);
    // toDataURL is synchronous (toBlob can be held back by the browser for a second or more).
    const bin = atob(c.toDataURL('image/png').split(',')[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'image/png' });
    let btn = covers.querySelector('.preset-select-cover-button');
    if (!btn) {
      covers.querySelector('.mix-editor-preset-cover-button')?.click(); // remove the previous upload
      btn = await waitFor(() => covers.querySelector('.preset-select-cover-button'), 1500);
    }
    if (token !== applyToken) return;
    if (!btn) { setStatus(panel, 'Could not reach the upload slot'); return; }
    pendingFile = new File([blob], 'bandlab-plus-icon.png', { type: 'image/png' });
    armedUntil = Date.now() + 3000;
    btn.click();
    setTimeout(() => { if (Date.now() >= armedUntil) pendingFile = null; }, 3100);
    setStatus(panel, 'Icon set — it saves with the preset');
  }

  function setStatus(panel, msg) {
    const el = panel.querySelector('.bp-picon-status');
    if (el) el.textContent = msg;
  }

  // ---------- panel ----------
  function build(covers) {
    covers.dataset.bpIcons = '1';
    const panel = document.createElement('div');
    panel.className = 'bp-picon';
    panel.dataset.bp = '1';
    panel.innerHTML = `
      <div class="bp-picon-head"><span>Colour icon</span><span class="bp-picon-status"></span></div>
      <div class="bp-picon-patterns"></div>
      <div class="bp-picon-row">
        <div class="bp-picon-swatches"></div>
        <label class="bp-picon-wheel" title="Any colour"><input type="color"></label>
        <input class="bp-picon-label" type="text" maxlength="3" placeholder="Aa" title="Short label on the icon (up to 3 characters)">
      </div>`;
    const pats = panel.querySelector('.bp-picon-patterns');
    for (const p of PATTERNS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'bp-picon-pat';
      b.dataset.p = p;
      b.title = p[0].toUpperCase() + p.slice(1);
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      b.appendChild(cv);
      b.addEventListener('click', () => { state.pattern = p; remember(); refresh(panel); apply(panel); });
      pats.appendChild(b);
    }
    const sw = panel.querySelector('.bp-picon-swatches');
    for (const col of SWATCHES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'bp-picon-sw';
      b.style.background = col;
      b.dataset.c = col;
      b.title = col;
      b.addEventListener('click', () => { state.color = col; remember(); refresh(panel); apply(panel); });
      sw.appendChild(b);
    }
    const wheel = panel.querySelector('.bp-picon-wheel input');
    wheel.value = state.color;
    wheel.addEventListener('input', () => { state.color = wheel.value; refresh(panel); });
    wheel.addEventListener('change', () => { state.color = wheel.value; remember(); refresh(panel); apply(panel); });
    const label = panel.querySelector('.bp-picon-label');
    let labelTimer = 0;
    label.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); clearTimeout(labelTimer); apply(panel); } });
    label.addEventListener('input', () => {
      state.label = label.value;
      refresh(panel);
      clearTimeout(labelTimer);
      labelTimer = setTimeout(() => apply(panel), 600);
    });
    covers.after(panel);
    refresh(panel);
  }

  function refresh(panel) {
    for (const b of panel.querySelectorAll('.bp-picon-pat')) {
      draw(b.firstChild.getContext('2d'), 64, b.dataset.p, state.color, b.dataset.p === state.pattern ? state.label : '');
      b.classList.toggle('on', b.dataset.p === state.pattern);
    }
    for (const b of panel.querySelectorAll('.bp-picon-sw')) b.classList.toggle('on', b.dataset.c.toLowerCase() === state.color.toLowerCase());
    const wheel = panel.querySelector('.bp-picon-wheel');
    wheel.classList.toggle('on', !SWATCHES.includes(state.color.toLowerCase()));
    wheel.style.setProperty('--c', state.color);
    if (wheel.firstChild.value !== state.color) wheel.firstChild.value = state.color;
  }

  // The dialog is rare, so a light poll is cheaper than watching every DOM change in the studio.
  setInterval(() => {
    const covers = document.querySelector('.mix-editor-preset-generated-covers:not([data-bp-icons])');
    if (covers) { state.label = ''; build(covers); }
  }, 400);
})();
