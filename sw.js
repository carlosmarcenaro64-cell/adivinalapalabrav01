// CumpleApp Service Worker + Firebase Cloud Messaging
// Permite recibir notificaciones incluso con la página cerrada.

self.addEventListener('notificationclick', function(event) {
  event.stopImmediatePropagation();
  event.notification.close();
  if (event.action === 'dismiss') return;

  const fallback = new URL('./Cumple.html', self.registration.scope);
  let target = fallback;
  try {
    const requested = new URL(event.notification.data && event.notification.data.url || fallback.href, fallback);
    if (requested.origin === fallback.origin && requested.pathname === fallback.pathname) target = requested;
  } catch (_) {}
  const targetUrl = target.href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async function(windowClients) {
      for (const client of windowClients) {
        if ('focus' in client && client.url && new URL(client.url).pathname === target.pathname) {
          if (client.url !== targetUrl) await client.navigate(targetUrl).catch(function(){});
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

// La hoja guarda el nombre. La imagen se sirve desde la carpeta del mismo sitio.
function getBirthdayPhotosBaseUrl() {
    const siteBase = typeof document !== 'undefined' ? document.baseURI : self.registration.scope;
    return new URL('./fotos/cumpleanos/', siteBase).href;
}

// Solo se utiliza para reconocer enlaces antiguos y validar la respuesta de carga.
// El navegador no necesita solicitar la imagen a este dominio.
function getBirthdayPhotoRepositoryBaseUrl() {
    return 'https://raw.githubusercontent.com/carlosmarcenaro64-cell/adivinalapalabrav01/main/fotos/cumpleanos/';
}

function normalizeBirthdayPhotoFileName(value) {
    let name = String(value || '').trim();
    if (/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(name)) name += '.jpg';
    if (name.length > 200 || !/^[A-Za-z0-9À-ÿ][A-Za-z0-9À-ÿ._ ()-]*\.(?:jpe?g|png|webp|gif|avif)$/i.test(name)) return '';
    return name;
}

function normalizeBirthdayPhotoReference(value) {
    const photo = String(value || '').trim();
    if (!photo) return '';
    if (/^https?:\/\//i.test(photo)) {
        if (!/^https?:\/\/[^\s/?#@<>"\\]+(?:[/?#][^\s<>"\\]*)?$/i.test(photo)) return '';
        let url;
        try { url = new URL(photo); } catch (_) { return ''; }
        if (url.username || url.password) return '';
        const folders = [
            getBirthdayPhotosBaseUrl(),
            getBirthdayPhotoRepositoryBaseUrl(),
            'https://raw.githubusercontent.com/carlosmarcenaro64-cell/adivinalapalabrav01/refs/heads/main/fotos/cumpleanos/',
            'https://github.com/carlosmarcenaro64-cell/adivinalapalabrav01/blob/main/fotos/cumpleanos/',
            'https://github.com/carlosmarcenaro64-cell/adivinalapalabrav01/raw/main/fotos/cumpleanos/',
            'https://carlosmarcenaro64-cell.github.io/adivinalapalabrav01/fotos/cumpleanos/'
        ];
        for (const folder of folders) {
            const base = new URL(folder);
            if (url.hostname !== base.hostname || url.port !== base.port || !url.pathname.startsWith(base.pathname)) continue;
            try {
                return normalizeBirthdayPhotoFileName(decodeURIComponent(url.pathname.slice(base.pathname.length)));
            } catch (_) { return ''; }
        }
        // Los enlaces externos siguen funcionando; no se copian ni se redirigen.
        return photo;
    }
    const paths = ['./fotos/cumpleanos/', 'fotos/cumpleanos/', new URL(getBirthdayPhotosBaseUrl()).pathname];
    for (const prefix of paths) {
        if (!photo.startsWith(prefix)) continue;
        try { return normalizeBirthdayPhotoFileName(decodeURIComponent(photo.slice(prefix.length))); }
        catch (_) { return ''; }
    }
    return normalizeBirthdayPhotoFileName(photo);
}

function getBirthdayPhotoUrl(value) {
    const reference = normalizeBirthdayPhotoReference(value);
    if (!reference) return '';
    return /^https?:\/\//i.test(reference)
        ? reference
        : getBirthdayPhotosBaseUrl() + encodeURIComponent(reference);
}


// Un único mostrador para avisos recibidos con la app abierta o cerrada.
// El navegador despierta este worker al recibir Push; no necesita un temporizador.
const CUMPLE_PUSH_VERSION = 'pc-20261006';
const CUMPLE_RECEIPTS_CACHE = 'cumpleapp-push-receipts-v1';
const CUMPLE_RECEIPT_BASE = new URL('./__cumple_push__/', self.registration.scope).href;
const cumpleRecentNotices = new Map();
let cumpleNotificationQueue = Promise.resolve();

function cumpleNotificationTag(payload) {
  const data = payload && payload.data || {};
  return String(data.tag || payload && (payload.messageId || payload.fcmMessageId) ||
    'cumpleapp-' + Date.now() + '-' + Math.random().toString(36).slice(2)).slice(0, 300);
}

async function cumpleReadReceipt(key) {
  try {
    const cache = await caches.open(CUMPLE_RECEIPTS_CACHE);
    const response = await cache.match(CUMPLE_RECEIPT_BASE + key);
    return response ? await response.json() : null;
  } catch (_) { return null; }
}

async function cumpleRememberNotice(tag, source) {
  const receipt = { at:Date.now(), source };
  cumpleRecentNotices.set(tag, receipt.at);
  if (cumpleRecentNotices.size > 200) cumpleRecentNotices.delete(cumpleRecentNotices.keys().next().value);
  try {
    const cache = await caches.open(CUMPLE_RECEIPTS_CACHE);
    const response = new Response(JSON.stringify(receipt), {headers:{'Content-Type':'application/json'}});
    await cache.put(CUMPLE_RECEIPT_BASE + 'notice/' + encodeURIComponent(tag), response.clone());
    await cache.put(CUMPLE_RECEIPT_BASE + 'last', response);
    const keys = (await cache.keys()).filter(key => key.url.startsWith(CUMPLE_RECEIPT_BASE + 'notice/'));
    await Promise.all(keys.slice(0, Math.max(0, keys.length - 200)).map(key => cache.delete(key)));
  } catch (_) { /* Un bloqueo del almacenamiento no debe impedir el aviso. */ }
  return receipt;
}

async function cumpleDisplayNotification(payload, source) {
  const data = payload && payload.data || {};
  const notification = payload && payload.notification || {};
  const tag = cumpleNotificationTag(payload);
  const prior = cumpleRecentNotices.get(tag) ||
    (await cumpleReadReceipt('notice/' + encodeURIComponent(tag)) || {}).at;
  if (prior && Date.now() - prior < 48 * 3600000) return {shown:false, duplicate:true};
  try {
    if ((await self.registration.getNotifications({tag})).length) return {shown:false, duplicate:true};
  } catch (_) {}

  const title = String(data.title || notification.title || '🎂 CumpleApp');
  const photo = getBirthdayPhotoUrl(data.photo);
  const fallbackIcon = new URL('./icon-192.png', self.registration.scope).href;
  const options = {
    body:String(data.body || notification.body || 'Tienes un recordatorio de cumpleaños.'),
    tag, renotify:true,
    requireInteraction:!/Android|iPhone|iPad|iPod|Mobile/i.test(self.navigator && self.navigator.userAgent || ''),
    data:{url:String(data.link || './Cumple.html'), cumpleapp:true},
    icon:photo || fallbackIcon,
    actions:[{action:'open',title:'Abrir CumpleApp'},{action:'dismiss',title:'Cerrar'}]
  };
  if (photo) options.image = photo;
  try { await self.registration.showNotification(title, options); }
  catch (_) {
    delete options.image; delete options.actions; delete options.requireInteraction;
    options.icon = fallbackIcon;
    await self.registration.showNotification(title, options);
  }
  const receipt = await cumpleRememberNotice(tag, source);
  try {
    const windows = await self.clients.matchAll({type:'window',includeUncontrolled:true});
    windows.forEach(client => client.postMessage({type:'CUMPLEAPP_NOTICE_RECEIVED',receipt}));
  } catch (_) {}
  return {shown:true, duplicate:false, receipt};
}

function cumpleQueueNotification(payload, source) {
  const work = cumpleNotificationQueue.then(() => cumpleDisplayNotification(payload, source));
  cumpleNotificationQueue = work.catch(() => {});
  return work;
}

self.addEventListener('message', function(event) {
  const message = event.data || {};
  if (!['CUMPLEAPP_SHOW_NOTIFICATION','CUMPLEAPP_NOTIFICATION_STATUS'].includes(message.type)) return;
  const port = event.ports && event.ports[0];
  if (!port) return;
  try {
    const sender = new URL(event.source && event.source.url || event.origin);
    const scope = new URL(self.registration.scope);
    if (sender.origin !== scope.origin || !sender.pathname.startsWith(scope.pathname)) return;
  } catch (_) { return; }
  if (message.type === 'CUMPLEAPP_NOTIFICATION_STATUS') {
    event.waitUntil(cumpleReadReceipt('last').then(receipt => {
      port.postMessage({ok:true,version:CUMPLE_PUSH_VERSION,receipt});
    }));
    return;
  }
  // Confirmar que este worker se hace cargo antes de consultar el almacenamiento.
  port.postMessage({accepted:true,version:CUMPLE_PUSH_VERSION});
  event.waitUntil(cumpleQueueNotification(message.payload || {}, 'foreground').then(result => {
    port.postMessage({ok:true,...result});
  }).catch(error => {
    port.postMessage({ok:false,error:String(error && error.message || 'No se pudo mostrar el aviso.')});
  }));
});


// Configuración compartida con la página.
importScripts('./firebase-config.js?v=push-20261002');

// Firebase Messaging en service worker sin bundler.
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js');

if (
  self.CUMPLEAPP_FIREBASE_CONFIG &&
  self.CUMPLEAPP_FIREBASE_CONFIG.apiKey &&
  self.CUMPLEAPP_FIREBASE_CONFIG.projectId &&
  !String(self.CUMPLEAPP_FIREBASE_CONFIG.apiKey).includes('REEMPLAZAR')
) {
  firebase.initializeApp(self.CUMPLEAPP_FIREBASE_CONFIG);

  const messaging = firebase.messaging();

  // El servidor manda mensajes "data-only".
  // Así evitamos notificaciones duplicadas y controlamos el aspecto aquí.
  messaging.onBackgroundMessage(function(payload) {
    // FCM presenta automáticamente los mensajes con notification; el servidor
    // de CumpleApp usa data-only y delega su presentación en este mismo mostrador.
    if (payload && payload.notification) return;
    return cumpleQueueNotification(payload, 'background');
  });
}

// Service worker básico para que siga siendo compatible con el registro existente.
self.addEventListener('install', function() {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim());
});
