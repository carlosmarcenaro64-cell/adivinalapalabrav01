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
   WEB PUSH - ENVÍO DIARIO DE CUMPLEAÑOS
   ========================================================== */

function crearTriggerNotificaciones() {
  const handler = 'enviarNotificacionesCumpleanos';

  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === handler) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp
    .newTrigger(handler)
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .inTimezone('America/El_Salvador')
    .create();

  return 'Trigger diario creado para las 8:00 a. m.';
}

function enviarNotificacionesCumpleanos() {
  const pushIds = getActivePushIds_();
  if (!pushIds.length) {
    Logger.log('No hay dispositivos Push registrados.');
    return;
  }

  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  const timezone = getSpreadsheet_().getSpreadsheetTimeZone() || 'America/El_Salvador';

  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const todayKey = Utilities.formatDate(now, timezone, 'MM-dd');
  const tomorrowKey = Utilities.formatDate(tomorrow, timezone, 'MM-dd');

  const todayNames = [];
  const tomorrowNames = [];

  values.forEach(function(row) {
    const name = clean_(row[0]);
    const md = monthDayKey_(row[1], timezone);

    if (!name || !md) return;

    if (md === todayKey) todayNames.push(name);
    if (md === tomorrowKey) tomorrowNames.push(name);
  });

  const publicUrl =
    PropertiesService.getScriptProperties().getProperty('CUMPLEAPP_PUBLIC_URL') ||
    'https://carlosmarcenaro64-cell.github.io/adivinalapalabrav01/Cumple.html';

  if (todayNames.length) {
    const title =
      todayNames.length === 1
        ? '🎂 ¡Cumpleaños hoy!'
        : '🎂 ¡Cumpleaños hoy!';

    const body =
      todayNames.length === 1
        ? 'Hoy cumple años ' + todayNames[0] + '. 🎉'
        : 'Hoy cumplen años: ' + todayNames.join(', ') + '. 🎉';

    sendPushToAll_(pushIds, title, body, publicUrl, 'cumple-hoy-' + todayKey);
  }

  if (tomorrowNames.length) {
    const title = '⏰ Cumpleaños mañana';

    const body =
      tomorrowNames.length === 1
        ? 'Mañana cumple años ' + tomorrowNames[0] + '.'
        : 'Mañana cumplen años: ' + tomorrowNames.join(', ') + '.';

    sendPushToAll_(pushIds, title, body, publicUrl, 'cumple-manana-' + tomorrowKey);
  }
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

function sendPushToAll_(installationIds, title, body, link, tag) {
  installationIds.forEach(function(installationId) {
    try {
      sendFirebasePush_(installationId, title, body, link, tag);
    } catch (error) {
      Logger.log('Push falló para ' + installationId + ': ' + error);
    }
  });
}

function sendFirebasePush_(installationId, title, body, link, tag) {
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
        tag: String(tag || 'cumpleapp-push')
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
