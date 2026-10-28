// Service worker: the whole app from the cache, so mapping and playing the maps stored in the browser works with
// no network. The build (vite-pwa.ts) puts the file lists above this: every built file with a hash of its contents,
// except ffmpeg (32 MB, only for converting old background videos), which is cached the first time it's used.
/* global PRECACHE, LAZY, VERSION */
const PREFIX = 'osu-browser-';
const CACHE = PREFIX + VERSION;
/** ffmpeg's files are named by their contents, so this cache outlives versions (pruned to the current names). */
const LAZY_CACHE = PREFIX + 'ffmpeg';
/** The precache list a version was installed from, kept in its cache so the next one can tell what changed. */
const MANIFEST = '/__precache.json';
/** How long a page load waits for the network before the cached app is used instead. */
const PAGE_TIMEOUT_MS = 4000;

self.addEventListener('install', (e) => e.waitUntil(install()));

async function install() {
  const cache = await caches.open(CACHE);
  // Files unchanged since the installed version are copied from its cache rather than downloaded again.
  const prev = await previousCache();
  const prevRevs = prev ? await prev.match(MANIFEST).then((r) => (r ? r.json() : {})) : {};
  const urls = Object.keys(PRECACHE);
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++];
      const old = prev && prevRevs[url] === PRECACHE[url] ? await prev.match(url) : undefined;
      if (old) {
        await cache.put(url, old);
        continue;
      }
      const r = await fetch(url, { cache: 'no-cache' });
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      await cache.put(url, r);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  await cache.put(MANIFEST, new Response(JSON.stringify(PRECACHE)));
}

/** The newest other version's cache, if one is installed. */
async function previousCache() {
  const keys = (await caches.keys()).filter((k) => k.startsWith(PREFIX) && k !== CACHE && k !== LAZY_CACHE);
  return keys.length ? caches.open(keys[keys.length - 1]) : null;
}

self.addEventListener('activate', (e) =>
  e.waitUntil(
    (async () => {
      // The version before stays until the next update: a tab still running it loads its remaining chunks from there.
      const old = (await caches.keys()).filter((k) => k.startsWith(PREFIX) && k !== CACHE && k !== LAZY_CACHE);
      await Promise.all(old.slice(0, -1).map((k) => caches.delete(k)));
      const lazy = await caches.open(LAZY_CACHE);
      for (const req of await lazy.keys()) if (!LAZY.includes(new URL(req.url).pathname)) await lazy.delete(req);
      await self.clients.claim();
    })(),
  ),
);

// The page asks for this when the player chooses to reload into the new version.
self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') void self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // The API (login, Drive tokens, the mirror proxy) always goes to the network and is never stored.
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') e.respondWith(page(req, url));
  else if (LAZY.includes(url.pathname)) e.respondWith(lazy(req, url));
  // A chunk outside this version's list is a tab still on the previous one, served from that version's cache.
  else if (url.pathname in PRECACHE || url.pathname.startsWith('/assets/')) e.respondWith(cached(req, url));
});

/** Pages: the network first, so a deploy shows on the next load; the cached app when offline or too slow. */
async function page(req, url) {
  try {
    const r = await fetch(req, { signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) });
    if (r.ok) return r;
  } catch {
    // offline, or the network is too slow
  }
  // Every path but the static pages is the app (the hosts rewrite them all to index.html).
  const path = url.pathname.endsWith('.html') && url.pathname in PRECACHE ? url.pathname : '/index.html';
  return (await (await caches.open(CACHE)).match(path)) ?? (await caches.match(path)) ?? Response.error();
}

/** Built files: from the cache (their names change with their contents), the network only if it lost them. */
async function cached(req, url) {
  const hit = (await (await caches.open(CACHE)).match(url.pathname)) ?? (await caches.match(url.pathname));
  return hit ?? fetch(req);
}

async function lazy(req, url) {
  const cache = await caches.open(LAZY_CACHE);
  const hit = await cache.match(url.pathname);
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok) await cache.put(url.pathname, r.clone());
  return r;
}
