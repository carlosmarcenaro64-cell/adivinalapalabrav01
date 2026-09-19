/****************************************************
 * CUMPLEAPP - GOOGLE SHEETS + FIREBASE WEB PUSH
 *
 * Hoja principal:
 * A = nombre completo
 * B = fecha de nacimiento
 * C = categoria/relacion
 * D = nota o regalos (opcional)
 * E = Foto (link)
 * F = ID
 *
 * Hoja adicional automática:
 * PushTokens = dispositivos suscritos a notificaciones.
 ****************************************************/

const SPREADSHEET_ID = '17X0B3cLOoUESLtrLUGMXGUKB0y-i7BcOHYMyuZv5fGM';
const SHEET_NAME = 'Hoja 1';
const ID_COLUMN = 6;
const PUSH_SHEET_NAME = 'PushTokens';

function getSpreadsheet_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getSheet_() {
  const spreadsheet = getSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(SHEET_NAME);

  if (!sheet) {
    throw new Error('No existe la hoja: ' + SHEET_NAME);
  }

  return sheet;
}

function probarConexion() {
  const spreadsheet = getSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(SHEET_NAME);

  if (!sheet) {
    throw new Error('No se encontró la hoja: ' + SHEET_NAME);
  }

  Logger.log('CONEXIÓN CORRECTA');
  Logger.log('Archivo: ' + spreadsheet.getName());
  Logger.log('Hoja: ' + sheet.getName());
  Logger.log('Última fila: ' + sheet.getLastRow());

  return 'Conexión correcta';
}

function doGet(e) {
  try {
    const action = clean_(e && e.parameter ? e.parameter.action : '').toLowerCase();

    // ===== DIAGNÓSTICO PUSH / PANEL 2403 =====
    if (action === 'pushdiagnostics') {
      return output_(e, getPushDiagnostics_(clean_(e.parameter.installationId)));
    }

    if (action === 'testpushdevice') {
      return output_(e, testPushToDevice_(clean_(e.parameter.installationId)));
    }

    if (action === 'scheduleclosedpushtest') {
      return output_(e, scheduleClosedPushTest_(clean_(e.parameter.installationId)));
    }

    if (action === 'ensurenotificationtrigger') {
      return output_(e, ensureNotificationTrigger5Minutes_());
    }

    const sheet = getSheet_();
    ensureMissingIds_(sheet);

    const lastRow = sheet.getLastRow();
    const data = [];

    if (lastRow >= 2) {
      const values = sheet.getRange(2, 1, lastRow - 1, 6).getValues();

      values.forEach(function(row, index) {
        const name = clean_(row[0]);
        const date = formatDate_(row[1]);

        if (!name && !date) return;

        data.push({
          id: clean_(row[5]),
          row: index + 2,
          name: name,
          date: date,
          category: clean_(row[2]) || 'Otro',
          notes: clean_(row[3]),
          photo: clean_(row[4])
        });
      });
    }

    return output_(e, {
      status: 'success',
      data: data
    });
  } catch (error) {
    return output_(e, {
      status: 'error',
      message: String(error && error.message ? error.message : error)
    });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(10000);

    const request = parseRequest_(e);
    const action = clean_(request.action || 'create').toLowerCase();
    const data = request.data || request;

    // ===== WEB PUSH: registrar o quitar dispositivo =====
    if (action === 'registerpush') {
      const installationId = clean_(data.installationId);

      if (!installationId) {
        throw new Error('Falta installationId.');
      }

      upsertPushRegistration_(
        installationId,
        clean_(data.userAgent),
        clean_(data.platform),
        clean_(data.updatedAt)
      );

      return json_({
        status: 'success',
        action: 'registerPush'
      });
    }

    if (action === 'unregisterpush') {
      const installationId = clean_(data.installationId);

      if (installationId) {
        deletePushRegistration_(installationId);
      }

      return json_({
        status: 'success',
        action: 'unregisterPush'
      });
    }

    // ===== FUNCIONES EXISTENTES DE CUMPLEAÑOS =====
    const sheet = getSheet_();

    if (action === 'add' || action === 'create') {
      const id = clean_(data.id) || createId_();

      if (!clean_(data.name) || !clean_(data.date)) {
        throw new Error('Nombre y fecha son obligatorios.');
      }

      const existingRow = findRowById_(sheet, id);

      if (existingRow) {
        return json_({
          status: 'success',
          action: 'create',
          id: id,
          row: existingRow,
          duplicated: true
        });
      }

      sheet.appendRow([
        clean_(data.name),
        clean_(data.date),
        clean_(data.category) || 'Otro',
        clean_(data.notes),
        clean_(data.photo),
        id
      ]);

      SpreadsheetApp.flush();

      return json_({
        status: 'success',
        action: 'create',
        id: id,
        row: sheet.getLastRow()
      });
    }

    if (action === 'update') {
      const rowNumber = findRow_(
        sheet,
        data.id,
        data.row,
        data.originalName,
        data.originalDate
      );

      if (!rowNumber) {
        throw new Error('No se encontró el cumpleaños para actualizar.');
      }

      if (!clean_(data.name) || !clean_(data.date)) {
        throw new Error('Nombre y fecha son obligatorios.');
      }

      let id = clean_(data.id);

      if (!id || id.indexOf('sheet-row-') === 0) {
        id = clean_(sheet.getRange(rowNumber, ID_COLUMN).getValue()) || createId_();
      }

      sheet.getRange(rowNumber, 1, 1, 6).setValues([[
        clean_(data.name),
        clean_(data.date),
        clean_(data.category) || 'Otro',
        clean_(data.notes),
        clean_(data.photo),
        id
      ]]);

      SpreadsheetApp.flush();

      return json_({
        status: 'success',
        action: 'update',
        id: id,
        row: rowNumber
      });
    }

    if (action === 'delete') {
      const rowNumber = findRow_(
        sheet,
        data.id,
        data.row,
        data.originalName,
        data.originalDate
      );

      if (!rowNumber) {
        throw new Error('No se encontró el cumpleaños para eliminar.');
      }

      sheet.deleteRow(rowNumber);
      SpreadsheetApp.flush();

      return json_({
        status: 'success',
        action: 'delete',
        row: rowNumber
      });
    }

    throw new Error('Acción no válida: ' + action);
  } catch (error) {
    return json_({
      status: 'error',
      message: String(error && error.message ? error.message : error)
    });
  } finally {
    try {
      lock.releaseLock();
    } catch (_) {}
  }
}

function parseRequest_(e) {
  if (!e) {
    throw new Error('No se recibieron datos.');
  }

  if (e.parameter && e.parameter.payload) {
    return JSON.parse(e.parameter.payload);
  }

  if (e.postData && e.postData.contents) {
    return JSON.parse(e.postData.contents);
  }

  throw new Error('No se recibieron datos.');
}

function ensureMissingIds_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const range = sheet.getRange(2, ID_COLUMN, lastRow - 1, 1);
  const values = range.getValues();
  let changed = false;

  for (let i = 0; i < values.length; i++) {
    if (!clean_(values[i][0])) {
      values[i][0] = createId_();
      changed = true;
    }
  }

  if (changed) {
    range.setValues(values);
    SpreadsheetApp.flush();
  }
}

function findRowById_(sheet, id) {
  const wantedId = clean_(id);

  if (!wantedId || wantedId.indexOf('sheet-row-') === 0) {
    return null;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const ids = sheet.getRange(2, ID_COLUMN, lastRow - 1, 1).getValues();

  for (let i = 0; i < ids.length; i++) {
    if (clean_(ids[i][0]) === wantedId) {
      return i + 2;
    }
  }

  return null;
}

function findRow_(sheet, id, fallbackRow, originalName, originalDate) {
  const idRow = findRowById_(sheet, id);
  if (idRow) return idRow;

  const row = Number(fallbackRow);
  if (
    Number.isInteger(row) &&
    row >= 2 &&
    row <= sheet.getLastRow()
  ) {
    return row;
  }

  const wantedName = clean_(originalName).toLowerCase();
  const wantedDate = normalizeDate_(originalDate);

  if (wantedName && wantedDate) {
    const lastRow = sheet.getLastRow();
    const values = sheet.getRange(2, 1, lastRow - 1, 2).getDisplayValues();

    for (let i = 0; i < values.length; i++) {
      const sheetName = clean_(values[i][0]).toLowerCase();
      const sheetDate = normalizeDate_(values[i][1]);

      if (sheetName === wantedName && sheetDate === wantedDate) {
        return i + 2;
      }
    }
  }

  return null;
}

function normalizeDate_(value) {
  const text = clean_(value);
  if (!text) return '';

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  const parts = text.split('/');

  if (parts.length === 3) {
    return String(parts[2]).padStart(4, '0') + '-' +
      String(parts[1]).padStart(2, '0') + '-' +
      String(parts[0]).padStart(2, '0');
  }

  if (parts.length === 2) {
    return '2000-' +
      String(parts[1]).padStart(2, '0') + '-' +
      String(parts[0]).padStart(2, '0');
  }

  return text;
}

function createId_() {
  return Utilities.getUuid();
}

function clean_(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function formatDate_(value) {
  if (!value) return '';

  if (Object.prototype.toString.call(value) === '[object Date]') {
    const timezone = getSpreadsheet_().getSpreadsheetTimeZone();
    return Utilities.formatDate(value, timezone, 'yyyy-MM-dd');
  }

  return String(value).trim();
}

function output_(e, obj) {
  const prefix =
    e && e.parameter && e.parameter.prefix
      ? String(e.parameter.prefix)
      : '';

  if (prefix) {
    if (!/^[A-Za-z_$][0-9A-Za-z_$]*$/.test(prefix)) {
      return ContentService
        .createTextOutput('/* callback invalido */')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }

    return ContentService
      .createTextOutput(prefix + '(' + JSON.stringify(obj) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return json_(obj);
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ==========================================================
   WEB PUSH - REGISTRO DE DISPOSITIVOS
   ========================================================== */

function getPushSheet_() {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(PUSH_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(PUSH_SHEET_NAME);
    sheet.getRange(1, 1, 1, 5).setValues([[
      'installationId',
      'updatedAt',
      'userAgent',
      'platform',
      'active'
    ]]);
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function upsertPushRegistration_(installationId, userAgent, platform, updatedAt) {
  const sheet = getPushSheet_();
  const lastRow = sheet.getLastRow();
  const stamp = updatedAt || new Date().toISOString();

  if (lastRow >= 2) {
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

    for (let i = 0; i < ids.length; i++) {
      if (clean_(ids[i][0]) === installationId) {
        sheet.getRange(i + 2, 1, 1, 5).setValues([[
          installationId,
          stamp,
          userAgent,
          platform,
          true
        ]]);
        SpreadsheetApp.flush();
        return;
      }
    }
  }

  sheet.appendRow([
    installationId,
    stamp,
    userAgent,
    platform,
    true
  ]);

  SpreadsheetApp.flush();
}

function deletePushRegistration_(installationId) {
  const sheet = getPushSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

  for (let i = ids.length - 1; i >= 0; i--) {
    if (clean_(ids[i][0]) === installationId) {
      sheet.deleteRow(i + 2);
    }
  }

  SpreadsheetApp.flush();
}

function getActivePushIds_() {
  const sheet = getPushSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, 5).getValues();

  return values
    .filter(function(row) {
      return clean_(row[0]) && row[4] !== false;
    })
    .map(function(row) {
      return clean_(row[0]);
    });
}

/* ==========================================================
   WEB PUSH - RECORDATORIOS AUTOMÁTICOS DE CUMPLEAÑOS
   Horarios en America/El_Salvador:
   - 7 días antes: 8 a. m.
   - 3 días antes: 8 a. m.
   - 1 día antes: 8 a. m.
   - 12 horas antes: alrededor de las 12 m. del día anterior
   - Día del cumpleaños: 8 a. m.
   ========================================================== */

function crearTriggerNotificaciones() {
  const handler = 'enviarNotificacionesCumpleanos';

  // Evita crear triggers duplicados.
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === handler) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Revisión cada 5 minutos. No depende de que CumpleApp esté abierta.
  ScriptApp
    .newTrigger(handler)
    .timeBased()
    .everyMinutes(5)
    .create();

  const props = PropertiesService.getScriptProperties();
  props.setProperty('NOTIFICATION_TRIGGER_INTERVAL_MINUTES', '5');
  props.setProperty('NOTIFICATION_TRIGGER_CONFIGURED_AT', new Date().toISOString());

  return 'Trigger automático creado correctamente: revisión cada 5 minutos.';
}

function enviarNotificacionesCumpleanos() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('LAST_NOTIFICATION_RUN_AT', new Date().toISOString());

  const pushIds = getActivePushIds_();

  if (!pushIds.length) {
    Logger.log('No hay dispositivos Push registrados.');
    return;
  }

  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    Logger.log('No hay cumpleaños registrados.');
    return;
  }

  const values = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  const timezone = 'America/El_Salvador';
  const now = new Date();

  const currentHour = Number(Utilities.formatDate(now, timezone, 'H'));
  const todayDateKey = Utilities.formatDate(now, timezone, 'yyyy-MM-dd');

  const publicUrl =
    PropertiesService.getScriptProperties().getProperty('CUMPLEAPP_PUBLIC_URL') ||
    'https://carlosmarcenaro64-cell.github.io/adivinalapalabrav01/Cumple.html';

  const reminders = [];

  // Recordatorios principales a las 8 a. m.
  if (currentHour === 8) {
    reminders.push(
      { offset: 7, type: '7d' },
      { offset: 3, type: '3d' },
      { offset: 1, type: '1d' },
      { offset: 0, type: 'hoy' }
    );
  }

  // A las 12 m. del día anterior faltan aproximadamente 12 horas.
  if (currentHour === 12) {
    reminders.push({ offset: 1, type: '12h' });
  }

  // Recordatorio amable a las 7 p. m. del mismo cumpleaños.
  if (currentHour === 19) {
    reminders.push({ offset: 0, type: 'noche' });
  }

  if (!reminders.length) {
    return;
  }

  reminders.forEach(function(reminder) {
    const targetDate = new Date(now.getTime() + reminder.offset * 24 * 60 * 60 * 1000);
    const targetMonthDay = Utilities.formatDate(targetDate, timezone, 'MM-dd');

    values.forEach(function(row) {
      const name = clean_(row[0]);
      const notes = clean_(row[3]);
      const photo = clean_(row[4]);
      const id = clean_(row[5]) || (name + '-' + monthDayKey_(row[1], timezone));
      const birthdayMonthDay = monthDayKey_(row[1], timezone);

      if (!name || !birthdayMonthDay || birthdayMonthDay !== targetMonthDay) {
        return;
      }

      const notification = buildBirthdayPush_(reminder.type, name, notes, photo);
      if (!notification) return;

      const safeId = String(id).replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80);
      const dedupeKey =
        'cumple-' + safeId + '-' + reminder.type + '-' + todayDateKey;

      if (notificationAlreadySent_(dedupeKey)) {
        return;
      }

      const successCount = sendPushToAll_(
        pushIds,
        notification.title,
        notification.body,
        publicUrl,
        dedupeKey,
        {
          name: notification.name,
          type: notification.type,
          photo: notification.photo
        }
      );

      if (successCount > 0) {
        markNotificationSent_(dedupeKey);
      }
    });
  });

  cleanupOldNotificationMarks_();
}

function buildBirthdayPush_(type, name, notes, photo) {
  const cleanName = clean_(name) || 'Cumpleañero/a';
  const cleanPhoto = /^https?:\/\//i.test(clean_(photo)) ? clean_(photo) : '';

  let note = clean_(notes).replace(/\s+/g, ' ');
  if (note.length > 90) {
    note = note.substring(0, 87) + '...';
  }

  let title = '🎂 CumpleApp';
  let body = '';

  if (type === '7d') {
    title = '🎁 En una semana: ' + cleanName;
    body =
      'Faltan 7 días para el cumpleaños de ' +
      cleanName +
      '. Ya puedes ir preparando un detalle especial.';

    if (note) body += ' 💡 Recuerda: ' + note;
  }

  if (type === '3d') {
    title = '🎈 ¡Se acerca el cumpleaños de ' + cleanName + '!';
    body = 'Solo faltan 3 días para celebrar a ' + cleanName + '. 🥳';

    if (note) body += ' 💡 Idea/recordatorio: ' + note;
  }

  if (type === '1d') {
    title = '⏰ Mañana es el gran día de ' + cleanName;
    body =
      'Mañana es el cumpleaños de ' +
      cleanName +
      '. Que no se te pase felicitarle. 🎉';

    if (note) body += ' 💡 Recuerda: ' + note;
  }

  if (type === '12h') {
    title = '✨ ¡Ya casi, ' + cleanName + '!';
    body =
      'Faltan menos de 12 horas para que comience el cumpleaños de ' +
      cleanName +
      '. 🎂';
  }

  if (type === 'hoy') {
    title = '🥳 ¡Feliz cumpleaños, ' + cleanName + '!';
    body =
      'Hoy celebramos a ' +
      cleanName +
      '. ¡Que sea un día muy especial! 🎂🎉🎁';
  }

  if (type === 'noche') {
    title = '🌙 Antes de que termine el día…';
    body =
      '¿Ya felicitaste a ' +
      cleanName +
      '? Todavía estás a tiempo de enviarle un bonito mensaje. 🎂💖';
  }

  if (!body) return null;

  return {
    title: title,
    body: body,
    name: cleanName,
    type: type,
    photo: cleanPhoto
  };
}

function notificationAlreadySent_(key) {
  const props = PropertiesService.getScriptProperties();
  return Boolean(props.getProperty('NOTICE_' + key));
}

function markNotificationSent_(key) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('NOTICE_' + key, new Date().toISOString());
}

function cleanupOldNotificationMarks_() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  const maxAge = 60 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  Object.keys(all).forEach(function(key) {
    if (key.indexOf('NOTICE_') !== 0) return;

    const timestamp = Date.parse(all[key]);

    if (!isNaN(timestamp) && now - timestamp > maxAge) {
      props.deleteProperty(key);
    }
  });
}

function monthDayKey_(value, timezone) {
  if (!value) return '';

  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, timezone, 'MM-dd');
  }

  const text = clean_(value);

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text.slice(5, 10);
  }

  const parts = text.split('/');

  if (parts.length >= 2) {
    return String(parts[1]).padStart(2, '0') + '-' +
      String(parts[0]).padStart(2, '0');
  }

  return '';
}

function sendPushToAll_(installationIds, title, body, link, tag, extra) {
  let successCount = 0;

  installationIds.forEach(function(installationId) {
    try {
      sendFirebasePush_(installationId, title, body, link, tag, extra || {});
      successCount++;
    } catch (error) {
      Logger.log('Push falló para ' + installationId + ': ' + error);
    }
  });

  if (successCount > 0) {
    PropertiesService.getScriptProperties()
      .setProperty('LAST_PUSH_SENT_AT', new Date().toISOString());
  }

  return successCount;
}

function sendFirebasePush_(installationId, title, body, link, tag, extra) {
  const props = PropertiesService.getScriptProperties();

  const projectId = props.getProperty('FIREBASE_PROJECT_ID');
  if (!projectId) {
    throw new Error('Falta FIREBASE_PROJECT_ID en Propiedades del script.');
  }

  const accessToken = getFirebaseAccessToken_();

  const endpoint =
    'https://fcm.googleapis.com/v1/projects/' +
    encodeURIComponent(projectId) +
    '/messages:send';

  // Mensaje data-only: el service worker decide cómo mostrarlo.
  const payload = {
    message: {
      token: installationId,
      data: {
        title: String(title || '🎂 CumpleApp'),
        body: String(body || ''),
        link: String(link || ''),
        tag: String(tag || 'cumpleapp-push'),
        name: String((extra && extra.name) || ''),
        type: String((extra && extra.type) || ''),
        photo: String((extra && extra.photo) || '')
      },
      webpush: {
        headers: {
          Urgency: 'high',
          TTL: '86400'
        }
      }
    }
  };

  const response = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + accessToken
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  const text = response.getContentText();

  if (code < 200 || code >= 300) {
    // Si Firebase indica que el destino ya no existe, lo eliminamos.
    if (
      code === 404 ||
      text.indexOf('UNREGISTERED') !== -1 ||
      text.indexOf('NOT_FOUND') !== -1
    ) {
      deletePushRegistration_(installationId);
    }

    throw new Error('FCM HTTP ' + code + ': ' + text);
  }

  return JSON.parse(text);
}

function getFirebaseAccessToken_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('firebase_access_token');

  if (cached) return cached;

  const props = PropertiesService.getScriptProperties();

  const clientEmail = props.getProperty('FIREBASE_CLIENT_EMAIL');
  let privateKey = props.getProperty('FIREBASE_PRIVATE_KEY');

  if (!clientEmail || !privateKey) {
    throw new Error(
      'Faltan FIREBASE_CLIENT_EMAIL o FIREBASE_PRIVATE_KEY en Propiedades del script.'
    );
  }

  privateKey = privateKey.replace(/\\n/g, '\n');

  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: 'RS256',
    typ: 'JWT'
  };

  const claim = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };

  const unsignedJwt =
    base64Url_(JSON.stringify(header)) +
    '.' +
    base64Url_(JSON.stringify(claim));

  const signature = Utilities.computeRsaSha256Signature(
    unsignedJwt,
    privateKey
  );

  const jwt =
    unsignedJwt +
    '.' +
    Utilities.base64EncodeWebSafe(signature).replace(/=+$/g, '');

  const response = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/token',
    {
      method: 'post',
      contentType: 'application/x-www-form-urlencoded',
      payload: {
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt
      },
      muteHttpExceptions: true
    }
  );

  const code = response.getResponseCode();
  const text = response.getContentText();

  if (code < 200 || code >= 300) {
    throw new Error('OAuth HTTP ' + code + ': ' + text);
  }

  const data = JSON.parse(text);

  if (!data.access_token) {
    throw new Error('Google no devolvió access_token.');
  }

  cache.put('firebase_access_token', data.access_token, 3300);

  return data.access_token;
}

function base64Url_(text) {
  return Utilities
    .base64EncodeWebSafe(text, Utilities.Charset.UTF_8)
    .replace(/=+$/g, '');
}

function probarPushManual() {
  const ids = getActivePushIds_();

  if (!ids.length) {
    throw new Error(
      'No hay dispositivos registrados. Abre CumpleApp y activa las notificaciones primero.'
    );
  }

  const publicUrl =
    PropertiesService.getScriptProperties().getProperty('CUMPLEAPP_PUBLIC_URL') ||
    'https://carlosmarcenaro64-cell.github.io/adivinalapalabrav01/Cumple.html';

  sendPushToAll_(
    ids,
    '🎂 CumpleApp',
    'Esta es una notificación Push de prueba con la web cerrada.',
    publicUrl,
    'cumpleapp-prueba'
  );

  return 'Push de prueba enviado a ' + ids.length + ' dispositivo(s).';
}



/* ==========================================================
   PANEL 2403 - DIAGNÓSTICO REAL DE PUSH
   ========================================================== */

function isPushInstallationRegistered_(installationId) {
  if (!installationId) return false;

  const sheet = getPushSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;

  const values = sheet.getRange(2, 1, lastRow - 1, 5).getValues();

  return values.some(function(row) {
    return clean_(row[0]) === installationId && row[4] !== false;
  });
}

function getNotificationTriggerInfo_() {
  const handler = 'enviarNotificacionesCumpleanos';
  const triggers = ScriptApp.getProjectTriggers().filter(function(trigger) {
    return trigger.getHandlerFunction() === handler;
  });

  const props = PropertiesService.getScriptProperties();
  const interval = Number(props.getProperty('NOTIFICATION_TRIGGER_INTERVAL_MINUTES') || 0);

  return {
    exists: triggers.length > 0,
    count: triggers.length,
    intervalMinutes: interval || null,
    configuredAt: props.getProperty('NOTIFICATION_TRIGGER_CONFIGURED_AT') || ''
  };
}

function getPushDiagnostics_(installationId) {
  const props = PropertiesService.getScriptProperties();
  const activeIds = getActivePushIds_();
  const trigger = getNotificationTriggerInfo_();

  const lastRun = props.getProperty('LAST_NOTIFICATION_RUN_AT') || '';
  const lastPush = props.getProperty('LAST_PUSH_SENT_AT') || '';
  let lastRunAgeMinutes = null;

  if (lastRun) {
    const parsed = new Date(lastRun);
    if (!isNaN(parsed.getTime())) {
      lastRunAgeMinutes = Math.max(
        0,
        Math.round((Date.now() - parsed.getTime()) / 60000)
      );
    }
  }

  return {
    status: 'success',
    serverTime: Utilities.formatDate(
      new Date(),
      'America/El_Salvador',
      "yyyy-MM-dd'T'HH:mm:ss"
    ),
    timezone: 'America/El_Salvador',
    firebaseConfigured: {
      projectId: Boolean(props.getProperty('FIREBASE_PROJECT_ID')),
      clientEmail: Boolean(props.getProperty('FIREBASE_CLIENT_EMAIL')),
      privateKey: Boolean(props.getProperty('FIREBASE_PRIVATE_KEY')),
      publicUrl: Boolean(props.getProperty('CUMPLEAPP_PUBLIC_URL'))
    },
    activeDevices: activeIds.length,
    installationRegistered: installationId
      ? isPushInstallationRegistered_(installationId)
      : false,
    trigger: trigger,
    lastAutomaticCheckAt: lastRun,
    lastAutomaticCheckAgeMinutes: lastRunAgeMinutes,
    lastPushSentAt: lastPush
  };
}

function testPushToDevice_(installationId) {
  if (!installationId) {
    return {
      status: 'error',
      message: 'Este dispositivo todavía no tiene un installationId guardado.'
    };
  }

  if (!isPushInstallationRegistered_(installationId)) {
    return {
      status: 'error',
      message: 'El dispositivo no está registrado en PushTokens.'
    };
  }

  const publicUrl =
    PropertiesService.getScriptProperties().getProperty('CUMPLEAPP_PUBLIC_URL') ||
    'https://carlosmarcenaro64-cell.github.io/adivinalapalabrav01/Cumple.html';

  try {
    sendFirebasePush_(
      installationId,
      '✅ CumpleApp - Push real',
      'Esta notificación salió desde Apps Script → Firebase y llegó a este dispositivo.',
      publicUrl,
      'cumpleapp-real-test-' + Date.now(),
      {
        name: 'Prueba Push',
        type: 'diagnostic',
        photo: ''
      }
    );

    PropertiesService.getScriptProperties()
      .setProperty('LAST_PUSH_SENT_AT', new Date().toISOString());

    return {
      status: 'success',
      sent: true,
      message: 'Push real enviado por Firebase a este dispositivo.'
    };
  } catch (error) {
    return {
      status: 'error',
      sent: false,
      message: String(error && error.message ? error.message : error)
    };
  }
}

function scheduleClosedPushTest_(installationId) {
  if (!installationId) {
    return {
      status: 'error',
      message: 'Falta installationId.'
    };
  }

  if (!isPushInstallationRegistered_(installationId)) {
    return {
      status: 'error',
      message: 'El dispositivo no está registrado en PushTokens.'
    };
  }

  const props = PropertiesService.getScriptProperties();
  const key = 'CLOSED_PUSH_TEST_QUEUE';
  let queue = [];

  try {
    queue = JSON.parse(props.getProperty(key) || '[]');
    if (!Array.isArray(queue)) queue = [];
  } catch (_) {
    queue = [];
  }

  const fireAt = Date.now() + 60000;

  queue.push({
    id: Utilities.getUuid(),
    installationId: installationId,
    fireAt: fireAt,
    createdAt: new Date().toISOString()
  });

  // Mantener la cola pequeña.
  queue = queue.slice(-20);
  props.setProperty(key, JSON.stringify(queue));

  ScriptApp
    .newTrigger('runScheduledClosedPushTest')
    .timeBased()
    .after(60000)
    .create();

  return {
    status: 'success',
    scheduled: true,
    fireAt: new Date(fireAt).toISOString(),
    delaySeconds: 60,
    message: 'Prueba programada. Cierra CumpleApp; el servidor enviará el Push aproximadamente en 1 minuto.'
  };
}

function runScheduledClosedPushTest() {
  const props = PropertiesService.getScriptProperties();
  const key = 'CLOSED_PUSH_TEST_QUEUE';
  let queue = [];

  try {
    queue = JSON.parse(props.getProperty(key) || '[]');
    if (!Array.isArray(queue)) queue = [];
  } catch (_) {
    queue = [];
  }

  if (!queue.length) return;

  const now = Date.now();
  const due = [];
  const pending = [];

  queue.forEach(function(item) {
    if (Number(item.fireAt || 0) <= now + 30000) {
      due.push(item);
    } else {
      pending.push(item);
    }
  });

  props.setProperty(key, JSON.stringify(pending));

  const publicUrl =
    props.getProperty('CUMPLEAPP_PUBLIC_URL') ||
    'https://carlosmarcenaro64-cell.github.io/adivinalapalabrav01/Cumple.html';

  due.forEach(function(item) {
    try {
      if (!isPushInstallationRegistered_(item.installationId)) return;

      sendFirebasePush_(
        item.installationId,
        '🚪 CumpleApp - Prueba con app cerrada',
        'Si ves este aviso con CumpleApp cerrada, el Push en segundo plano está funcionando correctamente.',
        publicUrl,
        'cumpleapp-closed-test-' + Date.now(),
        {
          name: 'Prueba segundo plano',
          type: 'closed-test',
          photo: ''
        }
      );

      props.setProperty('LAST_PUSH_SENT_AT', new Date().toISOString());
    } catch (error) {
      Logger.log('Prueba Push cerrada falló: ' + error);
    }
  });
}

function ensureNotificationTrigger5Minutes_() {
  try {
    const message = crearTriggerNotificaciones();
    const info = getNotificationTriggerInfo_();

    return {
      status: 'success',
      message: message,
      trigger: info
    };
  } catch (error) {
    return {
      status: 'error',
      message: String(error && error.message ? error.message : error)
    };
  }
}

function probarAviso7Dias() {
  return probarTipoPush_('7d');
}

function probarAviso3Dias() {
  return probarTipoPush_('3d');
}

function probarAvisoManana() {
  return probarTipoPush_('1d');
}

function probarAviso12Horas() {
  return probarTipoPush_('12h');
}

function probarAvisoCumpleHoy() {
  return probarTipoPush_('hoy');
}

function probarAvisoNoche() {
  return probarTipoPush_('noche');
}

function probarTipoPush_(type) {
  const ids = getActivePushIds_();

  if (!ids.length) {
    throw new Error(
      'No hay dispositivos registrados. Abre CumpleApp y activa las notificaciones primero.'
    );
  }

  const publicUrl =
    PropertiesService.getScriptProperties().getProperty('CUMPLEAPP_PUBLIC_URL') ||
    'https://carlosmarcenaro64-cell.github.io/adivinalapalabrav01/Cumple.html';

  const example = buildBirthdayPush_(type, 'Cumpleañero/a', 'Le gustan los detalles bonitos', '');
  if (!example) throw new Error('Tipo de prueba no válido.');

  const sent = sendPushToAll_(
    ids,
    example.title,
    example.body,
    publicUrl,
    'cumpleapp-prueba-' + type + '-' + Date.now(),
    {
      name: example.name,
      type: example.type,
      photo: example.photo
    }
  );

  return 'Aviso de prueba enviado a ' + sent + ' dispositivo(s).';
}

function verificarConfiguracionPush() {
  const props = PropertiesService.getScriptProperties();

  const result = {
    FIREBASE_PROJECT_ID: Boolean(props.getProperty('FIREBASE_PROJECT_ID')),
    FIREBASE_CLIENT_EMAIL: Boolean(props.getProperty('FIREBASE_CLIENT_EMAIL')),
    FIREBASE_PRIVATE_KEY: Boolean(props.getProperty('FIREBASE_PRIVATE_KEY')),
    CUMPLEAPP_PUBLIC_URL: Boolean(props.getProperty('CUMPLEAPP_PUBLIC_URL')),
    dispositivosRegistrados: getActivePushIds_().length
  };

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}
