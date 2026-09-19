// CumpleApp Service Worker + Firebase Cloud Messaging
// Notificaciones personalizadas con la web cerrada.

self.addEventListener('notificationclick', function(event) {
  const action = event.action || 'open';
  event.notification.close();

  if (action === 'dismiss') return;

  const targetUrl =
    (event.notification.data && event.notification.data.url) ||
    './Cumple.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(windowClients) {
      for (const client of windowClients) {
        if ('focus' in client) {
          try {
            client.navigate(targetUrl);
          } catch (_) {}
          return client.focus();
        }
      }

      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// Configuración compartida con la página.
importScripts('./firebase-config.js');

// Firebase Messaging en service worker sin bundler.
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js');

if (
  self.CUMPLEAPP_FIREBASE_CONFIG &&
  self.CUMPLEAPP_FIREBASE_CONFIG.apiKey &&
  !String(self.CUMPLEAPP_FIREBASE_CONFIG.apiKey).includes('REEMPLAZAR')
) {
  firebase.initializeApp(self.CUMPLEAPP_FIREBASE_CONFIG);

  const messaging = firebase.messaging();

  messaging.onBackgroundMessage(function(payload) {
    const data = payload && payload.data ? payload.data : {};

    const title = data.title || '🎂 CumpleApp';
    const photo =
      data.photo && /^https?:\/\//i.test(data.photo)
        ? data.photo
        : '';

    const options = {
      body: data.body || 'Tienes un recordatorio de cumpleaños.',
      tag: data.tag || 'cumpleapp-push',
      renotify: false,
      data: {
        url: data.link || './Cumple.html',
        name: data.name || '',
        type: data.type || ''
      },
      actions: [
        { action: 'open', title: 'Abrir CumpleApp' },
        { action: 'view', title: 'Ver cumpleaños' }
      ],
      vibrate: [180, 90, 180]
    };

    // Cuando el navegador lo admite, usa la foto real del cumpleañero.
    if (photo) {
      options.icon = photo;
      options.image = photo;
    }

    return self.registration.showNotification(title, options);
  });
}

self.addEventListener('install', function() {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim());
});
