// Bandlab+ "Publish to Genius", BandLab side. Runs in BandLab's own page (world: MAIN).
//
// A yellow button (next to "Fix editing") gathers the track's details from the studio: title,
// cover, lyrics (the Lyrics/Notes panel), date, and the BandLab album it's on, if any. It shows
// them for a check, then opens Genius's "Add A Song" page, where genius.js fills the form in.
// Genius has no upload API, so the song goes up through its normal form, as you, on your
// signed-in account, and you press Submit there yourself.
(() => {
  'use strict';
  let inj = null;
  function services() {
    try {
      inj ||= window.angular?.element(document).injector() || null;
      return inj && { revision: inj.get('EditorRevision') };
    } catch {
      return null;
    }
  }
  function optional(name) {
    try { return inj?.get(name) || null; } catch { return null; }
  }
  const remember = (k, v) => { try { localStorage.setItem(k, v); } catch { /* fine */ } };
  const recall = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function details() {
    const rev = services()?.revision.current;
    if (!rev) return null;
    const song = rev.song || {};
    const pic = song.picture?.url || '';
    const date = rev.createdOn ? new Date(rev.createdOn) : new Date();
    return {
      songId: song.id,
      authorId: song.author?.type === 'User' ? song.author.id : null,
      title: song.name || '',
      artist: recall('bp:genius:artist'),
      lyrics: rev.lyrics?.content || '',
      date: Number.isNaN(date.getTime()) ? new Date() : date,
      cover: pic ? `${pic}1400x1400` : '',  // (BandLab's image URLs end in the size wanted; 1400 is its largest)
    };
  }

  // The BandLab album this song is on: your albums, each listing its tracks' posts, whose
  // revisions point back at their song. Uses BandLab's own Album service (and your sign-in).
  async function findAlbum(songId, userId) {
    const Album = optional('Album');
    if (!Album || !songId || !userId) return '';
    const res = await Album.fromUser({ userId, limit: 50 }).$promise;
    const albums = (res?.data || res || []).slice(0, 50);
    for (const a of albums) {
      let posts = a.posts;
      if (!Array.isArray(posts)) posts = (await Album.get({ id: a.id }).$promise)?.posts || [];
      if (posts.some((p) => p?.revision?.song?.id === songId)) return a.name || '';
    }
    return '';
  }

  // ---------- the check dialog ----------
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  function options(values, selected, label) {
    return values.map((v, i) => `<option value="${esc(v)}"${String(v) === String(selected) ? ' selected' : ''}>${esc(label ? label[i] : v)}</option>`).join('');
  }
  function openDialog() {
    const d = details();
    if (!d) return;
    const year = new Date().getFullYear();
    const years = Array.from({ length: 60 }, (_, i) => year + 1 - i);
    const wrap = document.createElement('div');
    wrap.className = 'bp-genius-dialog';
    wrap.dataset.bp = '';
    wrap.setAttribute('role', 'dialog');
    wrap.innerHTML = `
      <div class="bp-genius-box">
        <div class="bp-genius-title">Publish to Genius</div>
        <div class="bp-genius-row">
          ${d.cover ? `<img class="bp-genius-cover" src="${esc(d.cover)}" alt="">` : '<div class="bp-genius-cover bp-genius-nocover">No cover</div>'}
          <div class="bp-genius-fields">
            <label>Title<input data-k="title" value="${esc(d.title)}"></label>
            <label>Artist on Genius<input data-k="artist" value="${esc(d.artist)}" placeholder="Your artist name, e.g. Quoats"></label>
            <label>Album <small data-k="albumState">(checking BandLab…)</small><input data-k="album" placeholder="Not on an album"></label>
            <div class="bp-genius-date">
              <span>Release date</span>
              <div>
                <select data-k="month">${options(MONTHS.map((_, i) => i + 1), d.date.getMonth() + 1, MONTHS)}</select>
                <select data-k="day">${options(Array.from({ length: 31 }, (_, i) => i + 1), d.date.getDate())}</select>
                <select data-k="year">${options(years, d.date.getFullYear())}</select>
              </div>
            </div>
          </div>
        </div>
        <label>Lyrics <small>(from Lyrics/Notes)</small><textarea data-k="lyrics" rows="8" placeholder="No lyrics in the Lyrics/Notes panel yet">${esc(d.lyrics)}</textarea></label>
        <div class="bp-genius-match" data-k="match"></div>
        <label>Already on Genius? <small>Paste its page link and the button will open it</small><input data-k="link" value="${esc(linkFor(d.songId))}" placeholder="https://genius.com/Quoats-…-lyrics"></label>
        <div class="bp-genius-note">Opens Genius's Add A Song page with all of this filled in (Primary Tag: Rap, Language: English). Check it there, then press Submit on Genius.</div>
        <div class="bp-genius-buttons"><div class="bp-genius-cancel">Cancel</div><div class="bp-genius-go">Open Genius</div></div>
      </div>`;
    const field = (k) => wrap.querySelector(`[data-k="${k}"]`);
    const val = (k) => field(k).value.trim();
    // Keys typed here are ours, not BandLab shortcuts (S would slice, digits would jump markers).
    wrap.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') wrap.remove(); });
    wrap.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.target === wrap) wrap.remove(); });
    wrap.querySelector('.bp-genius-cancel').addEventListener('click', () => wrap.remove());

    // What the matcher found for this track (match.js): linked, a suggestion, or nothing.
    function showMatch() {
      const box = field('match');
      const m = matches[d.songId];
      const linked = linkFor(d.songId);
      box.replaceChildren();
      const line = (html) => { const p = document.createElement('div'); p.innerHTML = html; box.appendChild(p); return p; };
      if (m === 'checking') line('Looking for this song on Genius…');
      else if (m?.error) line(`Couldn't check Genius (${esc(m.error)}). Open genius.com once, then check again.`);
      else if (m?.best && linked && m.best.url === linked) line(`Found on Genius: <b>${esc(m.best.title)}</b> <small>(${esc(m.best.why)})</small>`);
      else if (m?.best && !linked) {
        const p = line(`Looks like this is on Genius: <b>${esc(m.best.title)}</b> <small>(${esc(m.best.why)})</small> <span class="bp-genius-use">Use this</span>`);
        p.querySelector('.bp-genius-use').addEventListener('click', () => {
          field('link').value = m.best.url;
          field('link').dispatchEvent(new Event('input'));
        });
      } else if (m && !m.best) line('Not found among your songs on Genius.');
      if (m && m !== 'checking') {
        line('<span class="bp-genius-use">Check Genius again</span>').firstChild
          .addEventListener('click', () => { lookUp(d, val('artist'), true).then(showMatch); showMatch(); });
      }
    }
    // (Looks it up now if it hasn't been yet; redraws when the answer comes.)
    const check = () => {
      if (val('artist') && (!matches[d.songId] || matches[d.songId] === 'checking')) lookUp(d, val('artist')).then(showMatch);
      showMatch();
    };
    check();
    field('artist').addEventListener('change', check);

    findAlbum(d.songId, d.authorId)
      .then((name) => {
        if (!field('album').value) field('album').value = name;
        field('albumState').textContent = name ? '(from BandLab)' : '(not on a BandLab album)';
      })
      .catch(() => { field('albumState').textContent = '(couldn\'t check BandLab)'; });

    // With a link pasted, the button just saves it (no new Add A Song).
    const go = wrap.querySelector('.bp-genius-go');
    const relabel = () => {
      const link = val('link');
      go.textContent = link && link !== linkFor(d.songId) ? 'Save link' : link ? 'Open in Genius' : 'Open Genius';
    };
    field('link').addEventListener('input', relabel);
    relabel();
    go.addEventListener('click', () => {
      const link = val('link');
      if (link !== linkFor(d.songId)) {
        if (link && !/^https:\/\/genius\.com\/\S+$/.test(link)) return field('link').focus();
        window.postMessage({ bp: 'genius-link-v1', songId: d.songId, url: link }, location.origin);
        if (link) { wrap.remove(); return; }
      } else if (link) {
        window.open(link, '_blank');
        wrap.remove();
        return;
      }
      if (!val('title')) return field('title').focus();
      const pad = (n) => String(n).padStart(2, '0');
      const out = {
        songId: d.songId,
        title: val('title'),
        artist: val('artist'),
        album: val('album'),
        date: `${val('year')}-${pad(val('month'))}-${pad(val('day'))}`,
        lyrics: field('lyrics').value,
        cover: d.cover,
      };
      remember('bp:genius:artist', out.artist);
      // content.js hands this to genius.js through the extension's storage.
      window.postMessage({ bp: 'genius-v1', song: out }, location.origin);
      window.open('https://genius.com/new', '_blank');
      wrap.remove();
    });
    document.documentElement.appendChild(wrap);
    if (!field('artist').value) field('artist').focus();
  }

  // ---------- finding the track on Genius ----------
  // Asks background.js (through content.js) which of your Genius songs this is, by name,
  // cover, date and lyrics, so "Råce ✓" here still finds "Race" there. A sure match is
  // linked right away; a likely one is offered in the dialog.
  const matches = {};       // song id -> 'checking' | { best, stale } | { error }
  const pending = {};
  const iso = (dt) => (dt instanceof Date && !Number.isNaN(dt.getTime()) ? dt.toISOString().slice(0, 10) : '');
  function lookUp(d, artist, again = false) {
    if (!artist || !d?.songId) return Promise.resolve();
    if (pending[d.songId]) return pending[d.songId];
    if (matches[d.songId] && !again) return Promise.resolve();
    matches[d.songId] = 'checking';
    const reqId = Math.random().toString(36).slice(2);
    pending[d.songId] = new Promise((resolve) => {
      let timer = 0;
      const finish = (res) => {
        removeEventListener('message', onAnswer);
        clearTimeout(timer);
        delete pending[d.songId];
        matches[d.songId] = res?.error ? { error: res.error } : { best: res?.best || null, stale: !!res?.stale };
        // Sure, and you haven't linked or unlinked this track yourself: link it.
        if (res?.best?.sure && !decided(d.songId)) {
          window.postMessage({ bp: 'genius-link-v1', songId: d.songId, url: res.best.url }, location.origin);
        }
        resolve();
      };
      const onAnswer = (e) => {
        if (e.source === window && e.data?.bp === 'genius-match-result' && e.data.reqId === reqId) finish(e.data.res);
      };
      timer = setTimeout(() => finish({ error: 'Genius took too long' }), 90000);
      addEventListener('message', onAnswer);
      window.postMessage({
        bp: 'genius-match-v1', reqId, artist,
        track: { title: d.title, cover: d.cover, date: iso(d.date), lyrics: d.lyrics },
      }, location.origin);
    });
    return pending[d.songId];
  }

  // ---------- the button ----------
  // Songs already on Genius (BandLab song id -> Genius page, or null for "not on Genius"),
  // kept by content.js on <html>.
  function links() {
    try { return JSON.parse(document.documentElement.dataset.bpGeniusLinks || '{}'); } catch { return {}; }
  }
  const linkFor = (songId) => links()[songId] || '';
  const decided = (songId) => songId in links();
  const button = document.createElement('div');
  button.className = 'bp-genius-btn';
  button.dataset.bp = '';
  // (A small "G" badge: a plain drawn mark, not Genius's own logo file.)
  button.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect width="16" height="16" rx="3" fill="#000"/>'
    + '<text x="8" y="12" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="11" fill="#ffff64">G</text></svg>'
    + '<span>Publish to Genius</span>';
  const label = button.querySelector('span');
  let shownLink = null;
  function refreshButton() {
    const link = linkFor(services()?.revision.current?.song?.id);
    if (link === shownLink) return;
    shownLink = link;
    button.classList.toggle('bp-genius-open', !!link);
    label.textContent = link ? 'Open in Genius' : 'Publish to Genius';
    button.title = link ? `Bandlab+: open this song on Genius (Shift+click for the publish options)\n${link}`
      : 'Bandlab+: fill in Genius\'s Add A Song form with this track';
  }
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    const link = linkFor(services()?.revision.current?.song?.id);
    if (link && !e.shiftKey) window.open(link, '_blank');
    else openDialog();
  });
  setInterval(() => {
    const songId = services()?.revision.current?.song?.id;
    if (!songId) return;
    refreshButton();
    // Not linked yet and your Genius name is known: look for it on Genius (once per visit).
    const artist = recall('bp:genius:artist');
    if (artist && !decided(songId) && !matches[songId]) lookUp(details(), artist);
    // Right of "Fix editing"; next to Publish if that button isn't there.
    const fix = document.querySelector('.bp-fix-btn');
    if (fix) {
      if (fix.nextElementSibling !== button) fix.after(button);
      return;
    }
    if (button.isConnected) return;
    const publish = [...document.querySelectorAll('.mix-editor-header button, .mix-editor-header-content button')]
      .find((b) => /^\s*publish\s*$/i.test(b.textContent));
    if (publish) publish.after(button);
  }, 1000);
})();
