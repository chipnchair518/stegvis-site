/* Stegvis service worker.
 * - HTML pages and data/index.json: network first, cache as fallback (offline).
 * - Guide data, parts and built assets: cache first once fetched, so an opened guide works offline.
 * - Kill switch: if <BASE>sw-state.json says {"off": true}, unregister and delete every Stegvis cache.
 * scripts/prerender.mjs stamps the build version and the asset list into this file.
 */
const VERSION = '2026-10-30-2d336b9dcb';
const PRECACHE = ["assets/Guide-DkneBnsy.js", "assets/Print-BOux8ub6.js", "assets/index-CXuJNJJH.css", "assets/index-CuSbnDDf.js", "assets/stage-DmyMNjVQ.js"];
const BASE = new URL('./', self.location.href).pathname;
const PREFIX = 'stegvis-';
const CACHE = PREFIX + VERSION;
const KILL_URL = BASE + 'sw-state.json';

async function killSwitch() {
  try {
    const res = await fetch(KILL_URL, { cache: 'no-store' });
    if (!res.ok || (await res.json()).off !== true) return false;
  } catch {
    return false; // offline: keep working
  }
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.startsWith(PREFIX)).map((k) => caches.delete(k)));
  await self.registration.unregister();
  return true;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      if (await killSwitch()) return;
      const cache = await caches.open(CACHE);
      await cache.addAll([BASE, ...PRECACHE.map((p) => BASE + p)]).catch(() => {});
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      if (await killSwitch()) return;
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

async function networkFirst(request, fallbackToShell) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    if (fallbackToShell) {
      const shell = (await cache.match(BASE)) || (await cache.match(BASE + 'index.html'));
      if (shell) return shell;
    }
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;
  const path = url.pathname.slice(BASE.length);
  if (path === 'sw-state.json' || path === 'sw.js') return; // always straight to the network

  if (req.mode === 'navigate') {
    // Each page load also checks the kill switch.
    event.waitUntil(killSwitch());
    event.respondWith(networkFirst(req, true));
    return;
  }
  if (path === 'data/index.json' || path.endsWith('.html')) {
    event.respondWith(networkFirst(req, false));
    return;
  }
  if (path.startsWith('data/') || path.startsWith('assets/')) {
    event.respondWith(cacheFirst(req));
    return;
  }
  event.respondWith(networkFirst(req, false));
});
