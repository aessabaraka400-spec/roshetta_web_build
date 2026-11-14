// Roshetta PWA Service Worker v4.0.0
// Offline-First SPA Architecture with Background Sync and Stale-While-Revalidate

const CACHE_NAME = 'roshetta-pwa-v23';

const PRECACHE_ASSETS = [
  '/',
  '/manifest.json',
  '/favicon.ico',
  '/apple-touch-icon.png',
  '/apple-touch-icon-precomposed.png',
  '/icon-192.png',
  '/icon-512.png',
  '/_expo/static/js/web/index-90ec525af01e86573b22a34d87084bad.js'
];

// Install: precache application shell with fault tolerance
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await Promise.allSettled(
        PRECACHE_ASSETS.map(async (url) => {
          try {
            const res = await fetch(url, { cache: 'no-cache' });
            if (res && res.status === 200) {
              await cache.put(url, res.clone());
              if (url === '/') {
                await cache.put('/index.html', res.clone());
              }
            }
          } catch (e) {
            console.warn('[SW] Precache item failed:', url, e.message);
          }
        })
      );
    })()
  );
});

// Activate: clean up outdated caches and immediately take control
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          }
        })
      );
      await self.clients.claim();
    })()
  );
});

// Fetch: smart routing
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // 1. Only handle GET requests
  if (request.method !== 'GET') {
    return;
  }

  // 2. Bypass API calls and browser extensions
  // (API data is persisted in browser localStorage / IndexedDB via Zustand)
  if (
    url.pathname.startsWith('/api') ||
    url.hostname.includes('alwaysdata.net') ||
    (url.hostname.includes('localhost') && url.port === '3001') ||
    url.protocol.startsWith('chrome-extension')
  ) {
    return;
  }

  // 3. Navigation requests (HTML pages / Route changes / Page refresh / PWA Launch)
  // Network-First with 3s timeout & offline cache fallback so new deployments take effect on refresh.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 3000);
          const networkResponse = await fetch(request, {
            cache: 'no-cache',
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (networkResponse && networkResponse.status === 200) {
            await cache.put('/', networkResponse.clone());
            await cache.put('/index.html', networkResponse.clone());
            return networkResponse;
          }
        } catch (err) {
          // Offline or slow network -> fall through to cached shell
        }

        try {
          const cached =
            (await cache.match('/')) ||
            (await cache.match('/index.html')) ||
            (await cache.match(request));
          if (cached) {
            return cached;
          }

          const allKeys = await caches.keys();
          for (const key of allKeys) {
            const oldCache = await caches.open(key);
            const fallback = (await oldCache.match('/')) || (await oldCache.match('/index.html'));
            if (fallback) return fallback;
          }
        } catch (err) {
          console.warn('[SW] Navigation error:', err);
        }

        // Inline fallback shell (never 503 or ERR_FAILED)
        return new Response('<!DOCTYPE html><html><head><meta charset="utf-8"><title>روشتة</title></head><body style="background:#0F172A;color:#FFF;text-align:center;padding:40px;font-family:sans-serif;"><h2>روشتة - المنظومة غير متصلة</h2><p>يرجى فتح التطبيق مرة واحدة أثناء الاتصال بالإنترنت لتثبيت ملفات التشغيل بدون إنترنت.</p></body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      })()
    );
    return;
  }

  // 4. Static assets (JS, CSS, fonts, images)
  // Cache-First with Stale-While-Revalidate background update
  event.respondWith(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(request);
        if (cached) {
          // Revalidate in background
          fetch(request).then(async (networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              await cache.put(request, networkResponse);
            }
          }).catch(() => {});
          return cached;
        }

        // Bundle fallback: if a JS bundle is requested but hash differs, return the cached JS bundle
        if (url.pathname.includes('/_expo/static/js/web/index-')) {
          const keys = await cache.keys();
          const jsKey = keys.find(k => k.url.includes('/_expo/static/js/web/index-'));
          if (jsKey) {
            const fallbackJs = await cache.match(jsKey);
            if (fallbackJs) return fallbackJs;
          }
        }

        // Fetch from network
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.status === 200) {
          cache.put(request, networkResponse.clone());
        }
        return networkResponse;
      } catch (e) {
        // Fallback for failed network requests when offline:
        if (request.destination === 'image' || url.pathname.endsWith('.png') || url.pathname.endsWith('.jpg') || url.pathname.endsWith('.ico')) {
          // Transparent 1x1 pixel PNG
          return new Response(
            new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]),
            { status: 200, headers: { 'Content-Type': 'image/png' } }
          );
        }
        return new Response('', { status: 200, headers: { 'Content-Type': 'text/plain' } });
      }
    })()
  );
});
