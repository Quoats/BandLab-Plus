// Bandlab+ song matching: which Genius song is this BandLab track? Used by background.js.
//
// Names are compared after folding stylized spellings ("Råce ✓" ~ "Race", "Đ34Đ" ~ "Dead",
// "[w/ Zooted.WRLD]" dropped), covers by a tiny image fingerprint, plus release date and,
// as a tie-breaker, lyrics. A match is "sure" only when the signals agree; otherwise it's
// offered as a suggestion.
(() => {
  'use strict';
  // Letters that don't break down into a base letter + accent.
  const SPECIAL = {
    'ø': 'o', 'đ': 'd', 'ð': 'd', 'ł': 'l', 'ŧ': 't', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'þ': 'th', 'ħ': 'h',
    'ŋ': 'n', 'ı': 'i', 'ƒ': 'f', 'ɨ': 'i', 'ʉ': 'u', 'ɍ': 'r', 'ɏ': 'y', 'ƶ': 'z', 'ȼ': 'c', 'ɇ': 'e', 'ɉ': 'j',
    'ꝁ': 'k', 'ƙ': 'k', 'ɗ': 'd', 'ƴ': 'y', 'ȥ': 'z', 'ɓ': 'b', 'ƈ': 'c', 'ɠ': 'g', 'ɦ': 'h', 'ʝ': 'j', 'ɱ': 'm',
    'ɲ': 'n', 'ƥ': 'p', 'ʠ': 'q', 'ʂ': 's', 'ƭ': 't', 'ʋ': 'v', 'ⱳ': 'w', 'ɀ': 'z', 'ŀ': 'l', 'ĸ': 'k',
  };
  const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g', '@': 'a', $: 's' };

  function fold(title) {
    let s = String(title || '')
      .replace(/\[[^\]]*\]|\([^)]*\b(feat|ft|with|w\/|prod)\b[^)]*\)/gi, ' ')  // [w/ …], (feat. …)
      .normalize('NFKD').replace(/\p{M}/gu, '')                            // å -> a, ë -> e
      .toLowerCase();
    s = [...s].map((c) => SPECIAL[c] ?? c).join('');
    return s.replace(/[^\p{L}\p{N}@$]+/gu, '');
  }
  const leet = (s) => [...s].map((c) => LEET[c] ?? c).join('').replace(/[^\p{L}]+/gu, '');

  function lev(a, b) {
    if (a === b) return 0;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }
  function ratio(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const short = a.length < b.length ? a : b;
    const long = a.length < b.length ? b : a;
    if (short.length >= 4 && long.includes(short)) return 0.9;  // "race" in "racereprise"
    return 1 - lev(a, b) / Math.max(a.length, b.length);
  }
  function nameScore(a, b) {
    const fa = fold(a);
    const fb = fold(b);
    return Math.max(ratio(fa, fb), ratio(leet(fa), leet(fb)), ratio(leet(fa), fb), ratio(fa, leet(fb)));
  }

  // Dates as {year, month, day} (any part may be missing).
  function dateScore(a, b) {
    if (!a?.year || !b?.year) return null;
    if (a.year !== b.year) return Math.abs(a.year - b.year) === 1 && a.month && b.month ? 0.1 : 0;
    if (!a.month || !b.month) return 0.3;
    if (a.month !== b.month) return 0.3;
    if (!a.day || !b.day) return 0.6;
    return a.day === b.day ? 1 : Math.abs(a.day - b.day) <= 3 ? 0.8 : 0.6;
  }

  // Covers as 64-bit difference hashes in hex (see background.js); close hashes = same art.
  function coverScore(a, b) {
    if (!a || !b || a.length !== b.length) return null;
    let d = 0;
    for (let i = 0; i < a.length; i++) {
      let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
      while (x) { d += x & 1; x >>= 1; }
    }
    return d <= 6 ? 1 : d <= 12 ? 0.7 : d <= 18 ? 0.3 : 0;
  }

  const words = (t) => new Set(fold(t).length ? String(t).toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '')
    .split(/[^\p{L}\p{N}']+/u).filter((w) => w.length >= 3) : []);
  function lyricsScore(a, b) {
    const A = words(a);
    const B = words(b);
    if (A.size < 8 || B.size < 8) return null;
    let both = 0;
    for (const w of A) if (B.has(w)) both++;
    return both / Math.min(A.size, B.size);
  }

  // track: {title, date, coverHash, lyrics}; candidates: [{title, date, coverHash, lyrics, ...}]
  // Returns candidates sorted best first, each with .score, .why and .sure.
  function rank(track, candidates) {
    const out = candidates.map((c) => {
      const s = {
        name: nameScore(track.title, c.title),
        cover: coverScore(track.coverHash, c.coverHash),
        date: dateScore(track.date, c.date),
        lyrics: lyricsScore(track.lyrics, c.lyrics),
      };
      const W = { name: 0.45, cover: 0.35, date: 0.1, lyrics: 0.1 };
      let sum = 0;
      let wsum = 0;
      for (const k in W) if (s[k] !== null) { sum += s[k] * W[k]; wsum += W[k]; }
      return { ...c, scores: s, score: wsum ? sum / wsum : 0 };
    }).sort((a, b) => b.score - a.score);
    const [best, next] = out;
    if (best) {
      const s = best.scores;
      const agree = (s.cover ?? 0) >= 0.7 || s.date === 1 || (s.lyrics ?? 0) >= 0.5;
      const clear = !next || best.score - next.score >= 0.08 || (s.cover ?? 0) >= 0.7;
      best.sure = clear && (((s.cover ?? 0) >= 0.7 && s.name >= 0.4)
        || (s.name >= 0.85 && agree)
        || (s.name >= 0.999 && s.cover !== 0 && (s.date ?? 1) >= 0.3));
      // Worth asking about: a fair overall score, or the same cover from about the same time
      // (a full rename). Below that, no match.
      best.suggest = !best.sure && (best.score >= 0.495 || ((s.cover ?? 0) >= 0.7 && (s.date ?? 0) >= 0.6));
      best.why = [
        `name ${Math.round(s.name * 100)}%`,
        s.cover === null ? null : s.cover >= 0.7 ? 'same cover' : 'different cover',
        s.date === null ? null : s.date === 1 ? 'same date' : s.date >= 0.6 ? 'same month' : s.date > 0 ? 'same year' : 'different date',
        s.lyrics === null ? null : `lyrics ${Math.round(s.lyrics * 100)}%`,
      ].filter(Boolean).join(', ');
    }
    return out;
  }

  // The artist's songs on Genius, from the JSON its own pages load. `getJson(path)` fetches a
  // genius.com path (from the background with your session, or from a genius.com page).
  async function fetchCatalog(artist, getJson) {
    const found = await getJson(`/api/search/artist?q=${encodeURIComponent(artist)}`);
    const hits = (found?.response?.sections || []).flatMap((s) => s.hits || []).map((h) => h.result).filter((r) => r?.name);
    const me = hits.find((r) => fold(r.name) === fold(artist)) || hits.find((r) => nameScore(r.name, artist) >= 0.9);
    if (!me) throw new Error(`no artist called "${artist}" on Genius`);
    const songs = [];
    for (let page = 1; page && page <= 20;) {
      const d = await getJson(`/api/artists/${me.id}/songs?per_page=50&page=${page}&sort=title`);
      for (const x of d?.response?.songs || []) {
        const mine = x.primary_artist?.id === me.id || (x.primary_artists || []).some((a) => a.id === me.id);
        if (mine) {
          songs.push({
            id: x.id, title: x.title, url: x.url,
            art: x.song_art_image_thumbnail_url || x.song_art_image_url || '',
            date: x.release_date_components || null,
          });
        }
      }
      page = d?.response?.next_page || 0;
    }
    return { artist, artistId: me.id, songs, at: Date.now() };
  }

  globalThis.BPMatch = { fold, nameScore, dateScore, coverScore, lyricsScore, rank, fetchCatalog };
})();
