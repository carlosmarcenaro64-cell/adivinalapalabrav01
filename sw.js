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

// La hoja guarda el nombre; la URL solo se construye al mostrar la imagen.
function getBirthdayPhotosBaseUrl() {
    return 'https://raw.githubusercontent.com/carlosmarcenaro64-cell/adivinalapalabrav01/main/fotos/cumpleanos/';
}

function normalizeBirthdayPhotoFileName(value) {
    let name = String(value || '').trim();
    if (/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(name)) name += '.jpg';
    // Un archivo de imagen, nunca una ruta ni una expresión de la hoja.
    if (name.length > 200 || !/^[A-Za-z0-9À-ÿ][A-Za-z0-9À-ÿ._ ()-]*\.(?:jpe?g|png|webp|gif|avif)$/i.test(name)) return '';
    return name;
}

function normalizeBirthdayPhotoReference(value) {
    const photo = String(value || '').trim();
    if (!photo) return '';
    if (/^https?:\/\//i.test(photo)) {
        // Conserva los enlaces anteriores y los de otros sitios.
        if (!/^https?:\/\/[^\s/?#@<>"\\]+(?:[/?#][^\s<>"\\]*)?$/i.test(photo)) return '';
        const base = getBirthdayPhotosBaseUrl();
        const prefixes = [base];
        const repository = base.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/fotos\/cumpleanos\/$/);
        if (repository) {
            prefixes.push('https://github.com/' + repository[1] + '/' + repository[2] + '/blob/' + repository[3] + '/fotos/cumpleanos/');
            prefixes.push('https://' + repository[1] + '.github.io/' + repository[2] + '/fotos/cumpleanos/');
        }
        for (const prefix of prefixes) {
            if (!photo.startsWith(prefix)) continue;
            const suffix = photo.slice(prefix.length);
            if (/[?#]/.test(suffix)) continue;
            try {
                const filename = normalizeBirthdayPhotoFileName(decodeURIComponent(suffix));
                if (filename) return filename;
            } catch (_) {}
        }
        return photo;
    }
    return normalizeBirthdayPhotoFileName(photo.replace(/^(?:\.\/)?fotos\/cumpleanos\//, ''));
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
