// CACHE and SHELL are injected during npm run build.
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('tum-pwa-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')));
    return;
  }
  if (SHELL.includes(url.pathname)) {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
  }
});
self.addEventListener('push', (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {
      body: event.data ? event.data.text() : '',
    };
  }

  const title = payload.title || 'TUM';
  const options = {
    body: payload.body || 'Você recebeu um novo aviso do TUM.',
    icon: payload.icon || '/icon-192.png',
    badge: payload.badge || '/icon-192.png',
    data: payload.data || {},
    vibrate: [250, 180, 250],
    tag:
      payload.data?.campaign_id ||
      `tum-${Date.now()}`,
    renotify: true,
  };

  event.waitUntil(
    self.registration.showNotification(
      title,
      options,
    ),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const rawTarget =
    event.notification.data?.url || '/';

  let targetUrl = self.location.origin + '/';
  try { const url = new URL(rawTarget, self.location.origin); if (url.origin === self.location.origin) targetUrl = url.href; } catch {}

  event.waitUntil(
    self.clients
      .matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      .then(async (clientList) => {
        for (const client of clientList) {
          if (
            new URL(client.url).origin ===
            self.location.origin
          ) {
            if ('navigate' in client) {
              await client.navigate(targetUrl);
            }

            return client.focus();
          }
        }

        return self.clients.openWindow(targetUrl);
      }),
  );
});
