// Bandlab+ "Publish to Genius", Genius side. Runs on genius.com.
//
// Add A Song page (/new): fills in the song sent from BandLab. Picks your artist from
// Genius's own list (an artist already on Genius gets selected, not typed as a new one), sets
// Primary Tag to Rap, fills the lyrics, picks the album only if it already exists on Genius
// (never makes a new album page), and sets Language to English and the release date.
//
// Song page (after you submit): a button opens Edit Metadata and puts in the cover link
// (Song Art), language, release date and album, ready for you to press Save.
//
// Cover: Genius takes song art as a link, so the panel's "Upload cover" copies the BandLab
// cover to your clipboard and opens postimages; you paste it there (Ctrl+V), and postimg.js
// sends the direct link back here.
//
// It never submits or saves anything: you check the form and press Submit / Save yourself.
(() => {
  'use strict';
  const FRESH = 60 * 60 * 1000;  // a hand-off older than this is stale
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const onNew = /^\/new\/?$/.test(location.pathname);
  const onSong = /-lyrics\/?$/.test(location.pathname);
  let song = null;
  let coverLink = '';
  let root = null;            // the panel's shadow root
  const done = {};            // field -> what happened, shown in the panel
  let running = false;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
  const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
  async function waitFor(fn, ms = 6000) {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) {
      const v = fn();
      if (v) return v;
    }
    return null;
  }

  // ---------- finding fields by their on-screen name ----------
  const FIELD = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select, [contenteditable="true"]';
  const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ');
  // The block for a field called `re` (e.g. /^primary artists?$/): its label's nearest
  // ancestor that holds a field. Labels are matched on their own text, "*" left off.
  function block(re) {
    for (const el of document.querySelectorAll('label, legend, div, span, p, h1, h2, h3, h4, h5, h6')) {
      if (el.closest('#bp-genius-host') || !visible(el)) continue;
      if (!re.test(norm(ownText(el)).replace(/\s*\*$/, ''))) continue;
      let p = el;
      for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
        if (p.querySelector(FIELD)) return p;
      }
    }
    return null;
  }
  // React keeps its own copy of a field's value; this sets it the way typing would.
  function setValue(el, v) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function press(el) {
    const opts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
  }
  const firstInput = (b) => b?.querySelector('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file])');

  // A native <select>: pick the option whose text matches.
  function pickNative(sel, want) {
    const o = [...sel.options].find((x) => norm(x.textContent) === norm(want) || norm(x.value) === norm(want));
    if (!o) return false;
    setValue(sel, o.value);
    return true;
  }
  // A typed dropdown (artists, albums, tags...): type, wait for Genius's list, click the match.
  // If nothing matches, the typing is cleared, so nothing new gets created by accident.
  async function pickFromList(input, text, matches) {
    input.focus();
    setValue(input, text);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const box = input.getBoundingClientRect();
    const option = await waitFor(() => [...document.querySelectorAll('[role="option"], li, [class*="option" i], [class*="suggestion" i], [class*="result" i]')]
      .filter((o) => visible(o) && !o.closest('#bp-genius-host') && !o.contains(input)
        && Math.abs(o.getBoundingClientRect().top - box.bottom) < 500)
      .find((o) => matches(norm(o.innerText))), 6000);
    if (option) { press(option); return true; }
    setValue(input, '');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return false;
  }
  // The field already shows this value (a chip, a chosen option): leave it alone.
  function shows(b, value) {
    const t = norm([...b.querySelectorAll('*')].filter((e) => !e.matches(FIELD) && e.children.length === 0).map((e) => e.textContent).join(' | '));
    return t.split(' | ').some((x) => x.replace(/\s*[×x✕]$/, '').trim() === norm(value));
  }
  function note(key, text) {
    done[key] = text;
    root?.querySelector(`[data-k="${key}"] .state`)?.replaceChildren(text);
  }

  // ---------- the steps ----------
  async function fillTitle() {
    const input = firstInput(block(/^title$/));
    if (!input || !song.title) return;
    if (!input.value) setValue(input, song.title);
    note('title', 'filled in ✓');
  }
  async function fillArtist() {
    const b = block(/^primary artists?$/) || block(/^artists?$/);
    if (!b || !song.artist) return;
    if (shows(b, song.artist)) return note('artist', 'selected ✓');
    const ok = await pickFromList(firstInput(b), song.artist,
      (t) => t === norm(song.artist) || t.split(/\s[—–-]\s|\n/)[0].trim() === norm(song.artist));
    note('artist', ok ? 'selected ✓' : 'not on Genius yet: pick or add it in the form');
  }
  async function fillTag() {
    const b = block(/^primary tag$/);
    if (!b) return;
    const sel = b.querySelector('select');
    if (sel) {
      if (!sel.value) pickNative(sel, 'Rap');
    } else if (!/\b(rap|pop|r&b|rock|country|non-music)\b/.test(norm(b.innerText.replace(/primary tag/i, '')))) {
      await pickFromList(firstInput(b), 'Rap', (t) => t === 'rap');
    }
    note('tag', 'Rap ✓');
  }
  async function fillLyrics() {
    if (!song.lyrics.trim()) return;
    let area = document.querySelector('textarea[name*="lyric" i], [contenteditable="true"]');
    if (!area) {
      const start = [...document.querySelectorAll('button, a, [role="button"]')].find((b) => /transcribe lyrics/i.test(b.textContent));
      if (start) press(start);
      area = await waitFor(() => [...document.querySelectorAll('textarea, [contenteditable="true"]')]
        .filter((e) => visible(e) && !e.closest('#bp-genius-host'))
        .sort((a, b) => b.offsetHeight - a.offsetHeight)[0], 5000);
    }
    if (!area) return note('lyrics', 'paste them in (Copy below)');
    if (area.isContentEditable) {
      if (!area.textContent.trim()) { area.focus(); document.execCommand('insertText', false, song.lyrics); }
    } else if (!area.value) {
      setValue(area, song.lyrics);
    }
    note('lyrics', 'filled in ✓');
  }
  async function fillAlbum() {
    if (!song.album) return;
    const b = block(/^albums?$/);
    if (!b) return;
    if (shows(b, song.album)) return note('album', 'selected ✓');
    const want = norm(song.album);
    const by = norm(song.artist);
    const ok = await pickFromList(firstInput(b), song.album, (t) => {
      const [name, artist = ''] = t.split(/\s[—–]\s/);
      return name.trim() === want && (!by || artist.includes(by));
    });
    note('album', ok ? 'existing album selected ✓' : 'no such album on Genius yet: left empty');
  }
  async function fillLanguage() {
    const b = block(/^language$/);
    if (!b) return;
    const sel = b.querySelector('select');
    if (sel) { if (!sel.value) pickNative(sel, 'English'); }
    else if (!shows(b, 'English')) await pickFromList(firstInput(b), 'English', (t) => t === 'english');
    note('language', 'English ✓');
  }
  async function fillDate() {
    const b = block(/^release date$/);
    const [y, m, d] = (song.date || '').split('-').map(Number);
    if (!b || !y) return;
    const want = { month: MONTHS[m - 1], day: String(d), year: String(y) };
    const parts = [...b.querySelectorAll('select')];
    if (parts.length >= 3) {
      for (const sel of parts) {
        const kind = /month/i.test(sel.options[0]?.textContent) ? 'month' : /day/i.test(sel.options[0]?.textContent) ? 'day' : 'year';
        if (!sel.value || /^(month|day|year)$/i.test(sel.selectedOptions[0]?.textContent || '')) pickNative(sel, want[kind]);
      }
    } else {
      // Typed dropdowns: Month / Day / Year in that order.
      const inputs = [...b.querySelectorAll('input:not([type=hidden])')];
      if (inputs.length >= 3) {
        await pickFromList(inputs[0], want.month, (t) => t === norm(want.month));
        await pickFromList(inputs[1], want.day, (t) => t === want.day);
        await pickFromList(inputs[2], want.year, (t) => t === want.year);
      } else if (inputs[0] && !inputs[0].value) {
        setValue(inputs[0], inputs[0].type === 'date' ? song.date : `${want.month} ${want.day}, ${want.year}`);
      }
    }
    note('date', `${want.month} ${want.day}, ${want.year} ✓`);
  }
  async function fillArt() {
    const input = firstInput(block(/^song art$/));
    if (!input || !coverLink) return false;
    if (input.value !== coverLink) setValue(input, coverLink);
    note('cover', 'Song Art link filled in ✓');
    return true;
  }

  async function fillAddSong() {
    if (running) return;
    running = true;
    try {
      await waitFor(() => block(/^title$/), 10000);  // (Genius draws the form with script)
      await fillArtist();
      await fillTitle();
      await fillTag();
      await fillLyrics();
      await fillAlbum();
      await fillLanguage();
      await fillDate();
      await fillArt();
    } finally {
      running = false;
    }
  }
  async function fillMetadata() {
    if (running) return;
    running = true;
    try {
      if (!block(/^song art$/)) {
        const edit = [...document.querySelectorAll('button, a, [role="button"]')].find((b) => /^\s*edit metadata\s*$/i.test(b.textContent));
        if (edit) press(edit);
        await waitFor(() => block(/^song art$/), 8000);
      }
      if (!block(/^song art$/)) return note('meta', 'couldn\'t open Edit Metadata: open it, then press the button again');
      await fillArt();
      await fillLanguage();
      await fillDate();
      await fillAlbum();
      note('meta', 'done: check it, then press Save on Genius');
    } finally {
      running = false;
    }
  }

  // ---------- cover: clipboard -> postimages -> direct link back here ----------
  async function pngFrom(url) {
    const blob = await (await fetch(url)).blob();
    const img = await createImageBitmap(blob);
    const c = new OffscreenCanvas(img.width, img.height);
    c.getContext('2d').drawImage(img, 0, 0);
    return c.convertToBlob({ type: 'image/png' });
  }
  async function uploadCover(btn) {
    if (!song.cover) return;
    try {
      // (Written right away, filled when ready: the clipboard only takes it during the click.)
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngFrom(song.cover) })]);
    } catch {
      btn.textContent = 'Couldn\'t copy: use Open full size';
      return;
    }
    await chrome.storage.local.set({ 'bp:genius:awaitCover': Date.now() });
    window.open('https://postimages.org/', '_blank');
    btn.textContent = 'Cover copied: press Ctrl+V on postimages';
  }
  function setCover(url) {
    coverLink = url;
    try { sessionStorage.setItem('bp:genius:cover', url); } catch { /* fine */ }
    const row = root?.querySelector('[data-k="cover"]');
    if (row) {
      row.querySelector('.v').textContent = url;
      row.querySelector('[data-copy="cover"]').dataset.value = url;
    }
    note('cover', onSong ? 'link ready: press the button below' : 'link ready ✓');
    if (onNew) fillArt();
  }

  // ---------- the panel ----------
  const longDate = (iso) => {
    const [y, m, d] = (iso || '').split('-').map(Number);
    return y ? `${MONTHS[m - 1]} ${d}, ${y}` : '';
  };
  function showPanel() {
    document.getElementById('bp-genius-host')?.remove();
    const host = document.createElement('div');
    host.id = 'bp-genius-host';
    root = host.attachShadow({ mode: 'open' });
    const rows = [
      ['title', 'Title', song.title],
      ['artist', 'Artist', song.artist],
      ['tag', 'Primary tag', 'Rap'],
      ['album', 'Album', song.album],
      ['date', 'Release date', longDate(song.date)],
      ['language', 'Language', 'English'],
      ['lyrics', 'Lyrics', song.lyrics],
      ['cover', 'Song art link', coverLink],
    ];
    root.innerHTML = `
      <style>
        .p { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; width: 330px; max-height: 75vh; overflow: auto;
             background: #111; color: #fff; border: 2px solid #ffff64; border-radius: 10px; padding: 12px;
             font: 13px/1.35 sans-serif; box-shadow: 0 8px 30px rgba(0,0,0,.4); }
        .h { display: flex; align-items: center; justify-content: space-between; font-weight: 700; margin-bottom: 6px; }
        .x { cursor: pointer; opacity: .7; padding: 0 4px; } .x:hover { opacity: 1; }
        .r { border-top: 1px solid #333; padding: 6px 0; }
        .l { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; color: #aaa; text-transform: uppercase; letter-spacing: .04em; }
        .state { color: #7dff9b; text-transform: none; letter-spacing: 0; text-align: right; }
        .v { margin: 2px 0 4px; white-space: pre-wrap; word-break: break-word; max-height: 4.2em; overflow: hidden; }
        .empty { color: #777; font-style: italic; }
        .b { display: inline-block; background: #ffff64; color: #000; font-weight: 700; border-radius: 5px; padding: 3px 9px; cursor: pointer; margin: 2px 6px 0 0; text-decoration: none; }
        .b:hover { filter: brightness(.9); }
        .big { display: block; text-align: center; padding: 7px; margin-top: 8px; }
        img { width: 64px; height: 64px; border-radius: 4px; object-fit: cover; float: right; margin-left: 8px; }
        .n { color: #aaa; font-size: 12px; margin: 4px 0; }
      </style>
      <div class="p">
        <div class="h"><span>From BandLab (Bandlab+)</span><span class="x" title="Close">✕</span></div>
        ${song.cover ? `<img src="${song.cover.replace(/"/g, '')}" alt="">` : ''}
        <div class="n">${onSong ? 'Song added. Next: cover, date, language and album in Edit Metadata.'
    : 'Filled in what it could. Check the form, then press Submit on Genius.'}</div>
        ${onSong ? '<span class="b big" data-act="meta">Add cover &amp; details in Edit Metadata</span><div class="r" data-k="meta"><div class="l"><span></span><span class="state"></span></div></div>' : ''}
        ${rows.map(([k, label]) => `
          <div class="r" data-k="${k}">
            <div class="l"><span>${label}</span><span class="state"></span></div>
            <div class="v"></div>
            <span class="b" data-copy="${k}">Copy</span>
            ${k === 'cover' && song.cover ? '<span class="b" data-act="upload">Upload cover to postimages</span>' : ''}
          </div>`).join('')}
      </div>`;
    for (const [k, , v] of rows) {
      const el = root.querySelector(`[data-k="${k}"] .v`);
      el.textContent = v || (k === 'cover' ? 'not yet: press Upload cover' : 'none');
      el.classList.toggle('empty', !v);
      root.querySelector(`[data-copy="${k}"]`).dataset.value = v || '';
    }
    root.querySelector('.x').addEventListener('click', () => host.remove());
    root.addEventListener('click', async (e) => {
      const t = e.target;
      if (t.dataset?.act === 'upload') return uploadCover(t);
      if (t.dataset?.act === 'meta') return fillMetadata();
      if (t.dataset?.copy === undefined) return;
      try { await navigator.clipboard.writeText(t.dataset.value || ''); t.textContent = 'Copied'; } catch { t.textContent = 'Copy failed'; }
      setTimeout(() => { t.textContent = 'Copy'; }, 1200);
    });
    (document.body || document.documentElement).appendChild(host);
    for (const [k, v] of Object.entries(done)) note(k, v);
  }

  // ---------- start ----------
  function start(s) {
    song = { title: '', artist: '', album: '', date: '', lyrics: '', cover: '', ...s };
    try { sessionStorage.setItem('bp:genius', JSON.stringify(song)); } catch { /* fine */ }
    chrome.storage.local.remove('bp:genius');  // (used up: opening the form later won't refill an old song)
    if (onNew) {
      try { sessionStorage.setItem('bp:genius:submitting', String(Date.now())); } catch { /* fine */ }
    }
    if (onSong) {
      // The song's page right after Add Song (Genius may have shortened the title, so the
      // title can't be trusted to match). Any other song page in this tab is left alone.
      const from = Number(kept('bp:genius:submitting')) || 0;
      if (!document.referrer.startsWith('https://genius.com/new') && Date.now() - from > FRESH) return;
      // Remember this page for the BandLab song, so its button becomes "Open in Genius".
      if (song.songId) {
        chrome.storage.local.get('bp:genius:links', (r) => {
          const links = r['bp:genius:links'] || {};
          links[song.songId] = location.origin + location.pathname;
          chrome.storage.local.set({ 'bp:genius:links': links });
        });
      }
    }
    showPanel();
    if (onNew) fillAddSong();
  }
  function kept(key) {
    try { return sessionStorage.getItem(key) || ''; } catch { return ''; }
  }
  // Any genius.com page: refresh the list of your songs (used to find BandLab tracks on
  // Genius) if it's over 6 hours old. From here it's an ordinary request of Genius's own
  // pages, which works even if Genius turns the extension's background away.
  chrome.storage.local.get(['bp:genius:artistName', 'bp:genius:catalogs'], async (r) => {
    const artist = r['bp:genius:artistName'];
    const old = (r['bp:genius:catalogs'] || {})[globalThis.BPMatch?.fold(artist || '')];
    if (!artist || !globalThis.BPMatch || (old && Date.now() - old.at < 6 * 60 * 60 * 1000)) return;
    try {
      const getJson = async (path) => (await fetch(path, { headers: { accept: 'application/json' } })).json();
      chrome.runtime.sendMessage({ type: 'bp-genius-catalog', catalog: await BPMatch.fetchCatalog(artist, getJson) });
    } catch { /* try again on the next page */ }
  });

  if (onNew || onSong) {
    coverLink = kept('bp:genius:cover');
    chrome.storage.local.get(['bp:genius', 'bp:genius:cover'], (r) => {
      const c = r['bp:genius:cover'];
      if (c && Date.now() - c.at < FRESH) coverLink = c.url;
      const s = r['bp:genius'];
      if (s && Date.now() - s.at < FRESH) return start(s);
      try {
        const k = JSON.parse(kept('bp:genius') || 'null');
        if (k) start(k);
      } catch { /* nothing to do */ }
    });
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'local') return;
      const s = ch['bp:genius']?.newValue;
      if (s && Date.now() - s.at < FRESH && onNew) start(s);
      const c = ch['bp:genius:cover']?.newValue;
      if (c && song) setCover(c.url);
    });
  }
})();
