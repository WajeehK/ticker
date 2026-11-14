/* Ticker service worker (build t7).
   App shell: cache-first, refreshed per build. Quote/history JSON: network-first. */
const SHELL = 'ticker-shell-t7';
const DATA = 'ticker-data';
const ASSETS = [
  './', './index.html', './manifest.webmanifest',
  './style.css?v=t7', './app.js?v=t7',
  './vendor/lightweight-charts.js?v=t7',
  './icons/icon-192.png', './icons/icon-512.png',
  './icons/apple-touch-icon.png', './icons/favicon.svg', './icons/favicon-32.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(
      ks.filter(k => k.startsWith('ticker-shell-') && k !== SHELL).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.includes('/img/')) {
    e.respondWith(
      caches.open('ticker-img').then(c =>
        c.match(req).then(hit => hit || fetch(req).then(r => {
          if (r.ok) c.put(req, r.clone());
          return r;
        }).catch(() => hit))
      )
    );
    return;
  }
  if (url.pathname.includes('/data/')) {
    e.respondWith(
      fetch(req).then(r => {
        if (r.ok) {
          const cp = r.clone();
          caches.open(DATA).then(async c => {
            for (const k of await c.keys()) {
              if (new URL(k.url).pathname === url.pathname && k.url !== req.url) c.delete(k);
            }
            c.put(req, cp);
          });
        }
        return r;
      }).catch(() => caches.match(req, { ignoreSearch: true }))
    );
    return;
  }
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(r => {
        const cp = r.clone();
        caches.open(SHELL).then(c => c.put('./index.html', cp));
        return r;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) {
      if (c.url.includes('/ticker') && 'focus' in c) {
        c.postMessage({ type: 'open', url: target });
        return c.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  }));
});
