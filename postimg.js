// Bandlab+ cover hand-off on postimages. Runs on postimages.org and postimg.cc.
//
// After "Upload cover to postimages" on Genius, the BandLab cover is on your clipboard. Here
// you paste it (Ctrl+V) and upload it yourself (postimages may ask you to prove you're human);
// once the result page shows, its Direct link goes back to the Genius tab as the Song Art.
// This never uploads anything by itself and only acts within 30 minutes of that button.
(() => {
  'use strict';
  const WINDOW = 30 * 60 * 1000;

  function banner(text) {
    document.getElementById('bp-postimg-banner')?.remove();
    const b = document.createElement('div');
    b.id = 'bp-postimg-banner';
    b.textContent = text;
    b.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;'
      + 'background:#ffff64;color:#000;font:700 14px sans-serif;padding:10px 16px;border-radius:8px;'
      + 'box-shadow:0 6px 24px rgba(0,0,0,.35);cursor:pointer';
    b.title = 'Click to hide';
    b.addEventListener('click', () => b.remove());
    (document.body || document.documentElement).appendChild(b);
  }

  chrome.storage.local.get('bp:genius:awaitCover', (r) => {
    const since = r['bp:genius:awaitCover'];
    if (!since || Date.now() - since > WINDOW) return;
    const direct = document.getElementById('direct');
    const url = direct?.value || '';
    if (/^https:\/\/i\.postimg\.cc\/\S+$/.test(url)) {
      chrome.storage.local.set({ 'bp:genius:cover': { url, at: Date.now() } });
      chrome.storage.local.remove('bp:genius:awaitCover');
      banner('Bandlab+: cover link sent to Genius ✓  You can close this tab.');
    } else if (location.hostname === 'postimages.org') {
      banner('Bandlab+: your BandLab cover is on the clipboard. Press Ctrl+V here to upload it.');
    }
  });
})();
