// CumpleApp Service Worker + Firebase Cloud Messaging
// Permite recibir notificaciones incluso con la página cerrada.

self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  const targetUrl =
    (event.notification.data && event.notification.data.url) ||
    './Cumple.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(windowClients) {
      for (const client of windowClients) {
        if ('focus' in client) {
          client.navigate(targetUrl).catch(function(){});
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
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

  // El servidor manda mensajes "data-only".
  // Así evitamos notificaciones duplicadas y controlamos el aspecto aquí.
  messaging.onBackgroundMessage(function(payload) {
    const data = payload && payload.data ? payload.data : {};

    const title = data.title || '🎂 CumpleApp';
    const options = {
      body: data.body || 'Tienes un recordatorio de cumpleaños.',
      tag: data.tag || 'cumpleapp-push',
      renotify: true,
      data: {
        url: data.link || './Cumple.html'
      }
    };

    return self.registration.showNotification(title, options);
  });
}

// Service worker básico para que siga siendo compatible con el registro existente.
self.addEventListener('install', function() {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim());
});
