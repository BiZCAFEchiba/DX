// ============================================================
// Code.gs - GAS Web App ルーター (doGet / doPost)
// ============================================================

/**
 * PINの初期設定（初回のみ手動実行）
 * 設定シートに manager_pin / staff_pin がなければ追加する
 */
function setupInitialPins() {
  var sheet = getOrCreateSheet(SHEET_SETTINGS, ['キー', '値']);
  var data = sheet.getDataRange().getValues();
  var keys = data.map(function(r) { return String(r[0]); });

  if (keys.indexOf('manager_pin') === -1) {
    sheet.appendRow(['manager_pin', '1234']);
    Logger.log('manager_pin を 1234 で登録しました');
  }
  if (keys.indexOf('staff_pin') === -1) {
    sheet.appendRow(['staff_pin', '0000']);
    Logger.log('staff_pin を 0000 で登録しました');
  }
  Logger.log('PIN初期設定完了。GASエディタ → デプロイ → Webアプリとして管理 でアクセス権限を確認してください。');
}

/**
 * GETリクエスト処理
 */
function doGet(e) {
  var params = e ? e.parameter : {};
  var action = params.action || '';

  try {
    switch (action) {
      case 'getShifts':
        return jsonResponse(getShifts(params.from, params.to));
      case 'getStaff':
        return jsonResponse(getStaffList());
      case 'getLogs':
        return jsonResponse(getSendLogs(Number(params.limit) || 30));
      case 'getPreview':
        return jsonResponse(getReminderPreview(params.date));
      case 'getDeclines':
        return jsonResponse(getShiftDeclines(params.from, params.to));
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

  // LINE WORKS webhook イベント（typeフィールドで識別）
  if (body.type) {
    return handleLwWebhook(body);
  }

  var action = body.action || '';

  try {
    switch (action) {
      case 'updateShift':
        return jsonResponse(updateShiftTime(body.date, body.origName, body.newName, body.newStart, body.newEnd));
      case 'addShift':
        return jsonResponse(addShift(body.date, body.dayOfWeek, body.staffName, body.start, body.end));
      case 'deleteShift':
        return jsonResponse(deleteShiftByName(body.date, body.staffName));
      default:
        return jsonResponse({ success: false, error: '不明なaction: ' + action });
    }
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

/**
 * LINE WORKS webhook イベント処理
 * ボタンタップ（postback）を受け取り「無理」回答を記録する
 */
function handleLwWebhook(body) {
  try {
    if (body.type !== 'postback') return jsonResponse({ ok: true });
    var data = (body.content && body.content.data) ? body.content.data : '';
    if (data.indexOf('decline:') !== 0) return jsonResponse({ ok: true });

    var date = data.substring('decline:'.length);  // "decline:YYYY-MM-DD" → "YYYY-MM-DD"
    var userId = (body.source && body.source.userId) ? body.source.userId : '';
    var staffName = getStaffNameByLwUserId(userId);

    if (staffName && date) {
      saveShiftDecline(date, staffName);
      Logger.log('出欠記録: ' + staffName + ' / ' + date + ' → 無理');
    } else {
      Logger.log('出欠記録スキップ: userId=' + userId + ' date=' + date);
    }
  } catch (err) {
    Logger.log('LW webhook error: ' + err.message);
  }
  // LINE WORKSには常に200を返す
  return jsonResponse({ ok: true });
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
