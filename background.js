// Bandlab+ background: finds a BandLab track's song on Genius when the names don't match
// exactly ("Råce ✓" on BandLab, "Race" on Genius). Compares name, cover (a tiny image
// fingerprint), release date and, to settle a close call, lyrics. See match.js.
//
// Your Genius songs come from the JSON Genius's own pages load, fetched with your normal
// browser session and kept for 6 hours. If Genius ever refuses the background, genius.js
// refreshes the list whenever a genius.com page is open.
importScripts('match.js');

const CATALOG_TTL = 6 * 60 * 60 * 1000;
const CATALOGS = 'bp:genius:catalogs';  // fold(artist) -> catalog
const HASHES = 'bp:genius:hashes';      // image URL -> 64-bit difference hash (hex)

async function getJson(path) {
  const r = await fetch(new URL(path, 'https://genius.com'), { credentials: 'include', headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`Genius said ${r.status}`);
  return r.json();
}

async function catalogFor(artist) {
  const key = BPMatch.fold(artist);
  const all = (await chrome.storage.local.get(CATALOGS))[CATALOGS] || {};
  const cached = all[key];
  if (cached && Date.now() - cached.at < CATALOG_TTL) return { catalog: cached };
  try {
    const catalog = await BPMatch.fetchCatalog(artist, getJson);
    all[key] = catalog;
    await chrome.storage.local.set({ [CATALOGS]: all });
    return { catalog };
  } catch (e) {
    // (An older list still beats none; the user can open genius.com to refresh it.)
    if (cached) return { catalog: cached, stale: true };
    throw e;
  }
}

// ---------- cover fingerprints ----------
let hashCache = null;
let hashesDirty = false;
async function hashes() {
  hashCache ||= (await chrome.storage.local.get(HASHES))[HASHES] || {};
  return hashCache;
}
// A difference hash: shrink to 9x8 grey, one bit per "is this pixel brighter than its
// right-hand neighbour". The same artwork at any size or compression gives nearly the same bits.
async function dhash(url) {
  const cache = await hashes();
  if (cache[url]) return cache[url];
  const r = await fetch(url);
  if (!r.ok) throw new Error(`image ${r.status}`);
  const bmp = await createImageBitmap(await r.blob());
  // Shrink in halves to 72x64 (one straight jump to 9x8 would skip most pixels and give a
  // different answer at every size), then average 8x8 blocks into the 9x8 grid.
  let src = bmp;
  let w = bmp.width;
  let h = bmp.height;
  while (w / 2 >= 72 && h / 2 >= 64) {
    w = Math.round(w / 2);
    h = Math.round(h / 2);
    const step = new OffscreenCanvas(w, h);
    const sg = step.getContext('2d');
    sg.imageSmoothingQuality = 'high';
    sg.drawImage(src, 0, 0, w, h);
    src = step;
  }
  const c = new OffscreenCanvas(72, 64);
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, 72, 64);
  const big = g.getImageData(0, 0, 72, 64).data;
  const grid = new Float32Array(72);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 72; x++) {
      const i = (y * 72 + x) * 4;
      grid[(y >> 3) * 9 + (x >> 3)] += big[i] * 0.299 + big[i + 1] * 0.587 + big[i + 2] * 0.114;
    }
  }
  const lum = (x, y) => grid[y * 9 + x];
  let hex = '';
  for (let y = 0; y < 8; y++) {
    let nib = 0;
    for (let x = 0; x < 8; x++) {
      nib = (nib << 1) | (lum(x, y) > lum(x + 1, y) ? 1 : 0);
      if (x % 4 === 3) { hex += nib.toString(16); nib = 0; }
    }
  }
  cache[url] = hex;
  hashesDirty = true;
  return hex;
}
async function saveHashes() {
  if (hashesDirty) { hashesDirty = false; await chrome.storage.local.set({ [HASHES]: hashCache }); }
}
// A few at a time, so a big catalog doesn't open dozens of downloads at once.
async function eachLimited(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

// ---------- lyrics (only to settle a close call) ----------
async function lyricsOf(url) {
  const html = await (await fetch(url, { credentials: 'include' })).text();
  let text = '';
  for (const part of html.split('data-lyrics-container="true"').slice(1)) {
    const end = part.search(/<div[^>]*class="[^"]*(LyricsFooter|RightSidebar|Lyrics__Footer)/);
    text += ` ${(end > 0 ? part.slice(0, end) : part.slice(0, 20000)).replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, ' ')}`;
  }
  return text.replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');
}

const toDate = (iso) => {
  const [year, month, day] = String(iso || '').split('-').map(Number);
  return year ? { year, month, day } : null;
};

async function match({ artist, track }) {
  const { catalog, stale } = await catalogFor(artist);
  const cover = track.cover ? track.cover.replace(/\d+x\d+$/, '300x300') : '';
  const me = { title: track.title, date: toDate(track.date), lyrics: track.lyrics || '', coverHash: null };
  try { if (cover) me.coverHash = await dhash(cover); } catch { /* no cover to compare */ }
  const cands = catalog.songs.map((s) => ({ ...s, coverHash: null }));
  await eachLimited(cands.filter((c) => c.art), 6, async (c) => {
    try { c.coverHash = await dhash(c.art); } catch { /* skip this one's cover */ }
  });
  await saveHashes();
  let ranked = BPMatch.rank(me, cands);
  // Close call with lyrics on hand: read the top few songs' lyrics and rank again.
  if (ranked[0] && !ranked[0].sure && me.lyrics.trim().length > 40) {
    await eachLimited(ranked.slice(0, 3), 3, async (c) => {
      try { c.lyrics = await lyricsOf(c.url); } catch { /* fine */ }
    });
    ranked = BPMatch.rank(me, ranked);
  }
  const best = ranked[0];
  return {
    stale: !!stale,
    best: best && (best.sure || best.suggest)
      ? { title: best.title, url: best.url, score: best.score, why: best.why, sure: !!best.sure } : null,
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === 'bp-genius-match') {
    match(msg).then(reply, (e) => reply({ error: String(e?.message || e) }));
    return true;  // (answering later)
  }
  if (msg?.type === 'bp-genius-catalog' && msg.catalog?.songs) {
    // genius.js fetched it from a genius.com page.
    chrome.storage.local.get(CATALOGS).then((r) => {
      const all = r[CATALOGS] || {};
      all[BPMatch.fold(msg.catalog.artist)] = msg.catalog;
      chrome.storage.local.set({ [CATALOGS]: all });
    });
  }
  return false;
});
