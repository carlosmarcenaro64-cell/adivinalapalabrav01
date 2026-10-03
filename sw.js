// CumpleApp Service Worker + Firebase Cloud Messaging
// Permite recibir notificaciones incluso con la página cerrada.

self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  const fallback = new URL('./Cumple.html', self.registration.scope);
  let target = fallback;
  try {
    const requested = new URL(event.notification.data && event.notification.data.url || fallback.href, fallback);
    if (requested.origin === fallback.origin && requested.pathname.startsWith(new URL(self.registration.scope).pathname)) target = requested;
  } catch (_) {}
  const targetUrl = target.href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(windowClients) {
      for (const client of windowClients) {
        if ('focus' in client && client.url && new URL(client.url).pathname === target.pathname) {
          client.navigate(targetUrl).catch(function(){});
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
    // Los mensajes notification ya los muestra el SDK; los nuestros son data-only.
    if (payload && payload.notification) return;
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

    const photo = getBirthdayPhotoUrl(data.photo);
    options.icon = photo || new URL('./icon-192.png', self.registration.scope).href;
    if (photo) options.image = photo;

    return self.registration.showNotification(title, options).catch(function() {
      delete options.image;
      options.icon = new URL('./icon-192.png', self.registration.scope).href;
      return self.registration.showNotification(title, options);
    });
  });
}

// Service worker básico para que siga siendo compatible con el registro existente.
self.addEventListener('install', function() {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim());
});
