// ============================================================
// authService.gs - 認証処理
// ============================================================

/**
 * PIN認証を行い、トークンを発行する
 * @param {string} pin
 * @returns {{ success: boolean, data?: { role: string, token: string }, error?: string }}
 */
function handleAuth(pin) {
  if (!pin) {
    return { success: false, error: 'PINを入力してください' };
  }

  var settings = getSettingsMap();
  var managerPin = settings['manager_pin'] || '';
  var staffPin   = settings['staff_pin'] || '';

  var role = null;
  if (pin === managerPin) {
    role = 'manager';
  } else if (pin === staffPin) {
    role = 'staff';
  }

  if (!role) {
    return { success: false, error: 'PINが正しくありません' };
  }

  // トークン発行・保存
  var token = Utilities.getUuid();
  saveToken(token, role);

  return {
    success: true,
    data: { role: role, token: token }
  };
}

/**
 * トークンを検証する
 * @param {string} token
 * @returns {{ valid: boolean, role?: string, reason?: string }}
 */
function validateToken(token) {
  if (!token) {
    return { valid: false, reason: 'トークンがありません' };
  }

  var sheet = getOrCreateSheet(SHEET_SETTINGS, ['キー', '値']);
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    var key = String(data[i][0]);
    if (key.indexOf('token_') === 0 && key === 'token_' + token) {
      var val = String(data[i][1]);
      // フォーマット: role|expiry_timestamp
      var parts = val.split('|');
      var role = parts[0];
      var expiry = Number(parts[1]);

      if (Date.now() > expiry) {
        return { valid: false, reason: 'トークンの有効期限が切れています' };
      }
      return { valid: true, role: role };
    }
  }

  return { valid: false, reason: 'トークンが無効です' };
}

/**
 * トークンを設定シートに保存する
 */
function saveToken(token, role) {
  var sheet = getOrCreateSheet(SHEET_SETTINGS, ['キー', '値']);
  var expiry = Date.now() + TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  sheet.appendRow(['token_' + token, role + '|' + expiry]);
}

/**
 * 設定シートからキー→値のマップを取得
 */
function getSettingsMap() {
  var sheet = getOrCreateSheet(SHEET_SETTINGS, ['キー', '値']);
  var data = sheet.getDataRange().getValues();
  var map = {};
  for (var i = 1; i < data.length; i++) {
    var key = String(data[i][0]).trim();
    if (key && key.indexOf('token_') !== 0) {
      map[key] = String(data[i][1]).trim();
    }
  }
  return map;
}
