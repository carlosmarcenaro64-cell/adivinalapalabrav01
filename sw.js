/* CumpleApp Service Worker — Firebase Cloud Messaging + avisos internos */
'use strict';

try {
  importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js');
  importScripts('./firebase-config.js');
  importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js');

  if (!self.firebase || !self.CUMPLEAPP_FIREBASE_CONFIG) {
    throw new Error('No se pudo cargar la configuración de Firebase de CumpleApp.');
  }
  if (!firebase.apps.length) firebase.initializeApp(self.CUMPLEAPP_FIREBASE_CONFIG);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const data = payload && payload.data ? payload.data : {};
    const notification = payload && payload.notification ? payload.notification : {};
    const title = data.title || notification.title || '🎂 CumpleApp';
    const body = data.body || notification.body || 'Tienes un recordatorio de cumpleaños.';
    const tag = String(data.tag || payload.messageId || ('cumpleapp-' + Date.now()));
    const targetUrl = data.link || data.url || './Cumple.html';
    const options = {
      body, tag, renotify: true,
      icon: data.icon || './icon-192.png',
      badge: './icon-192.png',
      data: { url: targetUrl, cumpleapp: true }
    };
    const image = data.photo || notification.image;
    if (image) options.image = image;
    return self.registration.getNotifications({ tag }).then((existing) => {
      if (existing.length) return undefined;
      return self.registration.showNotification(title, options);
    });
  });
} catch (error) {
  console.error('[CumpleApp SW] Error inicializando Firebase:', error);
  throw error;
}

let lastReceipt = null;
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('message', (event) => {
  const message = event.data || {};
  const port = event.ports && event.ports[0];
  if (message.type === 'CUMPLEAPP_NOTIFICATION_STATUS') {
    if (port) port.postMessage({ ok: true, receipt: lastReceipt });
    return;
  }
  if (message.type !== 'CUMPLEAPP_SHOW_NOTIFICATION') return;
  if (port) port.postMessage({ accepted: true });

  const payload = message.payload || {};
  const data = payload.data || {};
  const notification = payload.notification || {};
  const title = data.title || notification.title || '🎂 CumpleApp';
  const body = data.body || notification.body || 'Tienes un recordatorio de cumpleaños.';
  const tag = String(data.tag || payload.messageId || ('cumpleapp-' + Date.now()));
  const targetUrl = data.link || data.url || './Cumple.html';
  const options = {
    body, tag, renotify: true,
    icon: data.icon || './icon-192.png',
    badge: './icon-192.png',
    data: { url: targetUrl, cumpleapp: true }
  };
  const image = data.photo || notification.image;
  if (image) options.image = image;

  const task = self.registration.getNotifications({ tag }).then((existing) => {
    if (existing.length) return { duplicate: true };
    return self.registration.showNotification(title, options).then(() => {
      lastReceipt = { at: Date.now() };
      return { shown: true, receipt: lastReceipt };
    });
  }).then((result) => {
    if (port) port.postMessage({ ok: true, ...result });
    return result;
  }).catch((error) => {
    if (port) port.postMessage({ ok: false, error: error && error.message || 'No se pudo mostrar la notificación.' });
    throw error;
  });
  event.waitUntil(task);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification && event.notification.data && event.notification.data.url;
  const url = new URL(target || './Cumple.html', self.location.href).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client) await client.navigate(url);
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});
