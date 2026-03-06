// ============================================================
// Code.gs - GAS Web App ルーター (doGet / doPost)
// ============================================================

/**
 * GETリクエスト処理
 */
function doGet(e) {
  var params = e ? e.parameter : {};
  var action = params.action || '';

  try {
    switch (action) {
      case 'auth':
        return jsonResponse(handleAuth(params.pin));
      case 'getShifts':
        return withAuth(params.token, 'staff', function () {
          return getShifts(params.from, params.to);
        });
      case 'getStaff':
        return withAuth(params.token, 'manager', function () {
          return getStaffList();
        });
      case 'getLogs':
        return withAuth(params.token, 'manager', function () {
          return getSendLogs(Number(params.limit) || 30);
        });
      case 'getPreview':
        return withAuth(params.token, 'manager', function () {
          return getReminderPreview(params.date);
        });
      default:
        return jsonResponse({ success: false, error: '不明なaction: ' + action });
    }
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

/**
 * POSTリクエスト処理
 */
function doPost(e) {
  var body = {};
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ success: false, error: 'リクエストのパースに失敗しました' });
  }

  var action = body.action || '';

  try {
    switch (action) {
      case 'uploadPdf':
        return withAuth(body.token, 'manager', function () {
          return uploadAndParsePdf(body.fileBase64, body.fileName);
        });
      case 'saveParsedShifts':
        return withAuth(body.token, 'manager', function () {
          return saveParsedShifts(body.shifts);
        });
      case 'updateStaff':
        return withAuth(body.token, 'manager', function () {
          return updateStaff(body.name, body.accountId, body.originalName);
        });
      case 'deleteStaff':
        return withAuth(body.token, 'manager', function () {
          return deleteStaff(body.name);
        });
      case 'sendReminder':
        return withAuth(body.token, 'manager', function () {
          return sendManualReminder(body.date);
        });
      default:
        return jsonResponse({ success: false, error: '不明なaction: ' + action });
    }
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

// --- ヘルパー ---

/**
 * JSON レスポンスを生成
 */
function jsonResponse(data) {
  var output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

/**
 * 認証チェック付きでハンドラを実行
 */
function withAuth(token, requiredRole, handler) {
  var auth = validateToken(token);
  if (!auth.valid) {
    return jsonResponse({ success: false, error: '認証エラー: ' + auth.reason });
  }
  if (requiredRole === 'manager' && auth.role !== 'manager') {
    return jsonResponse({ success: false, error: '権限が不足しています' });
  }
  return jsonResponse(handler());
}

/**
 * スプレッドシートを取得
 */
function getSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

/**
 * 指定シートを取得（なければ作成）
 */
function getOrCreateSheet(name, headers) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers && headers.length > 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    }
  }
  return sheet;
}
