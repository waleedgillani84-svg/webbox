/* =========================================================
   WebBox — Service Worker
   Offline-first PWA (GitHub Pages compatible)
   ========================================================= */

const VERSION = 'webbox-v1.0.0';
const STATIC  = VERSION + '-static';
const RUNTIME = VERSION + '-runtime';

/* App shell — pehli baar install pe cache ho jata hai */
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png'
];

/* Ye hosts kabhi cache nahi honge (live API calls) */
const BYPASS_HOSTS = [
  'supabase.co',
  'supabase.in',
  'api.qrserver.com'
];

/* ---------- INSTALL ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC);
    // har URL alag-alag try karo taaki ek fail ho to baaki na rukein
    await Promise.all(
      PRECACHE.map(url => cache.add(url).catch(() => {}))
    );
    self.skipWaiting();
  })());
});

/* ---------- ACTIVATE ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => k !== STATIC && k !== RUNTIME)
        .map(k => caches.delete(k))
    );
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.disable(); } catch (_) {}
    }
    await self.clients.claim();
  })());
});

/* ---------- MESSAGES ---------- */
self.addEventListener('message', (event) => {
  const d = event.data;
  if (d === 'SKIP_WAITING' || (d && d.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
  if (d && d.type === 'CLEAR_CACHE') {
    caches.keys().then(keys => keys.forEach(k => caches.delete(k)));
  }
});

/* ---------- HELPERS ---------- */
function isBypass(url) {
  return BYPASS_HOSTS.some(h =>
    url.hostname === h || url.hostname.endsWith('.' + h)
  );
}

function isCDN(url) {
  return /(?:^|\.)(jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/
    .test(url.hostname);
}

/* ---------- FETCH ---------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  /* Supabase / QR API -> always live network */
  if (isBypass(url)) return;

  /* ---- Navigations: network-first, offline pe shell fallback ---- */
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(STATIC);
        cache.put('./index.html', fresh.clone()).catch(() => {});
        return fresh;
      } catch (_) {
        const cache = await caches.open(STATIC);
        const cached = (await cache.match('./index.html')) || (await cache.match('./'));
        if (cached) return cached;
        return new Response(
          '<!doctype html><meta charset="utf-8"><title>Offline</title>' +
          '<body style="font-family:system-ui;background:#080b12;color:#eef2ff;' +
          'display:grid;place-items:center;height:100vh;margin:0;text-align:center">' +
          '<div><div style="font-size:60px">📴</div>' +
          '<h1 style="margin:8px 0">Offline</h1>' +
          '<p style="color:#8b97b5">WebBox offline hai. Pehli baar online kholna zaroori hai.</p>' +
          '</div></body>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  /* ---- Same-origin + CDN: stale-while-revalidate ---- */
  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin || isCDN(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(sameOrigin ? STATIC : RUNTIME);
      const cached = await cache.match(req);

      const networkPromise = fetch(req).then(res => {
        if (res && (res.status === 200 || res.type === 'opaque')) {
          cache.put(req, res.clone()).catch(() => {});
        }
        return res;
      }).catch(() => null);

      if (cached) {
        // background me update chalta rahe
        networkPromise;
        return cached;
      }

      const fresh = await networkPromise;
      if (fresh) return fresh;
      return new Response('', { status: 503, statusText: 'Offline' });
    })());
    return;
  }

  /* ---- Baaki sab default network ---- */
});