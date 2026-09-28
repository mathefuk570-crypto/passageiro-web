// TUM PWA — este service worker não mantém cache de interface.
// Ao substituir uma versão antiga, limpa caches legados para evitar que o
// passageiro continue abrindo arquivos da PWA anterior.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
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

  const targetUrl = new URL(
    rawTarget,
    self.location.origin,
  ).href;

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
