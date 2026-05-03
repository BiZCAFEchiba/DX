// ============================================================
// reminderService.gs - リマインド送信・ログ管理
// ============================================================

var LOG_HEADERS = ['送信日時', '対象日', 'スタッフ数', '送信方法', '結果', '詳細'];

/**
 * リマインド送信プレビューを取得する
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {{ success: boolean, data: Object }}
 */
function getReminderPreview(dateStr) {
  if (!dateStr) {
    return { success: false, error: '日付を指定してください' };
  }

  var result = getShifts(dateStr, dateStr);
  if (!result.success || result.data.shifts.length === 0) {
    return { success: true, data: { hasShift: false, message: 'この日のシフトデータがありません' } };
  }

  var day = result.data.shifts[0];
  var mapping = getStaffMapping();
  var messageText = buildMessageText(day, mapping);

  return {
    success: true,
    data: {
      hasShift: true,
      date: dateStr,
      displayDate: formatDateDisplay(dateStr),
      staffCount: day.staff.length,
      messagePreview: messageText
    }
  };
}

/**
 * 手動リマインドをLINE WORKSに送信する
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {{ success: boolean, data: Object }}
 */
function sendManualReminder(dateStr) {
  if (!dateStr) {
    return { success: false, error: '日付を指定してください' };
  }

  var result = getShifts(dateStr, dateStr);
  if (!result.success || result.data.shifts.length === 0) {
    writeLog(dateStr, 0, 'manual', 'skip', 'シフトデータなし');
    return { success: false, error: 'この日のシフトデータがありません' };
  }

  var day = result.data.shifts[0];
  var mapping = getStaffMapping();
  var sendResult = sendToLineWorks(day, mapping);

  writeLog(dateStr, day.staff.length, 'manual',
    sendResult.success ? 'success' : 'error',
    sendResult.success ? '正常送信' : sendResult.error
  );

  if (sendResult.success) {
    return { success: true, data: { sentTo: day.staff.length, message: 'リマインドを送信しました' } };
  } else {
    return { success: false, error: '送信失敗: ' + sendResult.error };
  }
}

/**
 * LINE WORKSにメンション付きメッセージを送信する
 */
function sendToLineWorks(dayData, staffMapping) {
  // アクセストークン取得
  var token = getLwAccessToken();
  if (!token) {
    return { success: false, error: 'アクセストークン取得失敗' };
  }

  var messageText = buildMessageText(dayData, staffMapping);
  var mentionedList = buildMentionedList(dayData.staff, staffMapping);

  var url = LW_API_BASE + '/bots/' + LW_BOT_ID + '/channels/' + LW_CHANNEL_ID + '/messages';
  var body = {
    content: {
      type: 'button_template',
      contentText: messageText,
      actions: [
        {
          type: 'uri',
          label: '✅ 行ける（カレンダーを開く）',
          uri: LW_PWA_URL
        },
        {
          type: 'postback',
          label: '❌ 無理',
          data: 'decline:' + dayData.date
        }
      ]
    }
  };
  if (mentionedList.length > 0) {
    body.content.mentionedList = mentionedList;
  }

  // 最大3回リトライ
  for (var attempt = 1; attempt <= 3; attempt++) {
    try {
      var response = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'Authorization': 'Bearer ' + token },
        payload: JSON.stringify(body),
        muteHttpExceptions: true
      });

      var code = response.getResponseCode();
      if (code === 200 || code === 201) {
        return { success: true };
      }
      Logger.log('送信失敗 (' + attempt + '/3): HTTP ' + code + ' - ' + response.getContentText());
    } catch (e) {
      Logger.log('送信エラー (' + attempt + '/3): ' + e.message);
    }
    if (attempt < 3) Utilities.sleep(2000);
  }

  return { success: false, error: '3回リトライ後も送信失敗' };
}

/**
 * メッセージテキストを組み立てる
 */
function buildMessageText(dayData, staffMapping) {
  var displayDate = formatDateDisplay(dayData.date);
  var text = '【明日のシフトリマインド】\n';
  text += '\uD83D\uDCC5 ' + displayDate + '\n\n';

  for (var i = 0; i < dayData.staff.length; i++) {
    var s = dayData.staff[i];
    var hasMapping = staffMapping[s.name] ? true : false;

    if (hasMapping) {
      text += '<mention user_id="' + i + '">' + s.name + '</mention>';
    } else {
      text += s.name;
    }
    text += '  ' + s.start + '\u301C' + s.end + '\n';

    if (s.tasks && s.tasks.length > 0) {
      text += '  \u2514 \uD83D\uDCCB ' + s.tasks.join(' / ') + '\n';
    }
  }

  text += '\n明日もよろしくお願いします！\n';
  text += '出勤時間の確認をお願いします。';
  return text;
}

/**
 * メンションリストを組み立てる
 */
function buildMentionedList(staffList, staffMapping) {
  var list = [];
  for (var i = 0; i < staffList.length; i++) {
    var accountId = staffMapping[staffList[i].name];
    if (accountId) {
      list.push({ type: 'user', userId: accountId });
    }
  }
  return list;
}

// --- LINE WORKS 認証 ---

/**
 * JWT認証でアクセストークンを取得
 */
function getLwAccessToken() {
  try {
    var now = Math.floor(Date.now() / 1000);
    var header = { alg: 'RS256', typ: 'JWT' };
    var payload = {
      iss: LW_CLIENT_ID,
      sub: LW_SERVICE_ACCOUNT,
      iat: now,
      exp: now + 3600
    };

    var jwt = createJwtToken(header, payload, LW_PRIVATE_KEY);

    var response = UrlFetchApp.fetch(LW_AUTH_URL, {
      method: 'post',
      contentType: 'application/x-www-form-urlencoded',
      payload: {
        assertion: jwt,
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        client_id: LW_CLIENT_ID,
        client_secret: LW_CLIENT_SECRET,
        scope: 'bot'
      },
      muteHttpExceptions: true
    });

    var result = JSON.parse(response.getContentText());
    if (result.access_token) return result.access_token;
    Logger.log('トークン取得失敗: ' + response.getContentText());
    return null;
  } catch (e) {
    Logger.log('認証エラー: ' + e.message);
    return null;
  }
}

function createJwtToken(header, payload, privateKey) {
  var h = b64url(JSON.stringify(header));
  var p = b64url(JSON.stringify(payload));
  var input = h + '.' + p;
  var sig = Utilities.computeRsaSha256Signature(input, privateKey);
  return input + '.' + b64url(sig);
}

function b64url(input) {
  var encoded = typeof input === 'string'
    ? Utilities.base64Encode(input, Utilities.Charset.UTF_8)
    : Utilities.base64Encode(input);
  return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// --- 送信ログ ---

/**
 * 送信ログを記録する
 */
function writeLog(dateStr, staffCount, method, resultStatus, detail) {
  var sheet = getOrCreateSheet(SHEET_LOGS, LOG_HEADERS);
  sheet.appendRow([new Date(), dateStr, staffCount, method, resultStatus, detail]);
}

/**
 * 送信ログを取得する
 * @param {number} limit
 * @returns {{ success: boolean, data: { logs: Array } }}
 */
function getSendLogs(limit) {
  var sheet = getOrCreateSheet(SHEET_LOGS, LOG_HEADERS);
  var data = sheet.getDataRange().getValues();
  var logs = [];

  // 新しい順に取得
  for (var i = data.length - 1; i >= 1; i--) {
    if (logs.length >= limit) break;
    logs.push({
      sentAt: data[i][0] instanceof Date ? data[i][0].toISOString() : String(data[i][0]),
      targetDate: data[i][1] instanceof Date ? formatDateISO(data[i][1]) : String(data[i][1]),
      staffCount: Number(data[i][2]) || 0,
      method: String(data[i][3]),
      result: String(data[i][4]),
      detail: String(data[i][5])
    });
  }

  return { success: true, data: { logs: logs } };
}
